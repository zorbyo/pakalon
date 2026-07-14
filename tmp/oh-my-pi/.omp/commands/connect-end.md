# `/connect-end` — Disconnect Telegram

Tear down the Telegram webhook and stop the in-process webhook
server. After this command, prompts from Telegram will no longer
reach the CLI.

## Steps

1. Call `pakalon/telegram/server.ts: stopTelegramServer` — shuts
   down the `Bun.serve` worker.
2. Call `pakalon/telegram/server.ts: clearTelegramConfig` — deletes
   `~/.omp/telegram.json` and resets the in-memory state.
3. Call `BotFather /deleteWebhook` if the user wants the upstream
   side disabled too (the CLI does this implicitly next time
   `/connect` is invoked with a new token).
4. Print a confirmation: "Telegram disconnected and credentials
   cleared."
