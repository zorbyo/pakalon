/**
 * /voice command — Toggle and manage voice mode.
 * Enables voice input and transcription for the CLI.
 */
import { isVoiceModeEnabled, setVoiceEnabled } from "@/voice/voiceModeEnabled.js";
import { getGlobalConfig, saveGlobalConfig } from "@/utils/config.js";
import logger from "@/utils/logger.js";

export interface VoiceCommandOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  test?: boolean;
}

export async function cmdVoice(args: string[]): Promise<string> {
  const action = args[0]?.toLowerCase();

  // No args - show current status
  if (!action || action === "status" || action === "st") {
    const enabled = isVoiceModeEnabled();
    return `
[MICROPHONE] Voice Mode Status
━━━━━━━━━━━━━━━━━━━━
Current: ${enabled ? "Enabled" : "Disabled"}

Usage: /voice [on|off|status|test]
  on     - Enable voice mode
  off    - Disable voice mode
  status - Show current status
  test   - Test voice input
`.trim();
  }

  // Enable voice mode
  if (action === "on" || action === "enable" || action === "true") {
    try {
      setVoiceEnabled(true);
      const config = getGlobalConfig();
      config.voiceEnabled = true;
      saveGlobalConfig(config);

      return `[OK] Voice mode enabled!

To use voice input:
• Press the microphone button in the chat
• Or use keyboard shortcut (configured in keybindings)

Note: Voice mode requires microphone access and may not work in all terminals.`;
    } catch (error) {
      logger.error("Failed to enable voice mode:", error);
      return `[X] Failed to enable voice mode: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Disable voice mode
  if (action === "off" || action === "disable" || action === "false") {
    try {
      setVoiceEnabled(false);
      const config = getGlobalConfig();
      config.voiceEnabled = false;
      saveGlobalConfig(config);

      return "[OK] Voice mode disabled.";
    } catch (error) {
      logger.error("Failed to disable voice mode:", error);
      return `[X] Failed to disable voice mode: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Test voice - just acknowledge
  if (action === "test") {
    return `[TestTube] Voice Mode Test

This will test if voice input is available.
Make sure your microphone is connected and permissions are granted.

To test: Click the microphone icon in the chat input area.`;
  }

  // Unknown action
  return `Unknown action: ${action}

Usage: /voice [on|off|status|test]`;
}

// Slash command definition
export const voiceCommand = {
  name: "voice",
  aliases: ["v"],
  description: "Toggle and manage voice mode for voice input",
  usage: "/voice [on|off|status|test]",
  category: "ui" as const,

  async execute(context: any, args: string[]): Promise<{ success: boolean; message: string }> {
    try {
      const result = await cmdVoice(args);
      return { success: true, message: result };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default voiceCommand;