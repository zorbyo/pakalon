import { For, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { getPakalonCliLogo } from "@/cli/logo"
import { useTerminalDimensions } from "@opentui/solid"

export function Logo() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  
  // Get appropriate logo based on terminal size
  const logo = createMemo(() => {
    // Force re-computation when dimensions change
    const _dims = dimensions()
    return getPakalonCliLogo()
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={logo()}>
        {(line) => (
          <text fg={theme.text} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
