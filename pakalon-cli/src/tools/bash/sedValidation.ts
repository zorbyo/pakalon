/**
 * Sed Validation
 * Validates sed commands for safety
 */
import logger from '@/utils/logger.js';

export interface SedValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
  isInplace: boolean;
  targetFiles: string[];
}

const DANGEROUS_SED_PATTERNS = [
  { pattern: /sed\s+.*-i\s+.*\/\s*$/, reason: 'In-place edit to root directory' },
  { pattern: /sed\s+.*-i\s+.*~\s*$/, reason: 'In-place edit to home directory' },
  { pattern: /sed\s+.*[;&]`/, reason: 'Sed with shell metacharacters' },
  { pattern: /sed\s+.*\$\(/, reason: 'Sed with command substitution' },
  { pattern: /sed\s+.*\\x00/, reason: 'Sed with null byte' },
];

const SUSPICIOUS_SED_FLAGS = [
  { pattern: /-i[^n]/, reason: 'In-place edit without backup' },
  { pattern: /--in-place/, reason: 'In-place edit' },
  { pattern: /-e.*;/, reason: 'Multiple sed expressions' },
  { pattern: /--expression/, reason: 'Sed expression flag' },
];

export function validateSedCommand(command: string): SedValidationResult {
  const warnings: string[] = [];
  const targetFiles: string[] = [];

  if (!command.includes('sed')) {
    return {
      valid: true,
      warnings: [],
      isInplace: false,
      targetFiles: [],
    };
  }

  const hasInplace = /-i|--in-place/.test(command);
  const isInplaceRegex = /-i\s*(\S+)/;
  const inplaceMatch = command.match(isInplaceRegex);

  if (hasInplace) {
    warnings.push('Sed uses in-place editing');
  }

  for (const { pattern, reason } of DANGEROUS_SED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        error: reason,
        warnings,
        isInplace: hasInplace,
        targetFiles,
      };
    }
  }

  for (const { pattern, reason } of SUSPICIOUS_SED_FLAGS) {
    if (pattern.test(command)) {
      warnings.push(reason);
    }
  }

  const sedPattern = /sed\s+[^|]*\s+(['"])?([^'"\s]+)\1\s*$|sed\s+[^|]*\s+(['"])?([^'"\s]+)\1\s*$/;
  const match = command.match(sedPattern);
  if (match) {
    const file = match[2] || match[4];
    if (file && !file.startsWith('-')) {
      targetFiles.push(file);
    }
  }

  const sedFiles = command.match(/sed\s+[^|]*\s+['"]?(\S+)['"]?\s*$/g);
  if (sedFiles) {
    for (const sedCmd of sedFiles) {
      const parts = sedCmd.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (lastPart && !lastPart.startsWith('-') && !lastPart.startsWith("'") && !lastPart.startsWith('"')) {
        if (!targetFiles.includes(lastPart)) {
          targetFiles.push(lastPart);
        }
      }
    }
  }

  if (targetFiles.length === 0) {
    warnings.push('No target file detected');
  }

  return {
    valid: true,
    warnings,
    isInplace: hasInplace,
    targetFiles,
  };
}

export function isSedInplace(command: string): boolean {
  return /-i|--in-place/.test(command);
}

export function getSedTargetFiles(command: string): string[] {
  const result = validateSedCommand(command);
  return result.targetFiles;
}

export function hasSedDangerousPatterns(command: string): boolean {
  return DANGEROUS_SED_PATTERNS.some(({ pattern }) => pattern.test(command));
}

export {
  DANGEROUS_SED_PATTERNS,
  SUSPICIOUS_SED_FLAGS,
};