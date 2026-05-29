export function getSystemLocaleLanguage(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (!locale) return undefined
    const base = locale.split('-')[0]
    if (base && base.length === 2) return base
    return undefined
  } catch {
    return undefined
  }
}
