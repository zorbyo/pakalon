export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  if (value && typeof value === 'object' && 'message' in value) {
    return new Error(String((value as Record<string, unknown>).message))
  }
  return new Error(String(value))
}
