// Sourced from assets\text-animation\ink-black.tsx frame content.
// Full size logo for terminals >= 80 columns
export const pakalonCliLogo = [
  "██████╗  █████╗ ██╗  ██╗ █████╗ ██╗      ██████╗ ███╗   ██╗",
  "██╔══██╗██╔══██╗██║ ██╔╝██╔══██╗██║     ██╔═══██╗████╗  ██║",
  "██████╔╝███████║█████╔╝ ███████║██║     ██║   ██║██╔██╗ ██║",
  "██╔═══╝ ██╔══██║██╔═██╗ ██╔══██║██║     ██║   ██║██║╚██╗██║",
  "██║     ██║  ██║██║  ██╗██║  ██║███████╗╚██████╔╝██║ ╚████║",
  "╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝",
]

// Compact logo for terminals 60-79 columns
export const pakalonCliLogoCompact = [
  "█▀█ ▄▀▄ █▄▀ ▄▀▄ █   ▄▀▄ █▄ █",
  "█▀▀ █▀█ █ █ █▀█ █▄▄ █▀█ █ ▀█",
]

// Tiny logo for terminals < 60 columns
export const pakalonCliLogoTiny = [
  "PAKALON",
]

// Micro logo for very small terminals < 40 columns
export const pakalonCliLogoMicro = [
  "PKLN",
]

// Full box logo for large terminals
export const pakalonLogo = `
╔═════════════════════════════════════╗
║  ██████   █████  ██   ██  █████     ║
║  ██   ██ ██   ██ ███ ███ ██   ██    ║
║  ██████  ███████ ██ █ ██ ███████    ║
║  ██      ██   ██ ██   ██ ██   ██    ║
║  ██      ██   ██ ██   ██ ██   ██    ║
║     AI-Powered Pipeline v1.0        ║
╚═════════════════════════════════════╝
`

// Compact box logo for medium terminals
export const pakalonLogoCompact = `
╔══════════════════════════╗
║ PAKALON - AI Pipeline   ║
║ v1.0.0                  ║
╚══════════════════════════╝
`

// Tiny logo for very small terminals
export const pakalonLogoTiny = `
─ PAKALON v1.0 ─
`

/**
 * Terminal size categories
 */
export type TerminalSize = "large" | "medium" | "small" | "tiny"

/**
 * Get current terminal size category
 */
export function getTerminalSize(): TerminalSize {
  const cols = process.stdout.columns ?? 80
  const rows = process.stdout.rows ?? 24

  if (cols < 40 || rows < 10) return "tiny"
  if (cols < 60 || rows < 16) return "small"
  if (cols < 80 || rows < 20) return "medium"
  return "large"
}

/**
 * Check if terminal is small (less than 80 columns or 24 rows)
 */
export function isSmallTerminal(): boolean {
  const size = getTerminalSize()
  return size === "small" || size === "tiny" || size === "medium"
}

/**
 * Get the appropriate CLI logo based on terminal size
 */
export function getPakalonCliLogo(): string[] {
  const size = getTerminalSize()
  switch (size) {
    case "tiny":
      return pakalonCliLogoMicro
    case "small":
      return pakalonCliLogoTiny
    case "medium":
      return pakalonCliLogoCompact
    case "large":
    default:
      return pakalonCliLogo
  }
}

/**
 * Get the appropriate logo based on terminal size
 */
export function getPakalonLogo(): string {
  const size = getTerminalSize()
  switch (size) {
    case "tiny":
      return pakalonLogoTiny
    case "small":
      return pakalonLogoCompact
    case "medium":
      return pakalonLogoCompact
    case "large":
    default:
      return pakalonLogo
  }
}
