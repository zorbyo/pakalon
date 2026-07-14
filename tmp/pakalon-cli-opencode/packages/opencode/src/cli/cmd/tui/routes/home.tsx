import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useLocal } from "../context/local"
import { Auth } from "@/auth"
import { DeviceCodeFlow } from "@/auth/device-code"
import { useToast } from "../ui/toast"
import open from "open"
import { isBackendEnabled } from "@/backend/types"
import { RGBA } from "@opentui/core"
import { ACCENT } from "@/cli/ui"
import * as Backend from "@/backend"
import { Plan } from "@/auth/plan"
import { useTerminalDimensions } from "@opentui/solid"

// TODO: what is the best way to do this?
let once = false
const PREFERRED_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

function modelNameFromID(modelID: string) {
  const withoutTier = modelID.split(":")[0] ?? modelID
  const slash = withoutTier.lastIndexOf("/")
  return slash >= 0 ? withoutTier.slice(slash + 1) : withoutTier
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const local = useLocal()
  const toast = useToast()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const dimensions = useTerminalDimensions()
  
  // Responsive breakpoints for small terminals
  const isSmallTerminal = createMemo(() => dimensions().width < 50 || dimensions().height < 12)
  const isCompact = createMemo(() => dimensions().width < 70)
  const maxContentWidth = createMemo(() => {
    const width = dimensions().width
    if (isSmallTerminal()) return Math.max(28, width - 2)
    if (isCompact()) return Math.max(40, width - 2)
    return Math.min(75, width - 4)
  })
  
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })
  const latestSessionID = createMemo(() => {
    const sessions = sync.data.session
    if (sessions.length === 0) return undefined
    return sessions.toSorted((a, b) => b.time.updated - a.time.updated)[0]?.id
  })
  const displaySessionID = createMemo(() => {
    const id = latestSessionID()
    if (!id) return "new"
    return isSmallTerminal() ? id.slice(0, 12) : id
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const [authChecking, setAuthChecking] = createSignal(true)
  const [authRequired, setAuthRequired] = createSignal(false)
  const [authenticating, setAuthenticating] = createSignal(false)
  const [authError, setAuthError] = createSignal<string>()
  const [deviceCode, setDeviceCode] = createSignal<Awaited<ReturnType<typeof DeviceCodeFlow.generate>>>()
  const [deviceStatus, setDeviceStatus] = createSignal<"pending" | "authorized" | "expired" | "denied">("pending")

  const needsLogin = createMemo(() => isBackendEnabled() && isFirstTimeUser() && !authChecking() && authRequired())
  const userName = createMemo(() => kv.get("pakalon_user_name", ""))
  const [contextRemainingPct, setContextRemainingPct] = createSignal<number | null>(null)
  const [contextWindowSize, setContextWindowSize] = createSignal<number | null>(null)
  const [selectedModelName, setSelectedModelName] = createSignal<string>()
  const displayedModelID = createMemo(() => local.model.current()?.modelID ?? PREFERRED_DEFAULT_MODEL)
  const displayedModelLabel = createMemo(() => {
    const modelID = displayedModelID()
    const name = selectedModelName()?.trim()
    return name || modelNameFromID(modelID)
  })
  const currentModelInfo = createMemo(() => {
    const current = local.model.current()
    if (!current) return
    return sync.data.provider.find((x) => x.id === current.providerID)?.models[current.modelID]
  })

  // Calculate actual token usage from messages (not context percentage)
  // Only count OUTPUT + REASONING from assistant messages to avoid
  // double-counting INPUT tokens which represent full conversation history.
  const allMessages = createMemo(() => {
    const messages: Array<{ role: string; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } }> = []
    for (const sessionId of Object.keys(sync.data.message)) {
      const sessionMessages = sync.data.message[sessionId] ?? []
      for (const msg of sessionMessages) {
        if (msg.role === "assistant" && msg.tokens) {
          messages.push(msg as any)
        }
      }
    }
    return messages
  })

  const totalTokensUsed = createMemo(() => {
    const msgs = allMessages()
    if (msgs.length === 0) return 0
    // Find the most recent assistant with input tokens - use that input as the base
    // since it represents the full context at that point
    let lastInput = 0
    for (let i = msgs.length - 1; i >= 0; i--) {
      const input = msgs[i].tokens?.input ?? 0
      if (input > 0) {
        lastInput = input
        break
      }
    }
    // Sum outputs (new content) + the most recent input (full context base)
    const outputs = msgs.reduce((sum, msg) => {
      return sum + (msg.tokens.output || 0) + (msg.tokens.reasoning || 0)
    }, 0)
    // If we have a known input, use it as base + outputs after that message
    // Otherwise just use outputs
    if (lastInput > 0) {
      return lastInput + outputs
    }
    return outputs
  })

  const contextUsedPct = createMemo(() => {
    const remaining = contextRemainingPct()
    if (remaining == null) return null
    return Math.max(0, Math.min(100, 100 - remaining))
  })

  const contextLimit = createMemo(() => contextWindowSize() ?? currentModelInfo()?.limit.context ?? null)

  const contextPercent = createMemo(() => {
    // For fresh app start with no messages, always show 0
    const totalUsed = totalTokensUsed()
    const limit = contextLimit()
    
    // Only compute from actual session tokens
    if (totalUsed > 0 && limit && limit > 0) {
      return Math.min(100, Math.round((totalUsed / limit) * 100))
    }
    
    // No messages = 0% usage (fresh start)
    return 0
  })

  const contextUsedTokens = createMemo(() => {
    // Only show tokens actually used in current session
    return totalTokensUsed()
  })

  const refreshContextUsage = async (modelID: string) => {
    if (!isBackendEnabled()) {
      setContextRemainingPct(null)
      setContextWindowSize(currentModelInfo()?.limit.context ?? null)
      setSelectedModelName(currentModelInfo()?.name ?? modelID)
      return
    }

    try {
      const [status, models] = await Promise.all([
        Plan.getContextStatus(modelID),
        Backend.ModelsBackend.listModels().catch(() => undefined),
      ])
      setContextRemainingPct(status.remainingPct ?? 100)

      const selected = models?.models.find((item) => {
        const id = item.id ?? item.model_id ?? item.name
        return id === modelID
      })
      setContextWindowSize(
        selected?.context_length ?? selected?.top_provider?.context_length ?? currentModelInfo()?.limit.context ?? null,
      )
      setSelectedModelName(selected?.name ?? currentModelInfo()?.name ?? modelID)
    } catch {
      setContextRemainingPct(null)
      setContextWindowSize(currentModelInfo()?.limit.context ?? null)
      setSelectedModelName(currentModelInfo()?.name ?? modelID)
    }
  }

  createEffect(() => {
    const modelID = displayedModelID()

    void refreshContextUsage(modelID)

    if (!isBackendEnabled()) return

    const timer = setInterval(() => {
      void refreshContextUsage(modelID)
    }, 15000)

    onCleanup(() => clearInterval(timer))
  })

  const checkAuth = async () => {
    try {
      if (!isBackendEnabled()) {
        kv.set("pakalon_auth_status", "authenticated")
        setAuthRequired(false)
        return
      }
      const auth = await Auth.get("pakalon")
      const authenticated = !!auth
      kv.set("pakalon_auth_status", authenticated ? "authenticated" : "unauthenticated")
      setAuthRequired(!authenticated)
    } catch {
      kv.set("pakalon_auth_status", "unauthenticated")
      setAuthRequired(true)
    } finally {
      setAuthChecking(false)
    }
  }

  const openLoginUrl = (targetUrl?: string) => {
    if (!targetUrl) return
    open(targetUrl).catch(() => {
      toast.show({
        variant: "warning",
        message: `Could not open browser automatically. Open ${targetUrl} manually.`,
      })
    })
  }

  const openLogin = () => {
    openLoginUrl(deviceCode()?.url)
  }

  const startDeviceAuth = async () => {
    setAuthenticating(true)
    setAuthError(undefined)
    setDeviceStatus("pending")
    try {
      const code = await DeviceCodeFlow.generate()
      setDeviceCode(code)
      openLoginUrl(code.url)
      const result = await DeviceCodeFlow.waitForAuth(code, (status) => {
        setDeviceStatus(status.status)
      })

      if (result.status !== "authorized" || !result.accessToken) {
        setAuthError(`Login failed: ${result.status}`)
        kv.set("pakalon_auth_status", "unauthenticated")
        return
      }

      await Auth.set("pakalon", {
        type: "api",
        key: result.accessToken,
      })
      Backend.getClient().setToken(result.accessToken)

      const identity = result.user?.github_login || result.user?.email || "Authenticated user"
      kv.set("pakalon_user_name", identity)
      kv.set("pakalon_auth_status", "authenticated")
      setAuthRequired(false)
      toast.show({
        variant: "success",
        message: `Logged in as ${identity}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed"
      setAuthError(message)
      kv.set("pakalon_auth_status", "unauthenticated")
    } finally {
      setAuthenticating(false)
    }
  }

  createEffect(
    on(
      () => sync.ready,
      async (ready) => {
        if (!ready) return
        await checkAuth()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      needsLogin,
      (required) => {
        if (!required) return
        if (deviceCode()) return
        if (authenticating()) return
        void startDeviceAuth()
      },
      { defer: true },
    ),
  )

  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (needsLogin()) return
    if (once) return
    if (!prompt) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(
    on(
      () => sync.ready && local.model.ready,
      (ready) => {
        if (!ready) return
        if (needsLogin()) return
        if (!args.prompt) return
        if (prompt.current?.input !== args.prompt) return
        prompt.submit()
      },
    ),
  )
  const directory = useDirectory()

  // Ultra-small terminal detection (height < 10 or width < 35)
  const isUltraSmall = createMemo(() => dimensions().height < 10 || dimensions().width < 35)
  
  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2} paddingRight={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}>
        <box flexGrow={1} minHeight={0} />

        <Show
          when={needsLogin()}
          fallback={
            <box flexDirection="column" alignItems="center" width="100%">
              <box
                border={!isSmallTerminal()}
                borderColor={ACCENT}
                flexDirection="column"
                paddingLeft={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}
                paddingRight={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}
                paddingTop={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
                paddingBottom={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
                width="100%"
                maxWidth={maxContentWidth()}
                gap={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
              >
                <Show when={!isUltraSmall()}>
                  <box flexShrink={0} paddingBottom={isSmallTerminal() ? 0 : 1} alignItems="center">
                    <Logo />
                  </box>
                </Show>
                <text fg={theme.text}>
                  <Show when={!isSmallTerminal()}>
                    <span style={{ fg: theme.textMuted }}>User: </span>
                  </Show>
                  <span style={{ fg: ACCENT, bold: true }}>{userName() || "Guest"}</span>
                  <Show when={!isSmallTerminal()}>
                    <span style={{ fg: theme.textMuted }}> | Model: </span>
                    <span style={{ fg: ACCENT, bold: true }}>{displayedModelLabel()}</span>
                    <span style={{ fg: theme.textMuted }}> | Session ID: </span>
                    <span style={{ fg: ACCENT, bold: true }}>{displaySessionID()}</span>
                  </Show>
                  <Show when={isSmallTerminal()}>
                    <span style={{ fg: theme.textMuted }}> | </span>
                    <span style={{ fg: ACCENT, bold: true }}>{displaySessionID()}</span>
                  </Show>
                </text>
                <Show when={!isSmallTerminal()}>
                  <text fg={theme.textMuted}>{Installation.VERSION}</text>
                </Show>
              </box>
              <box width="100%" maxWidth={maxContentWidth()} paddingTop={isSmallTerminal() ? 0 : 1}>
                <Show when={!isSmallTerminal()}>
                  <text fg={theme.textMuted}>Context usage · {displayedModelLabel()}</text>
                </Show>
                <text fg={theme.text}>
                  {(() => {
                    const barWidth = isSmallTerminal() ? 6 : (isCompact() ? 10 : 18)
                    const pct = contextPercent()
                    const filled = Math.round((pct / 100) * barWidth)
                    const used = contextUsedTokens()
                    const limit = contextLimit()
                    return (
                      <>
                        <span style={{ fg: ACCENT }}>{"█".repeat(filled)}</span>
                        <span style={{ fg: theme.textMuted }}>{"░".repeat(Math.max(0, barWidth - filled))}</span>
                        <span style={{ fg: theme.textMuted }}> {used.toLocaleString()}</span>
                        <Show when={limit != null && !isSmallTerminal()}>
                          <span style={{ fg: theme.textMuted }}> / {limit?.toLocaleString()} tokens · {pct}%</span>
                        </Show>
                      </>
                    )
                  })()}
                </text>
              </box>
              <box width="100%" maxWidth={maxContentWidth()} zIndex={1000} paddingTop={isSmallTerminal() ? 0 : 1} flexShrink={0}>
                <Prompt
                  ref={(r) => {
                    prompt = r
                    promptRef.set(r)
                  }}
                  hint={Hint}
                  workspaceID={route.workspaceID}
                />
              </box>
              <box
                height={1}
                minHeight={0}
                width="100%"
                maxWidth={maxContentWidth()}
                alignItems="center"
                paddingTop={isSmallTerminal() ? 0 : 1}
                flexShrink={1}
              >
                <Show when={showTips()}>
                  <Tips />
                </Show>
              </box>
            </box>
          }
        >
          <box
            width="100%"
            maxWidth={maxContentWidth()}
            border={!isSmallTerminal()}
            borderColor={ACCENT}
            flexDirection="column"
            alignItems="center"
            paddingLeft={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}
            paddingRight={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}
            paddingTop={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
            paddingBottom={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
            gap={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1}
          >
            <Show when={!isUltraSmall()}>
              <Logo />
            </Show>
            <text fg={theme.text}>
              <span style={{ bold: true }}>First-time login required</span>
            </text>
            <Show when={!isSmallTerminal()}>
              <text fg={theme.textMuted}>Open the login URL and enter this 6-digit code.</text>
            </Show>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={openLogin}
            >
              <text fg={ACCENT}>
                {deviceCode()?.url || "Generating authentication URL..."}
                <Show when={!isSmallTerminal()}>
                  <span style={{ fg: theme.textMuted }}> (click to open)</span>
                </Show>
              </text>
            </box>
            <box border borderColor={ACCENT} justifyContent="center" alignItems="center" paddingTop={isSmallTerminal() ? 0 : 1} paddingBottom={isSmallTerminal() ? 0 : 1} width={20} onMouseUp={openLogin}>
              <text fg={theme.text}>
                <span style={{ fg: ACCENT, bold: true }}>
                  {deviceCode() ? DeviceCodeFlow.formatCode(deviceCode()!.code) : "......"}
                </span>
              </text>
            </box>
            <Show when={userName()}>
              <text fg={theme.textMuted}>Detected user: {userName()}</text>
            </Show>
            <text fg={theme.textMuted}>
              <Switch>
                <Match when={authenticating() && deviceStatus() === "pending"}>Waiting for verification...</Match>
                <Match when={deviceStatus() === "expired"}>Code expired. Please restart login to get a new code.</Match>
                <Match when={authError()}>{authError()}</Match>
                <Match when={true}>Waiting for browser confirmation...</Match>
              </Switch>
            </text>
          </box>
        </Show>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box paddingTop={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1} paddingBottom={isUltraSmall() ? 0 : isSmallTerminal() ? 0 : 1} paddingLeft={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2} paddingRight={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2} flexDirection="row" flexShrink={0} gap={isUltraSmall() ? 0 : isSmallTerminal() ? 1 : 2}>
        <text fg={theme.textMuted}>{isUltraSmall() ? Locale.truncateMiddle(directory(), 15) : isSmallTerminal() ? Locale.truncateMiddle(directory(), 20) : directory()}</text>
        <Show when={!isSmallTerminal()}>
          <box gap={1} flexDirection="row" flexShrink={0}>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                  </Match>
                </Switch>
                {connectedMcpCount()} MCP
              </text>
              <text fg={theme.textMuted}>/status</text>
            </Show>
          </box>
        </Show>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
