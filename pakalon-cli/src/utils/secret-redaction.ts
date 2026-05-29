/**
 * Secret Redaction — auto-redacts environment variable values from output.
 * Matches Copilot CLI's --secret-env-vars flag.
 *
 * When enabled, values of specified environment variables are replaced
 * with [REDACTED] in all tool output and TUI display.
 */

let redactedValues: string[] = [];

/**
 * Initialize secret redaction with a list of environment variable names.
 * @param envVarNames Comma-separated list of env var names to redact
 */
export function initSecretRedaction(envVarNames: string): void {
  const names = envVarNames.split(",").map((n) => n.trim()).filter(Boolean);
  redactedValues = names
    .map((name) => process.env[name])
    .filter((val): val is string => !!val && val.length > 0);
}

/**
 * Redact secrets from a text string.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const secret of redactedValues) {
    if (secret.length >= 4) {
      // Only redact values that are at least 4 chars to avoid false positives
      result = result.split(secret).join("[REDACTED]");
    }
  }
  return result;
}

/**
 * Check if secret redaction is active.
 */
export function isSecretRedactionActive(): boolean {
  return redactedValues.length > 0;
}

/**
 * Clear all redacted values.
 */
export function clearSecretRedaction(): void {
  redactedValues = [];
}
