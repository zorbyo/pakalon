/**
 * Environment variable utilities
 */

/**
 * Check if an environment variable is truthy
 * Considers "1", "true", "yes", "on" as truthy values (case-insensitive)
 */
export function isEnvTruthy(value: string | undefined | null): boolean {
  if (!value) return false
  const normalized = value.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)
}

/**
 * Check if an environment variable is falsy
 * Considers "0", "false", "no", "off" as falsy values (case-insensitive)
 */
export function isEnvFalsy(value: string | undefined | null): boolean {
  if (!value) return true
  const normalized = value.toLowerCase().trim()
  return ['0', 'false', 'no', 'off', 'disabled', ''].includes(normalized)
}

/**
 * Get an environment variable with a default value
 */
export function getEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue
}

/**
 * Get an environment variable as a number
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Get an environment variable as a boolean
 */
export function getEnvBoolean(key: string, defaultValue = false): boolean {
  const value = process.env[key]
  if (!value) return defaultValue
  return isEnvTruthy(value)
}

/**
 * Get user type from environment
 */
export function getUserType(): 'ant' | 'user' {
  return process.env.USER_TYPE === 'ant' ? 'ant' : 'user'
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || isEnvTruthy(process.env.DEV)
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test' || isEnvTruthy(process.env.TEST)
}

/**
 * Check if CI environment
 */
export function isCI(): boolean {
  return isEnvTruthy(process.env.CI) || isEnvTruthy(process.env.CONTINUOUS_INTEGRATION)
}

/**
 * Get the current platform
 */
export function getPlatform(): NodeJS.Platform {
  return process.platform
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux'
}
