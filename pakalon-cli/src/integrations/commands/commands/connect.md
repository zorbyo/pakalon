# Connect

Connect Pakalon to Telegram for remote control via chat messages.

## Usage

```
/connect
/connect --setup
/connect --status
```

## Description

The `/connect` command sets up a Telegram bot integration that allows you to control Pakalon remotely through Telegram messages.

## First-Time Setup

When running `/connect` for the first time:

1. **Create a Telegram Bot**
   - Open Telegram and chat with @BotFather
   - Send `/newbot` and follow prompts
   - Copy the bot token

2. **Enter Token**
   - Run `/connect --setup`
   - Paste your bot token when prompted

3. **Verify Connection**
   - Send `/start` to your bot in Telegram
   - Pakalon should confirm connection

## Subsequent Uses

Once configured, simply run `/connect` to activate the Telegram bridge.

## Capabilities via Telegram

After connecting, you can:
- Send prompts to Pakalon via Telegram
- Receive execution updates
- Get notifications on task completion
- Control running tasks
- Ask questions via `/ans` syntax

## Examples

```bash
# Initial setup
/connect --setup

# Check connection status
/connect --status

# Activate connection (after initial setup)
/connect
```

## Telegram Commands

When using Telegram, available commands:
- `/start` - Verify connection
- `/status` - Show current project status
- `/ans <question>` - Ask question without interrupting
- `/stop` - Stop current task
- `/help` - Show available commands

## Connection Security

- Uses webhook-based updates (no polling)
- Bot token stored securely in config
- Messages are encrypted in transit
- Rate limiting prevents abuse

## System Requirements

- Telegram bot token
- Internet connectivity (for webhook)
- Pakalon running (for real-time responses)

## Persistence

Connection settings are stored in:
- `~/.config/pakalon/telegram.json` - encrypted token

## Troubleshooting

### Connection Fails
- Verify bot token is correct
- Check internet connectivity
- Ensure Pakalon is running

### Webhook Issues
- Try `/connect --setup` again
- Check Telegram API status

### Messages Not Delivered
- Verify bot has send message permission
- Check if bot was blocked by user

## Related Commands

- `/connect-end` - Disconnect Telegram