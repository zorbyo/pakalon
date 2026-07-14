import { createSignal, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { Bus } from "@/bus"
import { createTelegramClient } from "@/telegram/client"
import { deleteWebhook } from "@/telegram/webhook"
import { deleteTelegramToken, retrieveTelegramToken, storeTelegramToken } from "@/telegram/token-store"
import { TuiEvent } from "../event"

const TELEGRAM_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/

type StoredTelegramToken = NonNullable<Awaited<ReturnType<typeof retrieveTelegramToken>>>

let remoteInput:
  | {
      token: string
      abort: AbortController
    }
  | undefined

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function stopTelegramRemoteInput() {
  remoteInput?.abort.abort()
  remoteInput = undefined
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function startTelegramRemoteInput(token: string) {
  if (remoteInput?.token === token && !remoteInput.abort.signal.aborted) return

  stopTelegramRemoteInput()

  const abort = new AbortController()
  remoteInput = { token, abort }
  const client = createTelegramClient(token)

  void (async () => {
    let offset = 0

    try {
      await deleteWebhook(token).catch(() => undefined)
      const pending = await client.getUpdates({ timeout: 0, allowed_updates: ["message"] })
      for (const update of pending) {
        offset = Math.max(offset, update.update_id + 1)
      }
    } catch (error) {
      await Bus.publish(TuiEvent.ToastShow, {
        title: "Telegram",
        message: `Remote input setup warning: ${formatError(error)}`,
        variant: "warning",
        duration: 5000,
      }).catch(() => undefined)
    }

    while (!abort.signal.aborted) {
      try {
        const updates = await client.getUpdates({
          offset: offset || undefined,
          timeout: 25,
          allowed_updates: ["message"],
        })

        for (const update of updates) {
          offset = update.update_id + 1
          const message = update.message
          const text = message?.text?.trim()
          if (!text) continue

          await Bus.publish(TuiEvent.ToastShow, {
            title: "Telegram",
            message: `Received message from ${message.chat.username ? `@${message.chat.username}` : message.chat.id}`,
            variant: "info",
            duration: 3000,
          }).catch(() => undefined)

          await Bus.publish(TuiEvent.PromptAppend, { text, submit: true })

          if (message.chat.id) {
            await client.sendText(message.chat.id, "Received by Pakalon CLI. Running it in the open terminal.").catch(
              () => undefined,
            )
          }
        }
      } catch (error) {
        if (abort.signal.aborted) break
        await Bus.publish(TuiEvent.ToastShow, {
          title: "Telegram",
          message: `Remote input retrying: ${formatError(error)}`,
          variant: "warning",
          duration: 5000,
        }).catch(() => undefined)
        await sleep(5000)
      }
    }
  })()
}

export function DialogTelegramConnect() {
  const [checking, setChecking] = createSignal(true)
  const [stored, setStored] = createSignal<StoredTelegramToken | null>(null)
  const [error, setError] = createSignal<string>()
  const dialog = useDialog()

  onMount(async () => {
    try {
      const existing = await retrieveTelegramToken()
      setStored(existing)
      if (existing) startTelegramRemoteInput(existing.token)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setChecking(false)
    }
  })

  const openTokenPrompt = () => dialog.replace(() => <TelegramTokenPrompt />)

  return (
    <Show
      when={!checking()}
      fallback={
        <TelegramMessage
          title="Connect Telegram"
          message="Checking the saved Telegram connection..."
        />
      }
    >
      <Show
        when={stored()}
        keyed
        fallback={
          <DialogSelect
            title="Connect Telegram"
            placeholder="Telegram"
            skipFilter
            options={[
              {
                title: "Telegram",
                value: "telegram",
                description: error() ? `Check failed: ${error()}` : "Connect a Telegram bot token",
                category: "Remote input",
                onSelect: openTokenPrompt,
              },
            ]}
          />
        }
      >
        {(token) => (
          <DialogSelect
            title="Telegram connected"
            placeholder="Telegram"
            skipFilter
            options={[
              {
                title: token.botUsername ? `@${token.botUsername}` : "Telegram bot",
                value: "keep",
                description: "Remote input is listening in this terminal",
                category: "Connected",
                onSelect: (ctx) => ctx.clear(),
              },
              {
                title: "Replace bot token",
                value: "replace",
                description: "Connect a different Telegram bot",
                category: "Manage",
                onSelect: openTokenPrompt,
              },
              {
                title: "Disconnect Telegram",
                value: "disconnect",
                description: "Remove the saved bot token",
                category: "Manage",
                onSelect: () => {
                  void (async () => {
                    stopTelegramRemoteInput()
                    await deleteTelegramToken()
                    dialog.replace(() => (
                      <TelegramMessage title="Telegram disconnected" message="The saved Telegram token was removed." />
                    ))
                  })()
                },
              },
            ]}
          />
        )}
      </Show>
    </Show>
  )
}

function TelegramTokenPrompt() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()
  const [connecting, setConnecting] = createSignal(false)

  const connect = async (value: string) => {
    if (connecting()) return
    const token = value.trim()
    if (!TELEGRAM_TOKEN_PATTERN.test(token)) {
      setError("Enter a valid Telegram bot token from @BotFather.")
      return
    }

    setConnecting(true)
    setError(undefined)

    try {
      const client = createTelegramClient(token)
      const info = await client.getMe()
      if (!info.result.is_bot) {
        setError("That token is valid, but it does not belong to a bot.")
        return
      }

      await storeTelegramToken(token, info.result.username)
      startTelegramRemoteInput(token)
      dialog.replace(() => (
        <TelegramMessage
          title="Telegram connected"
          message={`Connected as @${info.result.username}. Send a message to the bot while this terminal is open to run it through Pakalon.`}
        />
      ))
    } catch (err) {
      setError(formatError(err))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <DialogPrompt
      title="Telegram bot token"
      placeholder="123456789:ABCdef..."
      onConfirm={(value) => {
        void connect(value)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Paste the bot token from @BotFather.</text>
          <Show when={connecting()}>
            <text fg={theme.textMuted}>Connecting...</text>
          </Show>
          <Show when={error()}>
            {(message) => <text fg={theme.error}>{message()}</text>}
          </Show>
        </box>
      )}
    />
  )
}

function TelegramMessage(props: { title: string; message: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{props.message}</text>
      <box flexDirection="row" justifyContent="flex-end">
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
