import { Log } from "../util/log"
import { createTelegramClient, type Update, type Message, type TelegramClient } from "./client"
import { retrieveTelegramToken } from "./token-store"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import z from "zod/v4"

const log = Log.create({ service: "telegram:webhook-handler" })

// Event when a Telegram message is received
export const TelegramMessageReceived = BusEvent.define(
  "telegram.message.received",
  z.object({
    chatId: z.number(),
    messageId: z.number(),
    text: z.string(),
    username: z.string().optional(),
    firstName: z.string().optional(),
  }),
)

// Event when a Telegram command is executed
export const TelegramCommandExecuted = BusEvent.define(
  "telegram.command.executed",
  z.object({
    chatId: z.number(),
    command: z.string(),
    args: z.string().optional(),
  }),
)

// State for the webhook handler
let client: TelegramClient | null = null
let isInitialized = false

/**
 * Initialize the webhook handler with stored credentials
 */
export async function initializeHandler(): Promise<boolean> {
  if (isInitialized) return true

  try {
    const stored = await retrieveTelegramToken()
    if (!stored) {
      log.info("no stored Telegram token - handler not initialized")
      return false
    }

    client = createTelegramClient(stored.token)
    isInitialized = true
    log.info("webhook handler initialized", { botUsername: stored.botUsername })
    return true
  } catch (error) {
    log.error("failed to initialize webhook handler", { error })
    return false
  }
}

/**
 * Process an incoming webhook update from Telegram
 */
export async function processUpdate(update: Update): Promise<void> {
  log.info("processing update", { update_id: update.update_id })

  // Handle regular messages
  if (update.message) {
    await handleMessage(update.message)
    return
  }

  // Handle edited messages
  if (update.edited_message) {
    log.info("ignoring edited message", { message_id: update.edited_message.message_id })
    return
  }

  // Handle callback queries (inline button presses)
  if (update.callback_query) {
    log.info("ignoring callback query", { id: update.callback_query.id })
    return
  }

  log.info("ignoring unknown update type", { update_id: update.update_id })
}

/**
 * Handle an incoming message
 */
async function handleMessage(message: Message): Promise<void> {
  const chatId = message.chat.id
  const text = message.text
  const username = message.chat.username
  const firstName = message.chat.first_name

  if (!text) {
    log.info("ignoring message without text", { message_id: message.message_id })
    return
  }

  log.info("received message", {
    chat_id: chatId,
    message_id: message.message_id,
    text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
    username,
  })

  // Publish event for other parts of the system to handle
  Bus.publish(TelegramMessageReceived, {
    chatId,
    messageId: message.message_id,
    text,
    username,
    firstName,
  })

  // Check if it's a command (starts with /)
  if (text.startsWith("/")) {
    const parts = text.split(" ")
    const command = parts[0].substring(1) // Remove the leading /
    const args = parts.slice(1).join(" ")

    Bus.publish(TelegramCommandExecuted, {
      chatId,
      command,
      args: args || undefined,
    })

    await handleCommand(chatId, command, args)
    return
  }

  // For non-command messages, process as prompt
  await processPrompt(chatId, text)
}

/**
 * Handle a command message
 */
async function handleCommand(chatId: number, command: string, args: string): Promise<void> {
  log.info("handling command", { chatId, command, args })

  if (!client) {
    log.error("client not initialized")
    return
  }

  switch (command.toLowerCase()) {
    case "start":
      await client.sendText(
        chatId,
        "👋 Welcome to Pakalon!\n\n" +
          "I'm your AI development assistant. Send me any prompt and I'll process it.\n\n" +
          "Available commands:\n" +
          "/status - Check Pakalon status\n" +
          "/help - Show help\n" +
          "/phase1 - Start Phase 1 (Planning)\n" +
          "/phase2 - Start Phase 2 (Design)\n" +
          "/phase3 - Start Phase 3 (Build)\n" +
          "/phase4 - Start Phase 4 (Testing)\n" +
          "/phase5 - Start Phase 5 (Deploy)\n" +
          "/phase6 - Start Phase 6 (Docs)\n",
      )
      break

    case "help":
      await client.sendText(
        chatId,
        "🤖 Pakalon Commands:\n\n" +
          "/start - Start the bot\n" +
          "/status - Check system status\n" +
          "/phase1 - Planning & Requirements\n" +
          "/phase2 - Design & Wireframing\n" +
          "/phase3 - Application Build\n" +
          "/phase4 - Security Testing\n" +
          "/phase5 - Deployment\n" +
          "/phase6 - Documentation\n\n" +
          "You can also send any prompt and I'll process it.",
      )
      break

    case "status":
      await client.sendText(
        chatId,
        "✅ Pakalon is running\n\n" +
          "📊 Status: Active\n" +
          "🔗 Connection: Connected\n" +
          "⏰ Time: " +
          new Date().toISOString(),
      )
      break

    case "phase1":
    case "phase2":
    case "phase3":
    case "phase4":
    case "phase5":
    case "phase6":
      const phaseNum = command.replace("phase", "")
      await client.sendText(
        chatId,
        `🚀 Starting Phase ${phaseNum}...\n\n` +
          "This command needs to be run from the Pakalon CLI.\n" +
          `Use: /phase-${phaseNum} in your terminal.`,
      )
      break

    default:
      await client.sendText(
        chatId,
        `❓ Unknown command: /${command}\n\nUse /help to see available commands.`,
      )
  }
}

/**
 * Process a prompt message (non-command)
 */
async function processPrompt(chatId: number, prompt: string): Promise<void> {
  log.info("processing prompt", { chatId, promptLength: prompt.length })

  if (!client) {
    log.error("client not initialized")
    return
  }

  try {
    // Acknowledge receipt
    await client.sendText(chatId, `📨 Received your prompt (${prompt.length} chars).\n\nProcessing...`)

    // Publish event for the main Pakalon session to handle
    Bus.publish(TelegramMessageReceived, {
      chatId,
      messageId: Date.now(), // Use timestamp as temporary message ID
      text: prompt,
    })

    // Send a response indicating the prompt was received
    // In a full implementation, this would:
    // 1. Find or create a session for this chat
    // 2. Send the prompt to the AI
    // 3. Stream the response back via Telegram messages
    
    // For now, acknowledge and indicate processing
    setTimeout(async () => {
      try {
        await client!.sendText(
          chatId,
          "✅ Your prompt has been received and queued for processing.\n\n" +
          "The AI agent will work on it and send results when complete.\n\n" +
          "Note: Full integration with Pakalon sessions is in progress.",
        )
      } catch (error) {
        log.error("failed to send follow-up message", { chatId, error })
      }
    }, 2000)
  } catch (error) {
    log.error("failed to process prompt", { chatId, error })
    await client.sendText(chatId, "❌ Failed to process your prompt. Please try again.").catch(() => {})
  }
}

/**
 * Send a message to a chat (for outgoing notifications)
 */
export async function sendMessage(chatId: number, text: string): Promise<boolean> {
  if (!client) {
    const initialized = await initializeHandler()
    if (!initialized) {
      log.error("cannot send message - handler not initialized")
      return false
    }
  }

  try {
    await client!.sendText(chatId, text)
    return true
  } catch (error) {
    log.error("failed to send message", { chatId, error })
    return false
  }
}

/**
 * Check if handler is initialized
 */
export function isHandlerInitialized(): boolean {
  return isInitialized
}
