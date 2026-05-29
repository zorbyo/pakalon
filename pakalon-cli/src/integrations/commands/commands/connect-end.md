# Connect-End

Disconnect Pakalon from Telegram. Stops the webhook and prevents remote control.

## Usage

```
/connect-end
/connect-end --confirm
```

## Description

The `/connect-end` command disconnects the Telegram integration, stopping all remote control capabilities.

## What It Does

1. Removes webhook from Telegram API
2. Clears connection state
3. Disables bot message handling
4. Preserves configuration for reconnect

## Examples

```bash
# Interactive confirmation
/connect-end

# Immediate disconnect (no confirmation)
/connect-end --confirm
```

## After Disconnecting

- Telegram bot stops responding to messages
- Pakalon continues running locally
- No remote control available
- Can reconnect anytime with `/connect`

## Safety

- Confirmation required unless `--confirm` is passed
- Running tasks are not affected
- Local Pakalon continues normally
- Configuration is preserved

## Related Commands

- `/connect` - Connect to Telegram