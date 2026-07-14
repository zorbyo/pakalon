import { Log } from "../util/log"

const log = Log.create({ service: "telegram:webhook" })

export interface SetWebhookOptions {
  url: string
  certificate?: string
  max_connections?: number
  allowed_updates?: string[]
  drop_pending_updates?: boolean
  secret_token?: string
}

export interface SetWebhookResponse {
  ok: boolean
  result: boolean
  description?: string
}

export interface WebhookInfo {
  ok: boolean
  result: {
    url?: string
    has_custom_certificate: boolean
    pending_updates_count: number
    ip_address?: string
    last_error_date?: number
    last_error_message?: string
    last_synchronize_error_date?: number
    max_connections?: number
    allowed_updates?: string[]
  }
}

export interface DeleteWebhookResponse {
  ok: boolean
  result: boolean
  description?: string
}

/**
 * Set up a webhook for the Telegram bot to receive updates
 */
export async function setWebhook(botToken: string, options: SetWebhookOptions): Promise<SetWebhookResponse> {
  const api = `https://api.telegram.org/bot${botToken}`

  log.info("setting webhook", { url: options.url })

  try {
    const response = await fetch(`${api}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    })

    const data = (await response.json()) as SetWebhookResponse

    if (!data.ok) {
      log.error("failed to set webhook", { error: data.description })
      throw new Error(`Failed to set webhook: ${data.description}`)
    }

    log.info("webhook set successfully", { url: options.url })
    return data
  } catch (error) {
    log.error("webhook setup error", { error })
    throw error
  }
}

/**
 * Delete the webhook for the Telegram bot
 */
export async function deleteWebhook(botToken: string): Promise<DeleteWebhookResponse> {
  const api = `https://api.telegram.org/bot${botToken}`

  log.info("deleting webhook")

  try {
    const response = await fetch(`${api}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })

    const data = (await response.json()) as DeleteWebhookResponse

    if (!data.ok) {
      log.error("failed to delete webhook", { error: data.description })
      throw new Error(`Failed to delete webhook: ${data.description}`)
    }

    log.info("webhook deleted successfully")
    return data
  } catch (error) {
    log.error("webhook deletion error", { error })
    throw error
  }
}

/**
 * Get current webhook info
 */
export async function getWebhookInfo(botToken: string): Promise<WebhookInfo> {
  const api = `https://api.telegram.org/bot${botToken}`

  try {
    const response = await fetch(`${api}/getWebhookInfo`)

    const data = (await response.json()) as WebhookInfo

    if (!data.ok) {
      log.error("failed to get webhook info")
      throw new Error("Failed to get webhook info")
    }

    return data
  } catch (error) {
    log.error("webhook info error", { error })
    throw error
  }
}
