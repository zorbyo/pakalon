// Telegram integration module
// Provides Telegram bot integration for remote control capability

export * from "./webhook"
export * from "./client"
export * from "./token-store"
export * from "./webhook-handler"

import * as webhook from "./webhook"
import * as client from "./client"
import * as tokenStore from "./token-store"
import * as webhookHandler from "./webhook-handler"

export const Telegram = {
  webhook,
  client,
  tokenStore,
  webhookHandler,
}
