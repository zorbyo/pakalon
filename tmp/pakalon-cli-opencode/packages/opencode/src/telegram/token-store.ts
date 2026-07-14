import { Log } from "../util/log"
import { getClient } from "../backend/client"

const log = Log.create({ service: "telegram:token-store" })

export interface TelegramTokenResponse {
  token?: string | null
  bot_username?: string | null
  webhook_url?: string | null
}

/**
 * Store Telegram token via backend API.
 */
export async function storeTelegramToken(token: string, botUsername?: string): Promise<void> {
  const client = getClient()

  log.info("storing Telegram token")

  await client.put("/users/me/telegram-token", { token, bot_username: botUsername })

  log.info("Telegram token stored successfully")
}

/**
 * Retrieve Telegram token from backend API.
 */
export async function retrieveTelegramToken(): Promise<{
  token: string
  botUsername?: string
} | null> {
  const client = getClient()

  log.info("retrieving Telegram token")

  try {
    const response = (await client.get("/users/me/telegram-token")) as TelegramTokenResponse | null

    if (!response?.token) {
      log.info("no Telegram token found")
      return null
    }

    log.info("Telegram token retrieved successfully")
    return {
      token: response.token,
      botUsername: response.bot_username ?? undefined,
    }
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      log.info("no Telegram token found (not configured)")
      return null
    }
    throw error
  }
}

/**
 * Delete Telegram token from Supabase via backend API
 */
export async function deleteTelegramToken(): Promise<void> {
  const client = getClient()

  log.info("deleting Telegram token")

  try {
    await client.delete("/users/me/telegram-token")
    log.info("Telegram token deleted successfully")
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      log.info("no Telegram token to delete")
      return
    }
    throw error
  }
}

/**
 * Check if a Telegram token is already stored
 */
export async function hasStoredToken(): Promise<boolean> {
  const result = await retrieveTelegramToken()
  return result !== null
}
