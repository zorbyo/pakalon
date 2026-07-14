import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, t, dim, fg } from "@opentui/core"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@pakalon-ai/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogTelegramConnect, startTelegramRemoteInput } from "../dialog-telegram-connect"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogSkill } from "../dialog-skill"
import { Plan } from "@/auth/plan"
import { Auth } from "@/auth"
import * as Backend from "@/backend"
import { isBackendEnabled } from "@/backend/types"
import * as CommandDispatcher from "@/command/dispatcher"
import { retrieveTelegramToken } from "@/telegram/token-store"
import {
  applyInteractionMode,
  interactionModeColor,
  nextInteractionMode,
  type InteractionMode,
} from "../../routes/session/interaction-mode"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]
const SHELL_PLACEHOLDERS = ["ls -la", "git status", "pwd"]
const PREFERRED_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
const BACKEND_PROVIDER_ID = "openrouter"

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  let interruptResetTimer: ReturnType<typeof setTimeout> | undefined
  let lastEscapeAt = 0

  onCleanup(() => {
    if (interruptResetTimer) clearTimeout(interruptResetTimer)
  })

  const triggerSessionInterrupt = async () => {
    if (!autocomplete || autocomplete.visible) return
    if (!input || input.isDestroyed || !input.focused) return
    if (store.mode === "shell") {
      setStore("mode", "normal")
      return
    }
    if (!props.sessionID) return

    const nextInterruptCount = store.interrupt + 1
    setStore("interrupt", nextInterruptCount)

    if (interruptResetTimer) clearTimeout(interruptResetTimer)
    interruptResetTimer = setTimeout(() => {
      setStore("interrupt", 0)
      interruptResetTimer = undefined
    }, 5000)

    if (nextInterruptCount >= 2) {
      await sdk.client.session
        .abort({
          sessionID: props.sessionID,
        })
        .catch(() => {})
      setStore("interrupt", 0)
      if (interruptResetTimer) {
        clearTimeout(interruptResetTimer)
        interruptResetTimer = undefined
      }
    }
  }

  const moveCursorToLineBoundary = (direction: "home" | "end") => {
    if (!input || input.isDestroyed) return
    const currentText = input.plainText
    const cursor = input.cursorOffset
    const lineStart = Math.max(0, currentText.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1)
    const nextBreak = currentText.indexOf("\n", cursor)
    const lineEnd = nextBreak === -1 ? currentText.length : nextBreak
    input.cursorOffset = direction === "home" ? lineStart : lineEnd
  }

  useKeyboard((e) => {
    if (props.disabled) return
    if (!input || input.isDestroyed || !input.focused) return
    if (e.name !== "home" && e.name !== "end") return
    moveCursorToLineBoundary(e.name)
    e.preventDefault()
    e.stopPropagation?.()
  })

  function promptModelWarning() {
    if (isBackendEnabled()) {
      toast.show({
        variant: "warning",
        message: "No model available yet. Run /models to choose one.",
        duration: 3000,
      })
      return
    }

    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  // Debounced render to prevent flickering from multiple rapid updates
  let renderTimeout: ReturnType<typeof setTimeout> | undefined
  const debouncedRender = () => {
    if (renderTimeout) clearTimeout(renderTimeout)
    renderTimeout = setTimeout(() => {
      renderTimeout = undefined
      if (!renderer.isDestroyed) renderer.requestRender()
    }, 16)
  }

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    const properties = evt.properties as { text: string; submit?: boolean }
    if (!input || input.isDestroyed) return
    input.insertText(properties.text)
    queueMicrotask(() => {
      if (!input || input.isDestroyed) return
      input.gotoBufferEnd()
      debouncedRender()
      if (properties.submit) submit()
    })
  })

  createEffect(() => {
    input.cursorColor = theme.textMuted
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })
  const [activeSkill, setActiveSkill] = createSignal<string>()
  const [interactionMode, setInteractionMode] = kv.signal<InteractionMode>("interaction_mode", "build")

  const cycleInteractionMode = () => {
    const next = nextInteractionMode(interactionMode())
    setInteractionMode(next)
    applyInteractionMode(next, local)
  }

  onMount(() => {
    void retrieveTelegramToken()
      .then((existing) => {
        if (existing) startTelegramRemoteInput(existing.token)
      })
      .catch(() => undefined)
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      }
    }
  })

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: async (dialog) => {
          await triggerSessionInterrupt()
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                setActiveSkill(skill)
                clearPromptInput()
                input.focus()
                toast.show({
                  variant: "info",
                  message: `Skill selected: /${skill}. Type your prompt to use it.`,
                  duration: 3000,
                })
              }}
            />
          ))
        },
      },
      // Pakalon Commands - handled by command dispatcher
      {
        title: "Initialize Pakalon Pipeline",
        value: "pakalon.init",
        category: "Pakalon",
        slash: { name: "pakalon" },
        onSelect: () => {
          input.setText("/pakalon ")
          setStore("prompt", { input: "/pakalon ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Start Phase 1 Planning",
        value: "pakalon.phase1",
        category: "Pakalon",
        slash: { name: "init" },
        onSelect: () => {
          input.setText("/init ")
          setStore("prompt", { input: "/init ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Update Phase Artifacts",
        value: "pakalon.update",
        category: "Pakalon",
        slash: { name: "update" },
        onSelect: () => {
          input.setText("/update ")
          setStore("prompt", { input: "/update ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Open Penpot Design",
        value: "pakalon.penpot",
        category: "Pakalon",
        slash: { name: "penpot" },
        onSelect: () => {
          input.setText("/penpot")
          setStore("prompt", { input: "/penpot", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Toggle Thinking Mode",
        value: "pakalon.think",
        category: "Pakalon",
        slash: { name: "think" },
        onSelect: () => {
          input.setText("/think")
          setStore("prompt", { input: "/think", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Manage MCP Servers",
        value: "pakalon.mcp",
        category: "Pakalon",
        slash: { name: "mcp" },
        onSelect: () => {
          input.setText("/mcp ")
          setStore("prompt", { input: "/mcp ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Run Automation",
        value: "pakalon.automations",
        category: "Pakalon",
        slash: { name: "automations" },
        onSelect: () => {
          input.setText("/automations ")
          setStore("prompt", { input: "/automations ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Manage Agent Teams",
        value: "pakalon.agents",
        category: "Pakalon",
        slash: { name: "agents" },
        onSelect: () => {
          input.setText("/agents ")
          setStore("prompt", { input: "/agents ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Manage Single Agent",
        value: "pakalon.agent",
        category: "Pakalon",
        slash: { name: "agent" },
        onSelect: () => {
          input.setText("/agent ")
          setStore("prompt", { input: "/agent ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Import Figma Designs",
        value: "pakalon.figma",
        category: "Pakalon",
        slash: { name: "figma" },
        onSelect: () => {
          input.setText("/figma ")
          setStore("prompt", { input: "/figma ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Open Workflows",
        value: "pakalon.workflows",
        category: "Pakalon",
        slash: { name: "workflows" },
        onSelect: () => {
          input.setText("/workflows ")
          setStore("prompt", { input: "/workflows ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Show Directory Info",
        value: "pakalon.directory",
        category: "Pakalon",
        slash: { name: "directory" },
        onSelect: () => {
          input.setText("/directory")
          setStore("prompt", { input: "/directory", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Opens and searches across internet",
        value: "pakalon.web",
        category: "Pakalon",
        slash: { name: "web" },
        onSelect: () => {
          setActiveSkill("web")
          clearPromptInput()
          input.focus()
          toast.show({
            variant: "info",
            message: "Web search selected. Type a query to search.",
            duration: 3000,
          })
          dialog.clear()
        },
      },
      {
        title: "Manage Plugins",
        value: "pakalon.plugins",
        category: "Pakalon",
        slash: { name: "plugins" },
        onSelect: () => {
          input.setText("/plugins ")
          setStore("prompt", { input: "/plugins ", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
      {
        title: "Show Context Usage",
        value: "pakalon.context",
        category: "Pakalon",
        slash: { name: "context" },
        onSelect: () => {
          input.setText("/context")
          setStore("prompt", { input: "/context", parts: [] })
          input.gotoBufferEnd()
          dialog.clear()
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setActiveSkill(undefined)
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) input?.focus()
    if (props.visible === false) input?.blur()
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogStash
            onSelect={(entry) => {
              input.setText(entry.input)
              setStore("prompt", { input: entry.input, parts: entry.parts })
              restoreExtmarksFromParts(entry.parts)
              input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
  ])

  const fallbackModel = () => {
    if (isBackendEnabled()) {
      return {
        providerID:
          sync.data.provider.find((provider) => provider.id === BACKEND_PROVIDER_ID)?.id ?? BACKEND_PROVIDER_ID,
        modelID: PREFERRED_DEFAULT_MODEL,
      }
    }

    const preferredProvider = sync.data.provider.find((provider) => provider.models[PREFERRED_DEFAULT_MODEL])
    if (preferredProvider) {
      return {
        providerID: preferredProvider.id,
        modelID: PREFERRED_DEFAULT_MODEL,
      }
    }

    const provider = sync.data.provider[0]
    if (!provider) return undefined
    const modelID = sync.data.provider_default[provider.id] ?? Object.values(provider.models)[0]?.id
    if (!modelID) return undefined

    return {
      providerID: provider.id,
      modelID,
    }
  }

  const clearPromptInput = () => {
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    input.clear()
  }

  const clearActiveSelection = () => {
    setActiveSkill(undefined)
    clearPromptInput()
    if (input && !input.isDestroyed) input.focus()
  }

  const appendCurrentPromptToHistory = () => {
    history.append({
      ...store.prompt,
      mode: store.mode,
    })
  }

  const shouldUseDialogForCommandResult = (commandName: string, message: string) => {
    if (!message) return false
    if (message.length > 160 || message.includes("\n")) return true
    return ["skills", "automations", "session", "status", "doctor", "sessions"].includes(commandName)
  }

  const handleLogoutSlash = async () => {
    let revokeErrorMessage: string | undefined

    if (isBackendEnabled()) {
      try {
        await Backend.AuthBackend.logout()
      } catch (error) {
        revokeErrorMessage = error instanceof Error ? error.message : String(error)
      }
    }

    await Auth.remove("pakalon").catch(() => undefined)
    Plan.clearCache()
    kv.set("pakalon_auth_status", "unauthenticated")
    kv.set("pakalon_user_name", "")

    toast.show({
      variant: revokeErrorMessage ? "warning" : "success",
      message: revokeErrorMessage ? `Logged out locally. ${revokeErrorMessage}` : "Logged out successfully.",
      duration: 4000,
    })

    route.navigate({ type: "home" })
    clearPromptInput()
  }

  const handleLocalSlashCommand = async (trimmedInput: string) => {
    const parsed = CommandDispatcher.parseCommand(trimmedInput)
    if (!parsed) return false

    if (parsed.name === "web" && !parsed.args.trim()) {
      appendCurrentPromptToHistory()
      setActiveSkill("web")
      clearPromptInput()
      input.focus()
      toast.show({
        variant: "info",
        message: "Web search selected. Type a query to search.",
        duration: 3000,
      })
      return true
    }

    // Check if this is a local command
    if (!CommandDispatcher.isLocalCommand(parsed.name)) {
      return false
    }

    // Special handling for commands that need UI interaction
    if (parsed.name === "models") {
      appendCurrentPromptToHistory()
      command.trigger("model.list")
      clearPromptInput()
      return true
    }

    if (parsed.name === "logout") {
      appendCurrentPromptToHistory()
      await handleLogoutSlash()
      return true
    }

    if (parsed.name === "connect" && !parsed.args.trim()) {
      appendCurrentPromptToHistory()
      dialog.replace(() => <DialogTelegramConnect />)
      clearPromptInput()
      return true
    }

    if (parsed.name === "history") {
      // Let the server handle this
      return false
    }

    if (parsed.name === "session") {
      // Let the server handle this
      return false
    }

    if (parsed.name === "undo") {
      // Let the existing undo handler work
      return false
    }

    if (parsed.name === "new") {
      // Let the server handle this
      return false
    }

    // Execute Pakalon commands locally
    const result = await CommandDispatcher.executeLocalCommand(parsed.name, parsed.args)

    appendCurrentPromptToHistory()

    if (result.success) {
      if (shouldUseDialogForCommandResult(parsed.name, result.message)) {
        DialogAlert.show(dialog, `/${parsed.name}`, result.message)
      } else {
        toast.show({
          message: result.message,
          variant: "success",
          duration: 3000,
        })
      }

      if (result.shouldClearPrompt !== false) {
        clearPromptInput()
      }
    } else {
      DialogAlert.show(dialog, `/${parsed.name}`, result.message)
    }

    return true
  }

  const isKnownSlashCommand = (value: string) => {
    const parsed = CommandDispatcher.parseCommand(value.trimStart())
    if (!parsed) return false
    return CommandDispatcher.isLocalCommand(parsed.name) || sync.data.command.some((x) => x.name === parsed.name)
  }

  const activeCommand = createMemo(() => {
    const value = store.prompt.input.trimStart()
    if (!value.startsWith("/")) return
    const parsed = CommandDispatcher.parseCommand(value)
    if (!parsed?.name) return
    if (!CommandDispatcher.isLocalCommand(parsed.name) && !sync.data.command.some((x) => x.name === parsed.name)) return
    return parsed.name
  })

  async function submit() {
    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }

    if (trimmed.startsWith("/") && (await handleLocalSlashCommand(trimmed))) {
      return
    }

    let selectedModel = local.model.current()

    if (!selectedModel && isBackendEnabled()) {
      const providerID =
        sync.data.provider.find((provider) => provider.id === BACKEND_PROVIDER_ID)?.id ?? BACKEND_PROVIDER_ID
      const autoModelID = await Backend.ModelsBackend.getAutoModel()
        .then((model) => model.id ?? model.model_id ?? model.name)
        .catch(() => undefined)

      if (autoModelID) {
        selectedModel = {
          providerID,
          modelID: autoModelID,
        }
      }
    }

    if (!selectedModel) {
      selectedModel = fallbackModel()
    }

    if (!selectedModel) {
      promptModelWarning()
      return
    }

    if (!local.model.current()) {
      local.model.set(selectedModel)
    }

    const startup = await Plan.checkStartupAllowed()
    if (!startup.allowed) {
      toast.show({
        variant: "error",
        message: startup.reason || "You cannot start a new interaction right now.",
      })
      return
    }

    const context = await Plan.getContextStatus(selectedModel.modelID)
    if (context.exhausted) {
      if (isBackendEnabled()) {
        await Backend.ModelsBackend.refreshModels().catch(() => undefined)
        Plan.clearCache()

        const refreshed = await Backend.ModelsBackend.listModels().catch(() => undefined)
        const planName = refreshed?.plan === "pro" ? "pro" : "free"
        const fallbackID = refreshed
          ? Backend.ModelsBackend.filterByPlan(refreshed.models, planName)
              .map((model) => model.id ?? model.model_id ?? model.name)
              .find((modelID) => Boolean(modelID) && modelID !== selectedModel.modelID)
          : undefined

        if (fallbackID) {
          selectedModel = {
            providerID: selectedModel.providerID || BACKEND_PROVIDER_ID,
            modelID: fallbackID,
          }
          local.model.set(selectedModel, { recent: true })

          const refreshedContext = await Plan.getContextStatus(selectedModel.modelID)
          if (refreshedContext.exhausted) {
            toast.show({
              variant: "error",
              message:
                refreshedContext.message ||
                `Context window exhausted for model ${selectedModel.modelID}. Please choose another model with /models.`,
            })
            return
          }

          toast.show({
            variant: "warning",
            message: `Previous model reached context limits. Switched to ${selectedModel.modelID}.`,
            duration: 4500,
          })
        } else {
          toast.show({
            variant: "error",
            message:
              context.message ||
              `Context window exhausted for model ${selectedModel.modelID}. No fallback model found; run /models.`,
          })
          return
        }
      } else {
        toast.show({
          variant: "error",
          message: context.message || `Context window exhausted for model ${selectedModel.modelID}`,
        })
        return
      }
    }

    let sessionID = props.sessionID
    if (sessionID == null) {
      const res = await sdk.client.session.create({
        workspaceID: props.workspaceID,
      })

      if (res.error) {
        toast.show({
          message: "Creating a session failed. Open console for more details.",
          variant: "error",
        })

        return
      }

      sessionID = res.data.id
    }

    const messageID = MessageID.ascending()
    let inputText = store.prompt.input

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const [thinkingEnabled] = kv.signal("thinking_mode", false)
    const hasReasoningVariants = local.model.variant.list().length > 0
    const variant = thinkingEnabled() && hasReasoningVariants ? local.model.variant.current() : undefined
    const selectedSkill = activeSkill()
    const activeSkillCommand = selectedSkill ? sync.data.command.find((x) => x.name === selectedSkill) : undefined
    const startsWithSlash = inputText.trimStart().startsWith("/")
    const shouldApplyActiveSkill =
      activeSkillCommand !== undefined &&
      inputText.trim().length > 0 &&
      (!startsWithSlash || !isKnownSlashCommand(inputText))

    if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (shouldApplyActiveSkill && activeSkillCommand) {
      sdk.client.session.command({
        sessionID,
        command: activeSkillCommand.name,
        arguments: inputText,
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
        parts: nonTextParts
          .filter((x) => x.type === "file")
          .map((x) => ({
            id: PartID.ascending(),
            ...x,
          })),
      })
    } else if (
      inputText.startsWith("/") &&
      iife(() => {
        const firstLine = inputText.split("\n")[0]
        const command = firstLine.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === command)
      })
    ) {
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
        parts: nonTextParts
          .filter((x) => x.type === "file")
          .map((x) => ({
            id: PartID.ascending(),
            ...x,
          })),
      })
    } else {
      sdk.client.session
        .prompt({
          sessionID,
          ...selectedModel,
          messageID,
          agent: local.agent.current().name,
          model: selectedModel,
          variant,
          parts: [
            {
              id: PartID.ascending(),
              type: "text",
              text: inputText,
            },
            ...nonTextParts.map((x) => ({
              id: PartID.ascending(),
              ...x,
            })),
          ],
        })
        .catch((error) => {
          const message = error?.message || error?.toString() || ""
          if (message.includes("429") || message.includes("rate limit") || message.includes("too many requests")) {
            toast.show({
              variant: "error",
              message: "Rate limit reached. Please wait a moment before sending another message.",
              duration: 5000,
            })
          } else if (message.includes("401") || message.includes("unauthorized")) {
            toast.show({
              variant: "error",
              message: "Authentication error. Please check your API key.",
              duration: 5000,
            })
          } else {
            toast.show({
              variant: "error",
              message: "Failed to send message. Please try again.",
              duration: 5000,
            })
          }
        })
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    clearPromptInput()
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
  }
  const exit = useExit()

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return interactionModeColor(interactionMode(), theme)
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false} flexDirection="column">
        <box
          height={1}
          border={["top"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            horizontal: "─",
          }}
        />
        <Show when={activeSkill() || activeCommand()}>
          <box paddingLeft={1} paddingRight={1} flexShrink={0} flexDirection="row" justifyContent="space-between" gap={1}>
            <Show
              when={activeSkill()}
              fallback={
                <text fg={theme.textMuted}>
                  Command: <span style={{ fg: theme.text }}>/{activeCommand()}</span>
                </text>
              }
            >
              {(skill) => (
                <text fg={theme.textMuted}>
                  Skill: <span style={{ fg: theme.text }}>/{skill()}</span> instruction active
                </text>
              )}
            </Show>
            <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement} onMouseUp={clearActiveSelection}>
              <text fg={theme.text}>Clear</text>
            </box>
          </box>
        </Show>
        <box paddingLeft={1} paddingRight={1} flexShrink={0} flexGrow={1}>
          <textarea
            placeholder={placeholderText()}
            textColor={theme.text}
            focusedTextColor={theme.text}
            minHeight={1}
            maxHeight={3}
            onContentChange={() => {
              // Preserve cursor position to prevent cursor jumping during typing
              const cursorOffset = input.cursorOffset
              const value = input.plainText
              setStore("prompt", "input", value)
              autocomplete.onInput(value)
              syncExtmarksWithPromptParts()
              // Restore cursor if it drifted (workaround for wrapping cursor bugs)
              if (input.cursorOffset !== cursorOffset && cursorOffset <= value.length) {
                input.cursorOffset = cursorOffset
              }
            }}
            keyBindings={textareaKeybindings()}
            onKeyDown={async (e) => {
              if (props.disabled) {
                e.preventDefault()
                return
              }
              if (e.name === "tab" && e.shift) {
                e.preventDefault()
                e.stopPropagation?.()
                cycleInteractionMode()
                return
              }
              // Handle clipboard paste (Ctrl+V) - check for images first on Windows
              // This is needed because Windows terminal doesn't properly send image data
              // through bracketed paste, so we need to intercept the keypress and
              // directly read from clipboard before the terminal handles it
              if (keybind.match("input_paste", e)) {
                const content = await Clipboard.read()
                if (content?.mime.startsWith("image/")) {
                  e.preventDefault()
                  await pasteImage({
                    filename: "clipboard",
                    mime: content.mime,
                    content: content.data,
                  })
                  return
                }
                // If no image, let the default paste behavior continue
              }
              if (keybind.match("input_clear", e) && (store.prompt.input !== "" || activeSkill())) {
                clearActiveSelection()
                return
              }
              if (keybind.match("app_exit", e)) {
                if (store.prompt.input === "") {
                  await exit()
                  // Don't preventDefault - let textarea potentially handle the event
                  e.preventDefault()
                  return
                }
              }
              if (e.name === "home" || e.name === "end") {
                moveCursorToLineBoundary(e.name)
                e.preventDefault()
                e.stopPropagation?.()
                return
              }
              if (e.name === "escape" && status().type !== "idle") {
                const now = Date.now()
                if (now - lastEscapeAt <= 500) {
                  lastEscapeAt = 0
                  e.preventDefault()
                  await triggerSessionInterrupt()
                  return
                }
                lastEscapeAt = now
                e.preventDefault()
                return
              }
              if (e.name === "!" && input.visualCursor.offset === 0) {
                setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
                setStore("mode", "shell")
                e.preventDefault()
                return
              }
              if (store.mode === "shell") {
                if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                  setStore("mode", "normal")
                  e.preventDefault()
                  return
                }
              }
              if (store.mode === "normal") autocomplete.onKeyDown(e)
              if (!autocomplete.visible) {
                if (
                  (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                  (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                ) {
                  const direction = keybind.match("history_previous", e) ? -1 : 1
                  const item = history.move(direction, input.plainText)

                  if (item) {
                    input.setText(item.input)
                    setStore("prompt", item)
                    setStore("mode", item.mode ?? "normal")
                    restoreExtmarksFromParts(item.parts)
                    e.preventDefault()
                    if (direction === -1) input.cursorOffset = 0
                    if (direction === 1) input.cursorOffset = input.plainText.length
                  }
                  return
                }

                if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                  input.cursorOffset = input.plainText.length
              }
            }}
            onSubmit={submit}
            onPaste={async (event: PasteEvent) => {
              if (props.disabled) {
                event.preventDefault()
                return
              }

              // Normalize line endings at the boundary
              // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
              // Replace CRLF first, then any remaining CR
              const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
              const pastedContent = normalizedText.trim()
              if (!pastedContent) {
                command.trigger("prompt.paste")
                return
              }

              // trim ' from the beginning and end of the pasted content. just
              // ' and nothing else
              const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
              const isUrl = /^(https?):\/\//.test(filepath)
              if (!isUrl) {
                try {
                  const mime = Filesystem.mimeType(filepath)
                  const filename = path.basename(filepath)
                  // Handle SVG as raw text content, not as base64 image
                  if (mime === "image/svg+xml") {
                    event.preventDefault()
                    const content = await Filesystem.readText(filepath).catch(() => {})
                    if (content) {
                      pasteText(content, `[SVG: ${filename ?? "image"}]`)
                      return
                    }
                  }
                  if (mime.startsWith("image/")) {
                    event.preventDefault()
                    const content = await Filesystem.readArrayBuffer(filepath)
                      .then((buffer) => Buffer.from(buffer).toString("base64"))
                      .catch(() => {})
                    if (content) {
                      await pasteImage({
                        filename,
                        mime,
                        content,
                      })
                      return
                    }
                  }
                } catch {}
              }

              const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
              if (
                (lineCount >= 3 || pastedContent.length > 150) &&
                !sync.data.config.experimental?.disable_paste_summary
              ) {
                event.preventDefault()
                pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                return
              }

              // Debounced render for pasted content to prevent flickering
              queueMicrotask(() => {
                if (!input || input.isDestroyed) return
                debouncedRender()
              })
            }}
            ref={(r: TextareaRenderable) => {
              input = r
              if (promptPartTypeId === 0) {
                promptPartTypeId = input.extmarks.registerType("prompt-part")
              }
              props.ref?.(ref)
              // cursorColor is handled by createEffect above, no need for setTimeout
            }}
            onMouseDown={(r: MouseEvent) => r.target?.focus()}
            cursorColor={theme.textMuted}
          />
        </box>
        <box
          height={1}
          border={["bottom"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            horizontal: "─",
          }}
        />
        <box flexDirection="row" justifyContent="space-between">
          {(() => {
            const retry = createMemo(() => {
              const s = status()
              if (s.type !== "retry") return
              return s
            })
            const message = createMemo(() => {
              const r = retry()
              if (!r) return
              if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                return "gemini is way too hot right now"
              if (r.message.length > 80) return r.message.slice(0, 80) + "..."
              return r.message
            })
            const isTruncated = createMemo(() => {
              const r = retry()
              if (!r) return false
              return r.message.length > 120
            })
            const [seconds, setSeconds] = createSignal(0)
            onMount(() => {
              const timer = setInterval(() => {
                const next = retry()?.next
                if (next) setSeconds(Math.round((next - Date.now()) / 1000))
              }, 1000)

              onCleanup(() => {
                clearInterval(timer)
              })
            })
            const handleMessageClick = () => {
              const r = retry()
              if (!r) return
              if (isTruncated()) {
                DialogAlert.show(dialog, "Retry Error", r.message)
              }
            }

            const retryText = () => {
              const r = retry()
              if (!r) return ""
              const baseMessage = message()
              const truncatedHint = isTruncated() ? " (click to expand)" : ""
              const duration = formatDuration(seconds())
              const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
              return baseMessage + truncatedHint + retryInfo
            }

            return (
              <Show when={retry()}>
                <box onMouseUp={handleMessageClick}>
                  <text fg={theme.error}>{retryText()}</text>
                </box>
              </Show>
            )
          })()}
        </box>
      </box>
    </>
  )
}
