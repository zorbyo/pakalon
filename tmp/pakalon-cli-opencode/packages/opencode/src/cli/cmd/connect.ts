import { cmd } from "./cmd"
import { UI } from "../ui"
import { Effect } from "effect"
import { runtime } from "@/effect/runtime"
import * as prompts from "@clack/prompts"
import {
  setWebhook,
  deleteWebhook,
  type SetWebhookOptions,
} from "@/telegram/webhook"
import {
  createTelegramClient,
  type TelegramClient,
} from "@/telegram/client"
import {
  storeTelegramToken,
  retrieveTelegramToken,
  deleteTelegramToken,
  hasStoredToken,
} from "@/telegram/token-store"
import { Log } from "@/util/log"

const log = Log.create({ service: "cli:connect" })

// Get the webhook URL for the Telegram bot
// In production, this would come from a configuration or environment variable
function getWebhookUrl(): string {
  const baseUrl = process.env.PAKALON_WEBHOOK_BASE_URL
  if (!baseUrl) {
    throw new Error(
      "PAKALON_WEBHOOK_BASE_URL environment variable is not set. " +
        "Please configure your webhook base URL to connect to Telegram.",
    )
  }
  // Append a unique path for Telegram webhooks
  return `${baseUrl.replace(/\/$/, "")}/telegram/webhook`
}

const println = (msg: string) => Effect.sync(() => UI.println(msg))

const intro = (msg: string) => Effect.sync(() => prompts.intro(msg))
const outro = (msg: string) => Effect.sync(() => prompts.outro(msg))

const logInfo = (msg: string) => Effect.sync(() => prompts.log.info(msg))

const spinner = () => {
  const s = prompts.spinner()
  return {
    start: (msg: string) => Effect.sync(() => s.start(msg)),
    stop: (msg: string, code?: number) => Effect.sync(() => s.stop(msg, code)),
  }
}

/**
 * Prompt user for Telegram bot token
 */
async function promptForToken(): Promise<string> {
  const token = await prompts.text({
    message: "Enter your Telegram bot token:",
    placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Bot token is required"
      }
      // Basic validation: token should look like bot token format
      if (!value.includes(":")) {
        return "Invalid bot token format"
      }
      return undefined
    },
  })

  if (prompts.isCancel(token)) {
    throw new Error("Cancelled")
  }

  return token as string
}

/**
 * Verify the bot token by getting bot info
 */
async function verifyBotToken(
  client: TelegramClient,
): Promise<{ valid: boolean; username?: string }> {
  try {
    const botInfo = await client.getMe()
    if (botInfo.ok && botInfo.result.is_bot) {
      return { valid: true, username: botInfo.result.username }
    }
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

/**
 * Connect to Telegram effect
 */
const connectEffect = Effect.fn("telegram-connect")(function* () {
  yield* intro("Connect to Telegram")

  // Check if already connected
  const hasToken = yield* Effect.promise(() => hasStoredToken())

  let botToken: string
  let botUsername: string | undefined

  if (hasToken) {
    // Retrieve existing token
    yield* logInfo("Found stored Telegram token")

    const stored = yield* Effect.promise(() => retrieveTelegramToken())
    if (!stored) {
      throw new Error("Failed to retrieve stored Telegram token")
    }

    botToken = stored.token
    botUsername = stored.botUsername

    yield* logInfo(`Using stored token for bot: @${botUsername || "unknown"}`)
  } else {
    // First time - prompt for token
    yield* logInfo("No stored Telegram token found")

    botToken = yield* Effect.promise(() => promptForToken())
    yield* logInfo("Verifying bot token...")

    // Verify the token
    const client = createTelegramClient(botToken)
    const verification = yield* Effect.promise(() => verifyBotToken(client))

    if (!verification.valid) {
      throw new Error(
        "Invalid bot token. Please make sure you've created a bot via @BotFather and copied the correct token.",
      )
    }

    botUsername = verification.username
    yield* logInfo(`Connected to bot: @${botUsername}`)

    // Store the token for future use
    yield* Effect.promise(() => storeTelegramToken(botToken, botUsername))
  }

  // Set up webhook
  const webhookUrl = getWebhookUrl()
  yield* logInfo(`Setting up webhook at: ${webhookUrl}`)

  const spinnerEffect = spinner()

  yield* spinnerEffect.start("Connecting to Telegram...")

  try {
    // Set the webhook
    const webhookOptions: SetWebhookOptions = {
      url: webhookUrl,
      drop_pending_updates: true,
    }

    yield* Effect.promise(() => setWebhook(botToken, webhookOptions))

    // Verify webhook was set correctly
    const client = createTelegramClient(botToken)
    yield* Effect.promise(() => client.getMe())

    yield* spinnerEffect.stop(`Connected to Telegram as @${botUsername}`, 0)
    yield* outro("Telegram connection established successfully!")
    yield* println("")
    yield* println(
      `${UI.Style.TEXT_SUCCESS}●${UI.Style.TEXT_NORMAL} Telegram remote control is active`,
    )
    yield* println(
      `${UI.Style.TEXT_DIM}  Send commands to @${botUsername} to control Pakalon${UI.Style.TEXT_NORMAL}`,
    )
  } catch (error) {
    yield* spinnerEffect.stop("Failed to connect to Telegram", 1)
    throw error
  }
})

/**
 * Disconnect from Telegram effect
 */
const disconnectEffect = Effect.fn("telegram-disconnect")(function* () {
  yield* intro("Disconnect from Telegram")

  // Check if there's a stored token
  const hasToken = yield* Effect.promise(() => hasStoredToken())

  if (!hasToken) {
    yield* println("No Telegram connection found")
    yield* outro("Nothing to disconnect")
    return
  }

  // Retrieve token to delete webhook
  const stored = yield* Effect.promise(() => retrieveTelegramToken())
  if (!stored) {
    yield* println("No Telegram connection found")
    yield* outro("Nothing to disconnect")
    return
  }

  const spinnerEffect = spinner()

  yield* spinnerEffect.start("Disconnecting from Telegram...")

  try {
    // Delete webhook
    yield* Effect.promise(() => deleteWebhook(stored.token))

    // Delete stored token
    yield* Effect.promise(() => deleteTelegramToken())

    yield* spinnerEffect.stop("Disconnected from Telegram", 0)
    yield* outro("Telegram connection has been removed")
  } catch (error) {
    yield* spinnerEffect.stop("Failed to disconnect from Telegram", 1)
    throw error
  }
})

export const ConnectCommand = cmd({
  command: "connect",
  describe: "Connect to Telegram for remote control",
  async handler() {
    UI.empty()
    try {
      await runtime.runPromise(connectEffect())
    } catch (error) {
      if (error instanceof Error && error.message === "Cancelled") {
        UI.println("Cancelled")
        return
      }
      log.error("connect failed", { error })
      UI.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  },
})

export const ConnectEndCommand = cmd({
  command: "connect-end",
  describe: "Disconnect from Telegram",
  async handler() {
    UI.empty()
    try {
      await runtime.runPromise(disconnectEffect())
    } catch (error) {
      if (error instanceof Error && error.message === "Cancelled") {
        UI.println("Cancelled")
        return
      }
      log.error("disconnect failed", { error })
      UI.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  },
})
