/**
 * Slack Webhook Integration — sends notifications to Slack channels.
 */
import type { SlackConfig } from "./types.js";
import { debugLog } from "@/utils/logger.js";

export interface SlackMessage {
  text: string;
  blocks?: Record<string, any>[];
  attachments?: Record<string, any>[];
}

async function sendSlackWebhook(config: SlackConfig, message: SlackMessage): Promise<boolean> {
  if (!config.webhookUrl) {
    debugLog("[slack] No webhook URL configured");
    return false;
  }

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message.text,
        ...(message.blocks && { blocks: message.blocks }),
        ...(message.attachments && { attachments: message.attachments }),
        ...(config.channel && { channel: config.channel }),
      }),
    });

    if (!response.ok) {
      debugLog(`[slack] Webhook failed: ${response.status} ${response.statusText}`);
      return false;
    }

    debugLog("[slack] Message sent successfully");
    return true;
  } catch (error) {
    debugLog(`[slack] Webhook error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function sendAutomationNotification(
  config: SlackConfig,
  automationName: string,
  status: "success" | "failed" | "started",
  summary?: string
): Promise<boolean> {
  const emoji = status === "success" ? "[OK]" : status === "failed" ? "[X]" : "[Refresh]";
  const text = `${emoji} *Automation: ${automationName}* — ${status.toUpperCase()}\n${summary ?? ""}`;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} Pakalon Automation`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Automation:*\n${automationName}` },
        { type: "mrkdwn", text: `*Status:*\n${status}` },
      ],
    },
    ...(summary
      ? [{ type: "section", text: { type: "mrkdwn", text: `*Summary:*\n${summary}` } }]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ` ${new Date().toISOString()}`,
        },
      ],
    },
  ];

  return sendSlackWebhook(config, { text, blocks });
}

export async function sendPRAlert(
  config: SlackConfig,
  repo: string,
  prNumber: number,
  prTitle: string,
  issue: string,
  url: string
): Promise<boolean> {
  const text = `[Siren] *PR Issue Detected* in \`${repo}\`\n*#${prNumber}: ${prTitle}*\n${issue}`;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "[Siren] PR Issue Alert", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Repository:*\n${repo}` },
        { type: "mrkdwn", text: `*PR:*\n#${prNumber}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Title:*\n${prTitle}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Issue:*\n${issue}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View PR", emoji: true },
          url,
          action_id: "view_pr",
        },
      ],
    },
  ];

  return sendSlackWebhook(config, { text, blocks });
}

export function validateSlackConfig(config: Partial<SlackConfig>): string[] {
  const errors: string[] = [];
  if (!config.webhookUrl) {
    errors.push("Slack webhook URL is required");
  } else if (!config.webhookUrl.startsWith("https://hooks.slack.com/")) {
    errors.push("Invalid Slack webhook URL format");
  }
  return errors;
}
