/**
 * Sed Parser
 *
 * Parses and validates sed commands for:
 * - Edit validation
 * - Safety checks
 * - Command structure analysis
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SedCommand {
  /** Command type */
  type: 's' | 'd' | 'p' | 'a' | 'i' | 'c' | 'y' | 'q' | 'r' | 'w';
  /** Command address/line number */
  address?: string | number;
  /** Command pattern (for s command) */
  pattern?: string;
  /** Replacement string (for s command) */
  replacement?: string;
  /** Flags (for s command) */
  flags?: string;
  /** Text for a/i/c commands */
  text?: string;
  /** File for r/w commands */
  file?: string;
}

export interface SedParseResult {
  /** Whether parse was successful */
  success: boolean;
  /** Parsed commands */
  commands: SedCommand[];
  /** Error message if failed */
  error?: string;
  /** Warnings */
  warnings: string[];
}

export interface SedValidationResult {
  /** Whether command is safe */
  safe: boolean;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Reason for risk assessment */
  reason: string;
  /** Warnings */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a sed command string
 */
export function parseSedCommand(sedString: string): SedParseResult {
  const warnings: string[] = [];
  const commands: SedCommand[] = [];

  // Remove leading/trailing whitespace
  const cleaned = sedString.trim();

  if (!cleaned) {
    return { success: false, commands: [], error: 'Empty sed command', warnings };
  }

  // Check for common issues
  if (cleaned.includes('\n')) {
    warnings.push('Sed command contains newlines');
  }

  // Split by semicolons (multiple commands)
  const parts = splitSedCommands(cleaned);

  for (const part of parts) {
    const result = parseSingleSedCommand(part.trim());
    if (result.success && result.command) {
      commands.push(result.command);
    } else {
      return { success: false, commands: [], error: result.error, warnings };
    }
  }

  return { success: true, commands, warnings };
}

/**
 * Split sed commands by semicolons (respecting quotes)
 */
function splitSedCommands(sed: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < sed.length; i++) {
    const char = sed[i];

    if (inQuote) {
      current += char;
      if (char === quoteChar) {
        inQuote = false;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      current += char;
    } else if (char === ';') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/**
 * Parse a single sed command
 */
function parseSingleSedCommand(cmd: string): { success: boolean; command?: SedCommand; error?: string } {
  // Match sed command pattern: [address]command[options]
  const match = cmd.match(/^([^a-zA-Z]*)([a-zA-Z])(.*)$/);

  if (!match) {
    return { success: false, error: `Invalid sed command: ${cmd}` };
  }

  const [, addressPart, commandType, options] = match;

  const command: SedCommand = {
    type: commandType as SedCommand['type'],
  };

  // Parse address
  if (addressPart) {
    const address = addressPart.trim();
    if (/^\d+$/.test(address)) {
      command.address = parseInt(address, 10);
    } else {
      command.address = address;
    }
  }

  // Parse command-specific options
  switch (commandType) {
    case 's': // Substitute
      const sMatch = options.match(/^([^/]*)\/([^/]*)\/([^/]*)$/);
      if (sMatch) {
        command.pattern = sMatch[1];
        command.replacement = sMatch[2];
        command.flags = sMatch[3];
      } else {
        // Try alternate delimiter
        const altMatch = options.match(/^([^|]*)\|([^|]*)\|([^|]*)$/);
        if (altMatch) {
          command.pattern = altMatch[1];
          command.replacement = altMatch[2];
          command.flags = altMatch[3];
        } else {
          return { success: false, error: `Invalid substitute command: ${options}` };
        }
      }
      break;

    case 'd': // Delete
    case 'p': // Print
    case 'q': // Quit
      // No additional options needed
      break;

    case 'a': // Append
    case 'i': // Insert
    case 'c': // Change
      command.text = options.replace(/^\\n/, '').trim();
      break;

    case 'y': // Transform
      command.pattern = options;
      break;

    case 'r': // Read file
    case 'w': // Write file
      command.file = options.trim();
      break;

    default:
      return { success: false, error: `Unknown sed command: ${commandType}` };
  }

  return { success: true, command };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a sed command for safety
 */
export function validateSedCommand(sedString: string): SedValidationResult {
  const warnings: string[] = [];
  const parseResult = parseSedCommand(sedString);

  if (!parseResult.success) {
    return {
      safe: false,
      riskLevel: 'high',
      reason: parseResult.error || 'Failed to parse sed command',
      warnings: parseResult.warnings,
    };
  }

  // Check for dangerous patterns
  for (const cmd of parseResult.commands) {
    // Check for file write operations
    if (cmd.type === 'w') {
      return {
        safe: false,
        riskLevel: 'high',
        reason: 'Sed command writes to file',
        warnings: [...warnings, `Writing to file: ${cmd.file}`],
      };
    }

    // Check for file read operations
    if (cmd.type === 'r') {
      warnings.push(`Reading from file: ${cmd.file}`);
    }

    // Check for delete commands
    if (cmd.type === 'd') {
      warnings.push('Sed command deletes lines');
    }

    // Check for substitute with global flag
    if (cmd.type === 's' && cmd.flags?.includes('g')) {
      warnings.push('Global substitution (may affect multiple matches)');
    }

    // Check for substitute with execute flag
    if (cmd.type === 's' && cmd.flags?.includes('e')) {
      return {
        safe: false,
        riskLevel: 'critical',
        reason: 'Sed command executes replacement as command',
        warnings: [...warnings, 'Execute flag detected'],
      };
    }
  }

  // Determine risk level
  let riskLevel: SedValidationResult['riskLevel'] = 'low';
  if (warnings.length > 0) {
    riskLevel = 'medium';
  }
  if (warnings.length > 2) {
    riskLevel = 'high';
  }

  return {
    safe: true,
    riskLevel,
    reason: 'Sed command appears safe',
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Generate a simple sed substitute command
 */
export function generateSubstituteCommand(
  pattern: string,
  replacement: string,
  flags: string = 'g',
): string {
  return `s/${pattern}/${replacement}/${flags}`;
}

/**
 * Generate a sed delete command
 */
export function generateDeleteCommand(address?: string | number): string {
  return address !== undefined ? `${address}d` : 'd';
}

/**
 * Generate a sed print command
 */
export function generatePrintCommand(address?: string | number): string {
  return address !== undefined ? `${address}p` : 'p';
}

/**
 * Escape special characters in sed pattern
 */
export function escapeSedPattern(pattern: string): string {
  return pattern
    .replace(/\//g, '\\/')
    .replace(/\./g, '\\.')
    .replace(/\*/g, '\\*')
    .replace(/\+/g, '\\+')
    .replace(/\?/g, '\\?')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\^/g, '\\^')
    .replace(/\$/g, '\\$');
}
