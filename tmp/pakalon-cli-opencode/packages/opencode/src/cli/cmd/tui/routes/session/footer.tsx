import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useLocal } from "../../context/local"
import { useKV } from "../../context/kv"
import { useKeyboard } from "@opentui/solid"
import { LoadingAnimation } from "../../component/loading-animation"
import {
  applyInteractionMode,
  interactionModeColor,
  interactionModeLabel,
  nextInteractionMode,
  type InteractionMode,
} from "./interaction-mode"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const kv = useKV()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const [interactionMode, setInteractionMode] = kv.signal<InteractionMode>("interaction_mode", "build")
  const [thinkingEnabled, setThinkingEnabled] = kv.signal("thinking_mode", false)

  createEffect(() => {
    if (route.data.type !== "session") return
    const supportsThinkingEffort = local.model.variant.list().length > 0
    if (!supportsThinkingEffort) {
      setThinkingEnabled((prev) => (prev ? false : prev))
    }
  })

  const cycleMode = () => {
    const next = nextInteractionMode(interactionMode())
    setInteractionMode(next)
    applyInteractionMode(next, local)
  }

  useKeyboard((evt) => {
    if (route.data.type !== "session") return
    if (evt.name === "tab" && evt.shift) {
      evt.preventDefault()
      cycleMode()
      return
    }
    if (evt.name === "tab" && !evt.shift) {
      evt.preventDefault()
      if (local.model.variant.list().length === 0) {
        setThinkingEnabled(false)
        return
      }
      setThinkingEnabled((prev) => !prev)
    }
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
          </Match>
        </Switch>
      </box>
    </box>
  )
}

export function SessionPromptMeta() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const kv = useKV()
  const [interactionMode] = kv.signal<InteractionMode>("interaction_mode", "build")
  const [thinkingEnabled] = kv.signal("thinking_mode", false)
  const effortOptions = createMemo(() => local.model.variant.list())

  const diffStats = createMemo(() => {
    if (route.data.type !== "session") return { files: 0, added: 0, removed: 0 }
    const diff = sync.data.session_diff[route.data.sessionID] ?? []
    return {
      files: diff.length,
      added: diff.reduce((total, item) => total + (item.additions ?? 0), 0),
      removed: diff.reduce((total, item) => total + (item.deletions ?? 0), 0),
    }
  })

  const modeColor = createMemo(() => interactionModeColor(interactionMode(), theme))

  return (
    <Show when={route.data.type === "session"}>
      <box width="100%" flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <box flexDirection="column" gap={0} alignItems="flex-start">
          <text fg={modeColor()}>
            <span style={{ bold: true }}>{interactionModeLabel(interactionMode())}</span>
            <span style={{ fg: effortOptions().length > 0 && thinkingEnabled() ? modeColor() : theme.textMuted }}>
              {" "}•{" "}
              {effortOptions().length > 0 ? `thinking ${thinkingEnabled() ? "on" : "off"}` : "thinking unavailable"}
            </span>
          </text>
          <text fg={theme.textMuted}>
            Shift+Tab: mode{effortOptions().length > 0 ? " • Tab: toggle thinking" : ""}
          </text>
        </box>
        <box flexDirection="column" gap={0} alignItems="flex-end">
          <text fg={theme.textMuted}>
            {diffStats().files} files <span style={{ fg: theme.diffAdded }}>+{diffStats().added}</span>{" "}
            <span style={{ fg: theme.diffRemoved }}>-{diffStats().removed}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}

export function SessionRunningIndicator() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const [elapsed, setElapsed] = createSignal(0)

  const status = createMemo(() => {
    if (route.data.type !== "session") return { type: "idle" as const }
    return sync.data.session_status?.[route.data.sessionID] ?? { type: "idle" as const }
  })
  const isRunning = createMemo(() => route.data.type === "session" && status().type !== "idle")

  createEffect(() => {
    if (!isRunning()) {
      setElapsed(0)
      return
    }

    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })

  const elapsedLabel = createMemo(() => {
    const total = elapsed()
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  })

  return (
    <Show when={isRunning()}>
      <box width="100%" flexDirection="row" justifyContent="flex-start" paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
        {/* Use slower interval (400ms) to reduce flickering */}
        <LoadingAnimation active={true} color={theme.warning} size="tiny" interval={400} />
        <text fg={theme.textMuted}>working {elapsedLabel()}</text>
      </box>
    </Show>
  )
}
