import { Log } from "../util/log"

const log = Log.create({ service: "telegram:client" })

export interface BotInfo {
  ok: boolean
  result: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
    can_join_groups: boolean
    can_read_all_group_messages: boolean
    supports_inline_queries: boolean
    can_connect_to_business: boolean
    has_main_webhook: boolean
  }
}

export interface SendMessageOptions {
  chat_id: number | string
  text: string
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2"
  disable_web_page_preview?: boolean
  disable_notification?: boolean
  reply_to_message_id?: number
  allow_sending_without_reply?: boolean
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
}

export interface SendMessageResponse {
  ok: boolean
  result: {
    message_id: number
    chat: {
      id: number
      type: "private" | "group" | "supergroup" | "channel"
      username?: string
      first_name?: string
      last_name?: string
    }
    date: number
    text: string
  }
}

export interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<InlineKeyboardButton>>
}

export interface InlineKeyboardButton {
  text: string
  url?: string
  callback_data?: string
  web_app?: WebAppInfo
}

export interface WebAppInfo {
  url: string
}

export interface ReplyKeyboardMarkup {
  keyboard: Array<Array<KeyboardButton | string>>
  resize_keyboard?: boolean
  one_time_keyboard?: boolean
  input_field_placeholder?: string
  selective?: boolean
}

export interface KeyboardButton {
  text: string
  request_user?: RequestUser
  request_chat?: RequestChat
  request_contact?: boolean
  request_location?: boolean
  request_poll?: RequestPoll
  web_app?: WebAppInfo
}

export interface RequestUser {
  request_id: string
  user_is_bot?: boolean
  user_is_premium?: boolean
}

export interface RequestChat {
  request_id: string
  chat_is_channel: boolean
  chat_is_group?: boolean
  chat_is_supergroup?: boolean
  chat_is_forum?: boolean
  has_username?: boolean
}

export interface RequestPoll {
  type: "regular" | "quiz"
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true
  selective?: boolean
}

export interface ForceReply {
  force_reply: true
  input_field_placeholder?: string
  selective?: boolean
}

export interface Update {
  update_id: number
  message?: Message
  edited_message?: Message
  channel_post?: Message
  edited_channel_post?: Message
  callback_query?: CallbackQuery
  my_chat_member?: ChatMemberUpdated
  chat_member?: ChatMemberUpdated
}

export interface Message {
  message_id: number
  chat: {
    id: number
    type: "private" | "group" | "supergroup" | "channel"
    username?: string
    first_name?: string
    last_name?: string
    title?: string
  }
  date: number
  text?: string
  entities?: Array<MessageEntity>
}

export interface MessageEntity {
  type: string
  offset: number
  length: number
  url?: string
  user?: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
  }
}

export interface CallbackQuery {
  id: string
  from: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
    language_code: string
  }
  chat_instance: string
  data?: string
  game_short_name?: string
}

export interface ChatMemberUpdated {
  chat: {
    id: number
    type: "private" | "group" | "supergroup" | "channel"
    username?: string
    first_name?: string
    last_name?: string
    title?: string
  }
  from: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
  }
  date: number
  old_chat_member: ChatMember
  new_chat_member: ChatMember
}

export interface GetUpdatesOptions {
  offset?: number
  limit?: number
  timeout?: number
  allowed_updates?: string[]
}

export interface GetUpdatesResponse {
  ok: boolean
  result: Update[]
  description?: string
}

export interface ChatMember {
  user: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
  }
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked"
  custom_title?: string
  is_anonymous?: boolean
  can_be_edited?: boolean
  can_post_messages?: boolean
  can_edit_messages?: boolean
  can_delete_messages?: boolean
  can_restrict_members?: boolean
  can_promote_members?: boolean
  can_change_info?: boolean
  can_invite_users?: boolean
  can_pin_messages?: boolean
  can_send_messages?: boolean
  can_send_media_messages?: boolean
  can_send_other_messages?: boolean
  can_add_web_page_previews?: boolean
  until_date?: number
}

export class TelegramClient {
  private botToken: string
  private apiBase: string

  constructor(botToken: string) {
    this.botToken = botToken
    this.apiBase = `https://api.telegram.org/bot${botToken}`
  }

  /**
   * Get information about the bot
   */
  async getMe(): Promise<BotInfo> {
    log.info("getting bot info")

    const response = await fetch(`${this.apiBase}/getMe`)

    if (!response.ok) {
      const errorText = await response.text()
      log.error("failed to get bot info", { status: response.status, error: errorText })
      throw new Error(`Failed to get bot info: ${response.statusText}`)
    }

    const data = (await response.json()) as BotInfo

    if (!data.ok) {
      log.error("getMe returned error", { error: data })
      throw new Error("Failed to get bot info")
    }

    log.info("bot info retrieved", { username: data.result.username })
    return data
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResponse> {
    log.info("sending message", { chat_id: options.chat_id })

    const response = await fetch(`${this.apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    })

    const data = (await response.json()) as SendMessageResponse

    if (!data.ok) {
      log.error("failed to send message", { error: data })
      throw new Error(`Failed to send message: ${data}`)
    }

    log.info("message sent successfully", { message_id: data.result.message_id })
    return data
  }

  /**
   * Send text messages (convenience method)
   */
  async sendText(chatId: number | string, text: string, disableNotification = false): Promise<SendMessageResponse> {
    return this.sendMessage({
      chat_id: chatId,
      text,
      disable_notification: disableNotification,
    })
  }

  /**
   * Long-poll for bot updates.
   */
  async getUpdates(options: GetUpdatesOptions = {}): Promise<Update[]> {
    log.info("getting updates", { offset: options.offset, timeout: options.timeout })

    const response = await fetch(`${this.apiBase}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    })

    const data = (await response.json()) as GetUpdatesResponse

    if (!response.ok || !data.ok) {
      log.error("failed to get updates", { status: response.status, error: data.description })
      throw new Error(`Failed to get updates: ${data.description ?? response.statusText}`)
    }

    return data.result
  }

  /**
   * Verify the bot token is valid by calling getMe
   */
  async verifyToken(): Promise<boolean> {
    try {
      const info = await this.getMe()
      return info.ok && info.result.is_bot
    } catch {
      return false
    }
  }
}

export function createTelegramClient(botToken: string): TelegramClient {
  return new TelegramClient(botToken)
}
