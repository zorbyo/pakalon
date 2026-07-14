export const deepLinkEvent = "pakalon:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("pakalon://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

type PakalonWindow = Window & {
  __PAKALON__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: PakalonWindow) => {
  const pending = target.__PAKALON__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__PAKALON__) target.__PAKALON__.deepLinks = []
  return pending
}
