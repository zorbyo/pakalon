# `/connect` — Connect Telegram to the CLI

Wire up a Telegram bot so prompts can be sent from your phone and
executed by the running CLI.

## Arguments

- `$ARGUMENTS` — required. The Telegram bot token from BotFather.

## Steps

1. **First run:** invoke the `/connect` slash command with the bot
   token. The CLI persists the token to `~/.omp/telegram.json` (mode
   `0600`) via `pakalon/telegram/server.ts: setBotToken`.
2. The CLI spawns an in-process webhook server
   (`pakalon/telegram/server.ts: startTelegramServer`) on a random
   local port and prints the webhook URL. Register that URL with
   BotFather via `setWebhook`.
3. **Subsequent runs:** `/connect` reads the saved token and
   re-binds the webhook server. The CLI never reaches out to a
   remote backend.
4. Inbound messages arrive at the local `Bun.serve` server, are
   routed through `pakalon/telegram/router.ts: onTelegramMessage`,
   and forwarded to the live `AgentSession` via `sendUserMessage`.
5. Replies are streamed back through the bot via
   `sendTelegramMessage(chatId, text)`.
6. `/connect-end` removes the webhook and clears the saved config.

## Rules

- The token is stored at `~/.omp/telegram.json` with file mode
  `0600`. Rotate it with `/connect-end` then `/connect <new-token>`.
- One bot per user. If the user is also using the cloud
  companion site, the token is mirrored to their Supabase profile
  by the gateway service.
- The webhook server binds to `127.0.0.1:<random>` — never publicly
  exposed.
