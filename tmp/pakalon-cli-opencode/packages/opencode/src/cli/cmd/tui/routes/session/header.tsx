import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import type { AssistantMessage, Part, UserMessage } from "@pakalon-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { useLocal } from "../../context/local"
import { useKV } from "../../context/kv"
import { Plan } from "@/auth/plan"
import * as Backend from "@/backend"
import { BackendSessionSync } from "@/backend/session-sync"
import { isBackendEnabled } from "@/backend/types"
import { Installation } from "@/installation"
import { useTheme } from "@tui/context/theme"
import { Token } from "@/util/token"

const PREFERRED_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

function modelNameFromID(modelID: string) {
  const withoutTier = modelID.split(":")[0] ?? modelID
  const slash = withoutTier.lastIndexOf("/")
  return slash >= 0 ? withoutTier.slice(slash + 1) : withoutTier
}

function messageUsageTokens(message: AssistantMessage): number {
  const total = message.tokens?.total ?? 0
  if (total > 0) return total

  // Only count output + reasoning for assistant messages to avoid
  // double-counting input tokens across multiple messages
  const output = message.tokens?.output ?? 0
  const reasoning = message.tokens?.reasoning ?? 0
  if (output > 0 || reasoning > 0) return output + reasoning

  const input = (message.tokens as { input?: number } | undefined)?.input ?? 0
  const cacheRead = message.tokens?.cache?.read ?? 0
  const cacheWrite = message.tokens?.cache?.write ?? 0
  return Math.max(0, input + output + reasoning + cacheRead + cacheWrite)
}

function estimatePartTokens(part: Part): number {
  const item = part as Record<string, unknown>

  if (part.type === "text" && typeof item.text === "string") {
    return Token.estimate(item.text)
  }
  if (part.type === "reasoning" && typeof item.text === "string") {
    return Token.estimate(item.text)
  }
  if (part.type === "file") {
    let total = 0
    if (typeof item.filename === "string") total += Token.estimate(item.filename)
    const source = item.source as { text?: { value?: string } } | undefined
    if (source?.text?.value) total += Token.estimate(source.text.value)
    return total
  }
  if (part.type === "tool") {
    // Only count tool name and small metadata - avoid stringifying large objects
    // which caused massive token overcounting. Tool outputs are stored in
    // separate text parts and counted there.
    let total = 0
    if (typeof item.tool === "string") total += Token.estimate(item.tool)
    // Only count small input/output strings, cap large ones
    const state = item.state as Record<string, unknown> | undefined
    if (state) {
      for (const key of ["input", "output", "error"] as const) {
        const value = state[key]
        if (typeof value === "string") {
          total += Token.estimateCapped(value, 500)
        }
      }
    }
    return total
  }

  return 0
}

function messageDisplayTokens(message: AssistantMessage | UserMessage, parts: Part[]): number {
  if (message.role === "assistant") {
    // Use output + reasoning only to avoid double-counting input tokens
    // Input tokens represent the FULL conversation history sent to the API,
    // so summing input across all assistant messages massively overcounts.
    const output = message.tokens?.output ?? 0
    const reasoning = message.tokens?.reasoning ?? 0
    if (output > 0 || reasoning > 0) return output + reasoning

    const total = message.tokens?.total ?? 0
    if (total > 0) return total

    // Fallback: estimate from parts
    const estimated = parts.reduce((total, part) => total + estimatePartTokens(part), 0)
    return estimated > 0 ? estimated : 0
  }

  const estimated = parts.reduce((total, part) => total + estimatePartTokens(part), 0)
  return estimated > 0 ? estimated : 0
}

function createProgressBar(usedPct: number, width: number) {
  const clamped = Math.max(0, Math.min(100, usedPct))
  const filled = Math.round((clamped / 100) * width)
  return {
    filled: "█".repeat(filled),
    empty: "░".repeat(Math.max(0, width - filled)),
    pct: clamped,
  }
}

export function createSessionHeaderState() {
  const route = useRouteData("session")
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const narrow = createMemo(() => dimensions().width < 70)
  const verySmall = createMemo(() => dimensions().width < 50 || dimensions().height < 12)
  const currentModel = createMemo(() => local.model.current())
  const currentModelInfo = createMemo(() => {
    const current = currentModel()
    if (!current) return
    return sync.data.provider.find((x) => x.id === current.providerID)?.models[current.modelID]
  })
  const [contextWindowSize, setContextWindowSize] = createSignal<number | null>(null)
  const [backendRemainingPct, setBackendRemainingPct] = createSignal<number | null>(null)
  const [selectedModelName, setSelectedModelName] = createSignal<string>()
  const [backendSessionID, setBackendSessionID] = createSignal<string>()

  const displayedModelID = createMemo(() => currentModel()?.modelID || PREFERRED_DEFAULT_MODEL)
  const displayedModelLabel = createMemo(() => {
    const modelID = displayedModelID()
    const name = selectedModelName()?.trim()
    return name || modelNameFromID(modelID)
  })

  const refreshContextUsage = async (modelID: string) => {
    if (!isBackendEnabled()) {
      setContextWindowSize(currentModelInfo()?.limit.context ?? null)
      setBackendRemainingPct(null)
      setSelectedModelName(currentModelInfo()?.name ?? modelID)
      return
    }

    try {
      const [context, models] = await Promise.all([
        Plan.getContextStatus(modelID).catch(() => undefined),
        Backend.ModelsBackend.listModels().catch(() => undefined),
      ])
      const selected = models?.models.find((item) => {
        const id = item.id ?? item.model_id ?? item.name
        return id === modelID
      })
      setContextWindowSize(
        selected?.context_length ?? selected?.top_provider?.context_length ?? currentModelInfo()?.limit.context ?? null,
      )
      setBackendRemainingPct(
        typeof context?.remainingPct === "number" ? Math.max(0, Math.min(100, context.remainingPct)) : null,
      )
      setSelectedModelName(selected?.name ?? currentModelInfo()?.name ?? modelID)
    } catch {
      setContextWindowSize(currentModelInfo()?.limit.context ?? null)
      setBackendRemainingPct(null)
      setSelectedModelName(currentModelInfo()?.name ?? modelID)
    }
  }

  const localUsedTokens = createMemo(() => {
    const msgs = messages()
    if (msgs.length === 0) return 0

    // Find the most recent assistant message with input tokens.
    // The input of the last assistant represents the full conversation
    // history sent to the API, so we use it as the base instead of
    // summing input across all messages (which causes massive overcounting).
    let lastAssistantWithInput = -1
    let lastInput = 0
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        const input = (msgs[i].tokens as { input?: number } | undefined)?.input ?? 0
        if (input > 0) {
          lastAssistantWithInput = i
          lastInput = input
          break
        }
      }
    }

    let total = 0
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]
      const parts = sync.data.part[msg.id] ?? []

      if (msg.role === "assistant") {
        const m = msg as AssistantMessage
        const output = m.tokens?.output ?? 0
        const reasoning = m.tokens?.reasoning ?? 0

        if (i === lastAssistantWithInput) {
          // Use this assistant's input as the base (includes all previous history)
          // plus its own output/reasoning
          total = lastInput + output + reasoning
        } else if (i > lastAssistantWithInput) {
          // Messages after the last tracked assistant: add their output only
          total += Math.max(0, output + reasoning)
        } else if (lastAssistantWithInput < 0) {
          // No assistant with input found, count all outputs
          total += Math.max(0, output + reasoning)
        }
        // Messages before lastAssistantWithInput are already counted in lastInput
      } else {
        // User messages
        const tokens = messageDisplayTokens(msg as UserMessage, parts)
        if (i > lastAssistantWithInput || lastAssistantWithInput < 0) {
          total += tokens
        }
        // User messages before lastAssistantWithInput are in lastInput
      }
    }

    return total
  })

  const contextLimit = createMemo(() => {
    return contextWindowSize() ?? currentModelInfo()?.limit.context ?? 0
  })

  const contextPct = createMemo(() => {
    const limit = contextLimit()
    const localPct = limit > 0 ? Math.round((localUsedTokens() / limit) * 100) : 0
    const remaining = backendRemainingPct()
    const backendPct = typeof remaining === "number" ? Math.round(100 - remaining) : 0
    return Math.max(0, Math.min(100, Math.max(localPct, backendPct)))
  })

  const usedTokens = createMemo(() => {
    const remaining = backendRemainingPct()
    const limit = contextLimit()
    const local = localUsedTokens()
    if (typeof remaining === "number" && limit > 0) {
      return Math.max(local, Math.max(0, Math.round(limit * ((100 - remaining) / 100))))
    }
    return local
  })

  const barWidth = createMemo(() => {
    const width = dimensions().width
    if (width < 50) return 8
    if (width < 70) return 12
    if (width < 90) return 16
    if (width < 110) return 20
    return 24
  })

  const progressBar = createMemo(() => createProgressBar(contextPct(), barWidth()))
  const userName = createMemo(() => kv.get("pakalon_user_name", "Authenticated user"))
  const accent = createMemo(() => theme.warning)
  const remainingTokens = createMemo(() => {
    if (!contextLimit()) return 0
    return Math.max(0, contextLimit() - usedTokens())
  })
  const displaySessionID = createMemo(() => {
    if (!isBackendEnabled()) return route.sessionID
    return backendSessionID() ?? route.sessionID
  })

  createEffect(
    on(
      () => route.sessionID,
      (localSessionID) => {
        if (!isBackendEnabled()) {
          setBackendSessionID(undefined)
          return
        }

        let active = true
        const refresh = async () => {
          let mapped = await BackendSessionSync.getBackendSessionID(localSessionID).catch(() => undefined)
          if (!mapped) {
            mapped = await BackendSessionSync.ensureSession({
              localSessionID,
              title: session()?.title,
              modelID: displayedModelID(),
            }).catch(() => undefined)
          }
          if (!active) return
          setBackendSessionID(mapped)
        }

        void refresh()
        const timer = setInterval(() => {
          void refresh()
        }, 2000)

        onCleanup(() => {
          active = false
          clearInterval(timer)
        })
      },
    ),
  )

  createEffect(() => {
    const modelID = displayedModelID()
    if (!modelID) return

    void refreshContextUsage(modelID)

    const timer = setInterval(() => {
      void refreshContextUsage(modelID)
    }, 15000)

    onCleanup(() => clearInterval(timer))
  })

  return {
    accent,
    contextLimit,
    contextPct,
    dimensions,
    displaySessionID,
    displayedModelLabel,
    messages,
    narrow,
    progressBar,
    remainingTokens,
    theme,
    usedTokens,
    userName,
    verySmall,
  }
}

export type SessionHeaderState = ReturnType<typeof createSessionHeaderState>

export function Header(props: { state?: SessionHeaderState } = {}) {
  const state = props.state ?? createSessionHeaderState()
  const displayVersion = createMemo(() =>
    Installation.VERSION.startsWith("v") ? Installation.VERSION : `v${Installation.VERSION}`,
  )

  return (
    <box>
      <Show
        when={!state.verySmall()}
        fallback={
          <box
            border
            borderColor={state.accent()}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
            backgroundColor={state.theme.backgroundPanel}
          >
            <text fg={state.accent()}>
              <span style={{ bold: true }}>Pakalon</span>{" "}
              <span style={{ fg: state.theme.textMuted }}>{displayVersion()}</span>
            </text>
            <text fg={state.theme.textMuted}>
              {state.userName()} · {state.displayedModelLabel().slice(0, 15)}
            </text>
            <text fg={state.theme.textMuted}>
              <span style={{ fg: state.accent(), bold: true }}>Session ID</span> {state.displaySessionID()}
            </text>
          </box>
        }
      >
        <box
          border
          borderColor={state.accent()}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="column"
          gap={1}
          backgroundColor={state.theme.backgroundPanel}
        >
          <box flexDirection={state.narrow() ? "column" : "row"} justifyContent="space-between" gap={1}>
            <box flexDirection="column" gap={0}>
              <text fg={state.theme.text}>
                <span style={{ fg: state.accent(), bold: true }}>User</span> {state.userName()}
              </text>
              <text fg={state.theme.textMuted}>
                <span style={{ fg: state.accent(), bold: true }}>Model</span> {state.displayedModelLabel()}
              </text>
              <text fg={state.theme.textMuted}>
                <span style={{ fg: state.accent(), bold: true }}>Session ID</span> {state.displaySessionID()}
              </text>
              <text fg={state.theme.textMuted}>
                <span style={{ fg: state.accent(), bold: true }}>Version</span> {displayVersion()}
              </text>
            </box>
          </box>
        </box>
      </Show>
    </box>
  )
}

export function SessionContextBar(props: { state?: SessionHeaderState } = {}) {
  const state = props.state ?? createSessionHeaderState()

  return (
    <box paddingTop={0} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={state.accent()}>Context</text>
        <text>
          <span style={{ fg: state.accent() }}>{state.progressBar().filled}</span>
          <span style={{ fg: state.theme.textMuted }}>{state.progressBar().empty}</span>
        </text>
        <text fg={state.accent()}>{state.contextPct()}%</text>
        <Show when={state.contextLimit() > 0}>
          <text fg={state.theme.text}>
            {state.usedTokens().toLocaleString()} / {state.contextLimit().toLocaleString()}
          </text>
        </Show>
        <Show when={state.contextLimit() > 0}>
          <text fg={state.theme.textMuted}>{state.remainingTokens().toLocaleString()} left</text>
        </Show>
      </box>
    </box>
  )
}
