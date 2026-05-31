/**
 * PowerShell Common Parameters
 * 
 * Handles PowerShell's built-in common parameters that are available
 * to all cmdlets and functions. These parameters affect command behavior
 * rather than the command's specific functionality.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommonParameter {
  name: string;
  aliases: string[];
  description: string;
  type: 'SwitchParameter' | 'string' | 'int' | 'object';
  isBuiltIn: boolean;
  affectsExecution: boolean;
}

export interface ParsedParameters {
  commonParameters: Map<string, unknown>;
  specificParameters: Map<string, unknown>;
  positionalArgs: string[];
  rawCommand: string;
}

// ---------------------------------------------------------------------------
// Common Parameters Definition
// ---------------------------------------------------------------------------

export const COMMON_PARAMETERS: CommonParameter[] = [
  {
    name: 'Debug',
    aliases: ['db'],
    description: 'Displays detailed information about the operation performed by the command.',
    type: 'SwitchParameter',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'ErrorAction',
    aliases: ['ea'],
    description: 'Determines how the cmdlet responds to a non-terminating error from the command.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'ErrorVariable',
    aliases: ['ev'],
    description: 'Stores errors about the command in the specified variable.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: false,
  },
  {
    name: 'InformationAction',
    aliases: ['ia'],
    description: 'Determines how the cmdlet responds to information records.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'InformationVariable',
    aliases: ['iv'],
    description: 'Stores information records in the specified variable.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: false,
  },
  {
    name: 'OutVariable',
    aliases: ['ov'],
    description: 'Stores the output objects in the specified variable.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: false,
  },
  {
    name: 'OutBuffer',
    aliases: ['ob'],
    description: 'Determines the number of objects to buffer before writing to the pipeline.',
    type: 'int',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'PipelineVariable',
    aliases: ['pv'],
    description: 'Stores the current pipeline object in the specified variable.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: false,
  },
  {
    name: 'Verbose',
    aliases: ['vb'],
    description: 'Displays detailed information about the operation performed by the command.',
    type: 'SwitchParameter',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'WarningAction',
    aliases: ['wa'],
    description: 'Determines how the cmdlet responds to a warning message.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'WarningVariable',
    aliases: ['wv'],
    description: 'Stores warnings about the command in the specified variable.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: false,
  },
  {
    name: 'ProgressAction',
    aliases: ['proga'],
    description: 'Determines how the cmdlet responds to progress records.',
    type: 'string',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'WhatIf',
    aliases: ['wi'],
    description: 'Shows what would happen if the command runs without actually running it.',
    type: 'SwitchParameter',
    isBuiltIn: true,
    affectsExecution: true,
  },
  {
    name: 'Confirm',
    aliases: ['cf'],
    description: 'Prompts for confirmation before running the command.',
    type: 'SwitchParameter',
    isBuiltIn: true,
    affectsExecution: true,
  },
];

// ---------------------------------------------------------------------------
// ErrorAction Values
// ---------------------------------------------------------------------------

export const ERROR_ACTION_PREFERENCES = [
  'SilentlyContinue',
  'Stop',
  'Continue',
  'Ignore',
  'Inquire',
  'Suspend',
] as const;

export type ErrorActionPreference = typeof ERROR_ACTION_PREFERENCES[number];

// ---------------------------------------------------------------------------
// Parameter Parsing
// ---------------------------------------------------------------------------

/**
 * Check if a parameter name (or alias) is a common parameter
 */
export function isCommonParameter(paramName: string): boolean {
  const normalized = paramName.toLowerCase().replace(/^-/, '');
  return COMMON_PARAMETERS.some(
    p => p.name.toLowerCase() === normalized || 
         p.aliases.some(a => a.toLowerCase() === normalized)
  );
}

/**
 * Get common parameter definition by name or alias
 */
export function getCommonParameter(paramName: string): CommonParameter | undefined {
  const normalized = paramName.toLowerCase().replace(/^-/, '');
  return COMMON_PARAMETERS.find(
    p => p.name.toLowerCase() === normalized || 
         p.aliases.some(a => a.toLowerCase() === normalized)
  );
}

/**
 * Parse a PowerShell command to extract common and specific parameters
 */
export function parseParameters(command: string): ParsedParameters {
  const commonParameters = new Map<string, unknown>();
  const specificParameters = new Map<string, unknown>();
  const positionalArgs: string[] = [];
  
  const tokens = tokenizeCommand(command);
  let i = 0;
  
  while (i < tokens.length) {
    const token = tokens[i];
    
    // Check for parameter (starts with -)
    if (token.startsWith('-')) {
      const paramName = token.slice(1);
      
      // Check if it's a switch parameter (no value follows)
      const nextToken = tokens[i + 1];
      const isSwitch = !nextToken || nextToken.startsWith('-');
      
      if (isSwitch) {
        // Switch parameter
        if (isCommonParameter(paramName)) {
          commonParameters.set(paramName, true);
        } else {
          specificParameters.set(paramName, true);
        }
        i++;
      } else {
        // Value parameter
        const value = nextToken;
        if (isCommonParameter(paramName)) {
          commonParameters.set(paramName, value);
        } else {
          specificParameters.set(paramName, value);
        }
        i += 2;
      }
    } else {
      // Positional argument
      positionalArgs.push(token);
      i++;
    }
  }
  
  return {
    commonParameters,
    specificParameters,
    positionalArgs,
    rawCommand: command,
  };
}

/**
 * Tokenize a PowerShell command into individual tokens
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    
    if (inBacktick) {
      current += char;
      inBacktick = false;
      continue;
    }
    
    if (char === '`' && !inSingleQuote) {
      inBacktick = true;
      current += char;
      continue;
    }
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    
    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    
    current += char;
  }
  
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

// ---------------------------------------------------------------------------
// Parameter Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a common parameter value is valid
 */
export function validateCommonParameter(
  paramName: string,
  value: unknown
): { valid: boolean; error?: string } {
  const param = getCommonParameter(paramName);
  
  if (!param) {
    return { valid: false, error: `Unknown parameter: ${paramName}` };
  }
  
  if (param.type === 'SwitchParameter') {
    if (value !== true && value !== false) {
      return { valid: false, error: `Switch parameter ${paramName} must be $true or $false` };
    }
    return { valid: true };
  }
  
  if (param.type === 'int') {
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num)) {
      return { valid: false, error: `Parameter ${paramName} must be an integer` };
    }
    return { valid: true };
  }
  
  if (param.type === 'string') {
    if (typeof value !== 'string') {
      return { valid: false, error: `Parameter ${paramName} must be a string` };
    }
    
    // Validate ErrorAction and WarningAction values
    if (paramName === 'ErrorAction' || paramName === 'WarningAction') {
      if (!ERROR_ACTION_PREFERENCES.includes(value as ErrorActionPreference)) {
        return {
          valid: false,
          error: `Invalid ErrorAction value: ${value}. Must be one of: ${ERROR_ACTION_PREFERENCES.join(', ')}`,
        };
      }
    }
    
    return { valid: true };
  }
  
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Parameter Formatting
// ---------------------------------------------------------------------------

/**
 * Format a common parameter for display
 */
export function formatCommonParameter(param: CommonParameter): string {
  const aliases = param.aliases.length > 0 ? ` (${param.aliases.join(', ')})` : '';
  return `-${param.name}${aliases}: ${param.description}`;
}

/**
 * Format all common parameters for help display
 */
export function formatCommonParametersHelp(): string {
  const lines = ['Common Parameters:', ''];
  for (const param of COMMON_PARAMETERS) {
    lines.push(`  ${formatCommonParameter(param)}`);
  }
  return lines.join('\n');
}

/**
 * Format parsed parameters for debugging
 */
export function formatParsedParameters(parsed: ParsedParameters): string {
  const lines: string[] = ['Parsed Parameters:', ''];
  
  if (parsed.commonParameters.size > 0) {
    lines.push('Common Parameters:');
    Array.from(parsed.commonParameters.entries()).forEach(([key, value]) => {
      lines.push(`  -${key}: ${JSON.stringify(value)}`);
    });
    lines.push('');
  }
  
  if (parsed.specificParameters.size > 0) {
    lines.push('Specific Parameters:');
    Array.from(parsed.specificParameters.entries()).forEach(([key, value]) => {
      lines.push(`  -${key}: ${JSON.stringify(value)}`);
    });
    lines.push('');
  }
  
  if (parsed.positionalArgs.length > 0) {
    lines.push('Positional Arguments:');
    for (const arg of parsed.positionalArgs) {
      lines.push(`  ${arg}`);
    }
  }
  
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parameter Building
// ---------------------------------------------------------------------------

/**
 * Build a command string with common parameters
 */
export function buildCommandWithCommonParameters(
  baseCommand: string,
  commonParams: Map<string, unknown>
): string {
  const parts = [baseCommand];
  
  Array.from(commonParams.entries()).forEach(([key, value]) => {
    if (value === true) {
      parts.push(`-${key}`);
    } else if (value !== false && value !== undefined) {
      parts.push(`-${key} ${escapeParameter(String(value))}`);
    }
  });
  
  return parts.join(' ');
}

/**
 * Escape a parameter value for safe inclusion in a command
 */
export function escapeParameter(value: string): string {
  if (value.includes(' ') || value.includes('"') || value.includes("'")) {
    return `"${value.replace(/"/g, '`"')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  COMMON_PARAMETERS,
  ERROR_ACTION_PREFERENCES,
  isCommonParameter,
  getCommonParameter,
  parseParameters,
  validateCommonParameter,
  formatCommonParameter,
  formatCommonParametersHelp,
  formatParsedParameters,
  buildCommandWithCommonParameters,
  escapeParameter,
};
