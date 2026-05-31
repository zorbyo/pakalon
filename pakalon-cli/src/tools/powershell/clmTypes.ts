/**
 * PowerShell Constrained Language Mode (CLM) Types
 * 
 * Provides type definitions and utilities for working with PowerShell's
 * Constrained Language Mode, which restricts access to certain language
 * elements and .NET types for security purposes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LanguageMode = 
  | 'FullLanguage'
  | 'ConstrainedLanguage'
  | 'RestrictedLanguage'
  | 'AllLanguage'
  | 'NoLanguage';

export interface CLMPolicy {
  mode: LanguageMode;
  restrictions: LanguageRestriction[];
  allowedTypes: string[];
  blockedTypes: string[];
  allowedCommands: string[];
  blockedCommands: string[];
}

export interface LanguageRestriction {
  feature: string;
  allowed: boolean;
  description: string;
}

export interface CLMCheckResult {
  isConstrained: boolean;
  mode: LanguageMode;
  violations: CLMViolation[];
  recommendations: string[];
}

export interface CLMViolation {
  type: 'type-access' | 'method-call' | 'property-access' | 'field-access' | 'command-block';
  element: string;
  reason: string;
  severity: 'error' | 'warning';
}

// ---------------------------------------------------------------------------
// Language Mode Definitions
// ---------------------------------------------------------------------------

export const LANGUAGE_MODES: Record<LanguageMode, CLMPolicy> = {
  FullLanguage: {
    mode: 'FullLanguage',
    restrictions: [],
    allowedTypes: ['*'],
    blockedTypes: [],
    allowedCommands: ['*'],
    blockedCommands: [],
  },
  ConstrainedLanguage: {
    mode: 'ConstrainedLanguage',
    restrictions: [
      { feature: 'Add-Type', allowed: false, description: 'Cannot add new types' },
      { feature: 'New-Object', allowed: true, description: 'Limited to allowed types' },
      { feature: 'Invoke-Expression', allowed: false, description: 'Cannot execute dynamic code' },
      { feature: 'Invoke-ScriptBlock', allowed: false, description: 'Cannot execute script blocks dynamically' },
      { feature: 'Reflection', allowed: false, description: 'Cannot access .NET reflection APIs' },
      { feature: 'P/Invoke', allowed: false, description: 'Cannot call native methods' },
      { feature: 'COM Objects', allowed: false, description: 'Cannot create COM objects' },
      { feature: 'Type Accelerators', allowed: false, description: 'Cannot use type accelerators' },
    ],
    allowedTypes: [
      'System.Boolean',
      'System.Byte',
      'System.SByte',
      'System.Int16',
      'System.Int32',
      'System.Int64',
      'System.UInt16',
      'System.UInt32',
      'System.UInt64',
      'System.Decimal',
      'System.Single',
      'System.Double',
      'System.Char',
      'System.String',
      'System.DateTime',
      'System.TimeSpan',
      'System.Guid',
      'System.Array',
      'System.Collections.Hashtable',
      'System.Collections.ArrayList',
      'System.Collections.Generic.List',
      'System.Collections.Generic.Dictionary',
      'System.IO.Directory',
      'System.IO.File',
      'System.IO.Path',
      'System.Environment',
      'System.Math',
      'System.Convert',
      'System.Guid',
    ],
    blockedTypes: [
      'System.Reflection.*',
      'System.Runtime.InteropServices.*',
      'System.CodeDom.*',
      'Microsoft.CSharp.*',
      'System.Management.Automation.*',
    ],
    allowedCommands: [
      'Get-*',
      'Set-*',
      'New-*',
      'Remove-*',
      'Test-*',
      'Write-*',
      'Read-*',
      'Import-*',
      'Export-*',
      'Copy-*',
      'Move-*',
      'Start-*',
      'Stop-*',
      'Invoke-*',
      'ForEach-Object',
      'Where-Object',
      'Select-*',
      'Sort-*',
      'Format-*',
      'Out-*',
      'Measure-*',
      'Compare-*',
      'Group-*',
    ],
    blockedCommands: [
      'Add-Type',
      'Invoke-Expression',
      'Invoke-Command',
      'Invoke-ScriptBlock',
      'Get-Type',
      'Get-Member',
    ],
  },
  RestrictedLanguage: {
    mode: 'RestrictedLanguage',
    restrictions: [
      { feature: 'Script Blocks', allowed: false, description: 'Cannot create script blocks' },
      { feature: 'Functions', allowed: false, description: 'Cannot define functions' },
      { feature: 'Modules', allowed: false, description: 'Cannot import modules' },
      { feature: 'Snap-ins', allowed: false, description: 'Cannot load snap-ins' },
      { feature: 'XML', allowed: false, description: 'Cannot use XML elements' },
      { feature: 'Here-strings', allowed: false, description: 'Cannot use here-strings' },
    ],
    allowedTypes: [
      'System.Boolean',
      'System.Int32',
      'System.String',
    ],
    blockedTypes: ['*'],
    allowedCommands: ['*'],
    blockedCommands: [],
  },
  AllLanguage: {
    mode: 'AllLanguage',
    restrictions: [],
    allowedTypes: ['*'],
    blockedTypes: [],
    allowedCommands: ['*'],
    blockedCommands: [],
  },
  NoLanguage: {
    mode: 'NoLanguage',
    restrictions: [
      { feature: 'Commands', allowed: false, description: 'Cannot execute commands' },
      { feature: 'Scripts', allowed: false, description: 'Cannot run scripts' },
      { feature: 'Functions', allowed: false, description: 'Cannot define functions' },
    ],
    allowedTypes: [],
    blockedTypes: ['*'],
    allowedCommands: [],
    blockedCommands: ['*'],
  },
};

// ---------------------------------------------------------------------------
// Type Checking
// ---------------------------------------------------------------------------

/**
 * Check if a type is allowed in Constrained Language Mode
 */
export function isTypeAllowed(typeName: string, mode: LanguageMode = 'ConstrainedLanguage'): boolean {
  const policy = LANGUAGE_MODES[mode];
  if (!policy) return false;
  
  // Full language allows everything
  if (mode === 'FullLanguage' || mode === 'AllLanguage') return true;
  
  // Check blocked types first
  for (const blocked of policy.blockedTypes) {
    if (matchesTypePattern(typeName, blocked)) {
      return false;
    }
  }
  
  // Check allowed types
  for (const allowed of policy.allowedTypes) {
    if (allowed === '*') return true;
    if (matchesTypePattern(typeName, allowed)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a command is allowed in Constrained Language Mode
 */
export function isCommandAllowed(commandName: string, mode: LanguageMode = 'ConstrainedLanguage'): boolean {
  const policy = LANGUAGE_MODES[mode];
  if (!policy) return false;
  
  // Full language allows everything
  if (mode === 'FullLanguage' || mode === 'AllLanguage') return true;
  
  // Check blocked commands first
  for (const blocked of policy.blockedCommands) {
    if (matchesCommandPattern(commandName, blocked)) {
      return false;
    }
  }
  
  // Check allowed commands
  for (const allowed of policy.allowedCommands) {
    if (allowed === '*') return true;
    if (matchesCommandPattern(commandName, allowed)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Match a type name against a pattern (supports wildcards)
 */
function matchesTypePattern(typeName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    'i'
  );
  
  return regex.test(typeName);
}

/**
 * Match a command name against a pattern (supports wildcards)
 */
function matchesCommandPattern(commandName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  
  const regex = new RegExp(
    '^' + pattern.replace(/-/g, '\\-').replace(/\*/g, '.*') + '$',
    'i'
  );
  
  return regex.test(commandName);
}

// ---------------------------------------------------------------------------
// CLM Detection
// ---------------------------------------------------------------------------

/**
 * Analyze code for potential CLM violations
 */
export function analyzeForCLMViolations(
  code: string,
  mode: LanguageMode = 'ConstrainedLanguage'
): CLMCheckResult {
  const violations: CLMViolation[] = [];
  const recommendations: string[] = [];
  
  // Check for blocked type access
  const typeAccessPatterns = [
    { pattern: /\[System\.Reflection\./g, type: 'System.Reflection.*' },
    { pattern: /\[System\.Runtime\.InteropServices\./g, type: 'System.Runtime.InteropServices.*' },
    { pattern: /\[System\.CodeDom\./g, type: 'System.CodeDom.*' },
    { pattern: /\[Microsoft\.CSharp\./g, type: 'Microsoft.CSharp.*' },
  ];
  
  for (const { pattern, type } of typeAccessPatterns) {
    const matches = Array.from(code.matchAll(pattern));
    for (const match of matches) {
      if (!isTypeAllowed(type, mode)) {
        violations.push({
          type: 'type-access',
          element: match[0],
          reason: `Type ${type} is not allowed in ${mode}`,
          severity: 'error',
        });
      }
    }
  }
  
  // Check for blocked commands
  const blockedCommandPatterns = [
    { pattern: /\bAdd-Type\b/g, command: 'Add-Type' },
    { pattern: /\bInvoke-Expression\b/g, command: 'Invoke-Expression' },
    { pattern: /\bInvoke-Command\b/g, command: 'Invoke-Command' },
    { pattern: /\bInvoke-ScriptBlock\b/g, command: 'Invoke-ScriptBlock' },
  ];
  
  for (const { pattern, command } of blockedCommandPatterns) {
    const matches = Array.from(code.matchAll(pattern));
    for (const match of matches) {
      if (!isCommandAllowed(command, mode)) {
        violations.push({
          type: 'command-block',
          element: match[0],
          reason: `Command ${command} is not allowed in ${mode}`,
          severity: 'error',
        });
      }
    }
  }
  
  // Check for reflection usage
  const reflectionPatterns = [
    /\.GetType\(\)/g,
    /\.GetMember\(/g,
    /\.GetMethod\(/g,
    /\.GetProperty\(/g,
    /\.GetField\(/g,
    /\.GetEvent\(/g,
    /\.InvokeMember\(/g,
  ];
  
  for (const pattern of reflectionPatterns) {
    const matches = Array.from(code.matchAll(pattern));
    for (const match of matches) {
      violations.push({
        type: 'method-call',
        element: match[0],
        reason: 'Reflection methods are not allowed in Constrained Language Mode',
        severity: 'error',
      });
    }
  }
  
  // Check for P/Invoke
  const pInvokePatterns = [
    /\bDllImport\b/g,
    /\bMarshal\./g,
    /\bIntPtr\b/g,
    /\bHandleRef\b/g,
  ];
  
  for (const pattern of pInvokePatterns) {
    const matches = Array.from(code.matchAll(pattern));
    for (const match of matches) {
      violations.push({
        type: 'type-access',
        element: match[0],
        reason: 'P/Invoke is not allowed in Constrained Language Mode',
        severity: 'error',
      });
    }
  }
  
  // Generate recommendations
  if (violations.length > 0) {
    recommendations.push('Consider using allowed types and cmdlets instead of .NET types');
    recommendations.push('Use PowerShell cmdlets instead of direct .NET method calls');
    recommendations.push('Avoid dynamic code generation and reflection');
    recommendations.push('Use PowerShell functions and modules for code organization');
  }
  
  return {
    isConstrained: mode === 'ConstrainedLanguage' || mode === 'RestrictedLanguage',
    mode,
    violations,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a language mode policy for display
 */
export function formatCLMPolicy(policy: CLMPolicy): string {
  const lines: string[] = [
    `Language Mode: ${policy.mode}`,
    '',
    'Restrictions:',
  ];
  
  for (const restriction of policy.restrictions) {
    const status = restriction.allowed ? '✓' : '✗';
    lines.push(`  ${status} ${restriction.feature}: ${restriction.description}`);
  }
  
  if (policy.allowedTypes.length > 0 && policy.allowedTypes[0] !== '*') {
    lines.push('');
    lines.push('Allowed Types:');
    for (const type of policy.allowedTypes) {
      lines.push(`  - ${type}`);
    }
  }
  
  if (policy.blockedTypes.length > 0) {
    lines.push('');
    lines.push('Blocked Types:');
    for (const type of policy.blockedTypes) {
      lines.push(`  - ${type}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Format CLM check results for display
 */
export function formatCLMCheckResult(result: CLMCheckResult): string {
  const lines: string[] = [
    `CLM Check Result: ${result.isConstrained ? 'CONSTRAINED' : 'UNCONSTRAINED'}`,
    `Mode: ${result.mode}`,
    '',
  ];
  
  if (result.violations.length > 0) {
    lines.push(`Violations (${result.violations.length}):`);
    for (const violation of result.violations) {
      const icon = violation.severity === 'error' ? '❌' : '⚠️';
      lines.push(`  ${icon} [${violation.type}] ${violation.element}`);
      lines.push(`     ${violation.reason}`);
    }
    lines.push('');
  } else {
    lines.push('No violations found.');
    lines.push('');
  }
  
  if (result.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of result.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }
  
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  LANGUAGE_MODES,
  isTypeAllowed,
  isCommandAllowed,
  analyzeForCLMViolations,
  formatCLMPolicy,
  formatCLMCheckResult,
};
