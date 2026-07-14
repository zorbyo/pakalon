import { createSignal, createEffect, Show, For, onMount, onCleanup, createMemo } from "solid-js"
import { useAuth } from "@/context/auth"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { Mark } from "@pakalon-ai/ui/logo"
import { Spinner } from "@pakalon-ai/ui/spinner"

type Mode = "plan" | "normal" | "orchestration" | "auto-accept"

const MODES: Mode[] = ["plan", "normal", "orchestration", "auto-accept"]

export function UserInfoHeader(props: { embedded?: boolean; working?: boolean } = {}) {
  const auth = useAuth()
  const local = useLocal()
  const platform = usePlatform()
  const sync = useSync()
  const { params } = useSessionLayout()
  
  const [mode, setMode] = createSignal<Mode>("normal")
  const [filesEdited, setFilesEdited] = createSignal(0)
  const [linesAdded, setLinesAdded] = createSignal(0)
  const [linesRemoved, setLinesRemoved] = createSignal(0)

  const messages = () => params.id ? (sync.data.message[params.id] ?? []) : []
  
  const metrics = () => getSessionContextMetrics(messages(), sync.data.provider.all)
  
  const contextUsage = () => {
    // Only show token usage if there are messages
    const hasMessages = messages().length > 0
    if (!hasMessages) {
      return { used: 0, total: 100000, percentage: 0 }
    }
    
    const ctx = metrics().context
    if (!ctx) {
      return { used: 0, total: 100000, percentage: 0 }
    }
    
    const total = ctx.limit ?? 100000
    const used = ctx.total ?? 0
    const percentage = total > 0 ? (used / total) * 100 : 0
    
    return { used, total, percentage: Math.min(percentage, 100) }
  }

  createEffect(() => {
    const sessionInfo = params.id ? sync.session.get(params.id) : undefined
    if (sessionInfo?.summary) {
      setFilesEdited(sessionInfo.summary.files ?? 0)
      setLinesAdded(sessionInfo.summary.linesAdded ?? 0)
      setLinesRemoved(sessionInfo.summary.linesRemoved ?? 0)
    }
  })

  const cycleMode = () => {
    const currentIndex = MODES.indexOf(mode())
    const nextIndex = (currentIndex + 1) % MODES.length
    setMode(MODES[nextIndex])
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key === "Tab") {
      e.preventDefault()
      cycleMode()
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

  // Memoize user info to prevent flickering during route transitions
  const userDisplayName = () => auth.user?.display_name ?? "User"
  const userInitial = () => userDisplayName().charAt(0).toUpperCase()
  const isVisible = () => auth.isAuthenticated && auth.user
  const modelLabel = createMemo(() => local.model.current()?.name ?? "No model")
  const versionLabel = createMemo(() => platform.version ?? "--")

return (
  <div
    class="flex flex-col gap-3 w-full shrink-0"
    classList={{
      "mt-4 z-10": !props.embedded,
      "mt-0": !!props.embedded,
    }}
    style={{ display: isVisible() ? "flex" : "none" }}
  >
    {/* Loading Indicator - appears above chat when working */}
    <Show when={props.working}>
      <div class="flex items-center justify-start gap-2 w-full max-w-lg mx-auto px-2">
        <Spinner class="size-4" style={{ color: "#E8AA41" }} />
        <span class="text-sm font-medium" style={{ color: "#E8AA41" }}>
          pakalon is working
        </span>
      </div>
    </Show>

    <div class="flex flex-col gap-3 w-full max-w-xl mx-auto">
      {/* Pakalon Logo - hidden when working, but user info box stays visible */}
      <Show when={!props.working}>
        <div class="flex items-center justify-center">
          <Mark class="w-8" />
        </div>
      </Show>
      
      <div 
        class="w-full p-3 rounded-lg border-2"
        style={{ 
          "background-color": "rgba(0, 0, 0, 0.5)", 
          "border-color": "#E8AA41" 
        }}
      >
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-[#E8AA41] flex items-center justify-center">
                <span class="text-black font-bold text-sm">
                  {userInitial()}
                </span>
              </div>
              <div class="flex flex-col">
                <span class="text-white text-sm font-medium">{userDisplayName()}</span>
                <span class="text-gray-400 text-xs">Model: {modelLabel()}</span>
              </div>
            </div>
            <div class="text-gray-400 text-xs text-right">
              <div>Session: {params.id?.substring(0, 8) || "New"}</div>
              <div>Version: {versionLabel()}</div>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1">
            <div class="flex items-center gap-1">
              <For each={MODES}>
                {(m) => (
                  <button
                    onClick={() => setMode(m)}
                    class={`px-2 py-0.5 text-xs rounded transition-colors ${
                      mode() === m 
                        ? "bg-[#E8AA41] text-black font-medium" 
                        : "bg-transparent text-gray-400 hover:text-white"
                    }`}
                  >
                    {m}
                  </button>
                )}
              </For>
            </div>
            
            <div class="flex items-center gap-3 text-xs">
              <span class="text-gray-400">
                <span class="text-green-400">+{linesAdded()}</span> / 
                <span class="text-red-400">-{linesRemoved()}</span>
              </span>
              <span class="text-gray-400">
                {filesEdited()} files
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1 px-1">
        <div class="flex justify-between text-xs">
          <span class="text-gray-400">Context</span>
          <span class="text-gray-400">
            {contextUsage().used.toLocaleString()} / {contextUsage().total.toLocaleString()}
          </span>
        </div>
        <div class="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div 
            class="h-full transition-all duration-300"
            style={{ 
              width: `${contextUsage().percentage}%`,
              "background-color": "#E8AA41"
            }}
          />
        </div>
      </div>
    </div>
    </div>
  )
}
