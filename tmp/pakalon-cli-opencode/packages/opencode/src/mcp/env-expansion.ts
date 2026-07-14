/**
 * Environment Variable Expansion for MCP Configurations
 *
 * Shared utilities for expanding environment variables in MCP server configurations.
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Split on :- to support default values (limit to 2 parts to preserve :- in defaults)
    const [varName, defaultValue] = varContent.split(":-", 2)
    const envValue = process.env[varName]

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}

/**
 * Expand environment variables in an object recursively
 */
export function expandEnvVarsInObject<T extends Record<string, unknown>>(
  obj: T
): { expanded: T; missingVars: string[] } {
  const allMissingVars: string[] = []

  function expand(value: unknown): unknown {
    if (typeof value === "string") {
      const { expanded, missingVars } = expandEnvVarsInString(value)
      allMissingVars.push(...missingVars)
      return expanded
    }

    if (Array.isArray(value)) {
      return value.map(expand)
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value)) {
        result[key] = expand(val)
      }
      return result
    }

    return value
  }

  return {
    expanded: expand(obj) as T,
    missingVars: allMissingVars,
  }
}

/**
 * Check if a string contains environment variable references
 */
export function hasEnvVarRefs(value: string): boolean {
  return /\$\{[^}]+\}/.test(value)
}

/**
 * Extract environment variable names from a string
 */
export function extractEnvVarNames(value: string): string[] {
  const matches = value.matchAll(/\$\{([^}:-]+)(?::-[^}]*)?\}/g)
  return Array.from(matches, (m) => m[1]!)
}

/**
 * Replace environment variables with placeholders for display
 * (hides actual values for security)
 */
export function maskEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    const [varName] = varContent.split(":-", 2)
    const envValue = process.env[varName]
    if (envValue !== undefined) {
      // Mask the value
      if (envValue.length <= 8) {
        return "***"
      }
      return envValue.slice(0, 2) + "***" + envValue.slice(-2)
    }
    return match
  })
}

export default {
  expandEnvVarsInString,
  expandEnvVarsInObject,
  hasEnvVarRefs,
  extractEnvVarNames,
  maskEnvVars,
}
