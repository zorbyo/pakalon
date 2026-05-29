export function logError(error: Error): void {
  console.error('[error]', error.message, error.stack ?? '')
}
