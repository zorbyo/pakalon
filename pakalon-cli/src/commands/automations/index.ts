/**
 * /automations command — manage automation workflows.
 * Entry point that routes to sub-commands: create, list, templates.
 */
import type { CommandContext, CommandResult } from "../types.js";
import { cmdCreateAutomation } from "./create.js";
import { cmdListAutomations } from "./list.js";
import { cmdShowTemplates } from "./templates.js";
import {
  getAllAutomations,
  toggleAutomation,
  deleteAutomation,
  runAutomationNow,
  configureSlack,
  configureGitHub,
} from "@/automations/automationManager.js";
import { validateCronExpression, describeCronExpression } from "@/automations/cronScheduler.js";
import { validateSlackConfig } from "@/automations/slackIntegration.js";
import { validateGitHubConfig } from "@/automations/githubIntegration.js";
import { debugLog } from "@/utils/logger.js";

export const automationsCommand = {
  name: "automations",
  aliases: ["automation", "auto"],
  description: "Manage automation workflows with cron schedules and integrations",
  usage: "/automations [list|create|templates|toggle|delete|run|connect] [args...]",
  category: "advanced" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const subCommand = args[0]?.toLowerCase() ?? "list";

    switch (subCommand) {
      case "list":
      case "ls":
        return cmdListAutomations();

      case "create":
      case "new":
        return cmdCreateAutomation(args.slice(1));

      case "templates":
      case "template":
      case "tmpl":
        return cmdShowTemplates();

      case "toggle": {
        const identifier = args[1];
        if (!identifier) {
          return { success: false, message: "Usage: /automations toggle <name-or-id>" };
        }
        const automations = getAllAutomations();
        const target = automations.find(
          (a) => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase()
        );
        if (!target) {
          return { success: false, message: `Automation "${identifier}" not found` };
        }
        const updated = toggleAutomation(target.id);
        if (!updated) {
          return { success: false, message: "Failed to toggle automation" };
        }
        return {
          success: true,
          message: `Automation "${updated.name}" ${updated.enabled ? "enabled" : "disabled"}`,
        };
      }

      case "delete":
      case "rm":
      case "remove": {
        const identifier = args[1];
        if (!identifier) {
          return { success: false, message: "Usage: /automations delete <name-or-id>" };
        }
        const automations = getAllAutomations();
        const target = automations.find(
          (a) => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase()
        );
        if (!target) {
          return { success: false, message: `Automation "${identifier}" not found` };
        }
        deleteAutomation(target.id);
        return { success: true, message: `Automation "${target.name}" deleted` };
      }

      case "run": {
        const identifier = args[1];
        if (!identifier) {
          return { success: false, message: "Usage: /automations run <name-or-id>" };
        }
        const automations = getAllAutomations();
        const target = automations.find(
          (a) => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase()
        );
        if (!target) {
          return { success: false, message: `Automation "${identifier}" not found` };
        }
        const result = await runAutomationNow(target.id);
        if (result.success) {
          return { success: true, message: `Automation "${target.name}" completed\n${result.summary ?? ""}` };
        }
        return { success: false, message: `Automation "${target.name}" failed: ${result.error}` };
      }

      case "connect": {
        const provider = args[1]?.toLowerCase();
        if (!provider) {
          return {
            success: false,
            message: "Usage: /automations connect <slack|github> [options...]\n" +
              "  Slack: /automations connect slack --webhook <url> [--channel #general]\n" +
              "  GitHub: /automations connect github --owner <org> --repo <name> [--token <pat>]",
          };
        }

        if (provider === "slack") {
          let webhookUrl = "";
          let channel: string | undefined;
          for (let i = 2; i < args.length; i++) {
            if (args[i] === "--webhook" && args[i + 1]) {
              webhookUrl = args[++i]!;
            } else if (args[i] === "--channel" && args[i + 1]) {
              channel = args[++i]!;
            }
          }
          if (!webhookUrl) {
            return { success: false, message: "Slack webhook URL is required. Use --webhook <url>" };
          }
          const errors = validateSlackConfig({ webhookUrl });
          if (errors.length > 0) {
            return { success: false, message: errors.join("\n") };
          }
          configureSlack("default", { webhookUrl, channel });
          return { success: true, message: `Slack connected${channel ? ` (channel: ${channel})` : ""}` };
        }

        if (provider === "github") {
          let owner = "";
          let repo = "";
          let token: string | undefined;
          for (let i = 2; i < args.length; i++) {
            if (args[i] === "--owner" && args[i + 1]) {
              owner = args[++i]!;
            } else if (args[i] === "--repo" && args[i + 1]) {
              repo = args[++i]!;
            } else if (args[i] === "--token" && args[i + 1]) {
              token = args[++i]!;
            }
          }
          if (!owner || !repo) {
            return { success: false, message: "GitHub owner and repo are required. Use --owner <org> --repo <name>" };
          }
          const errors = validateGitHubConfig({ owner, repo });
          if (errors.length > 0) {
            return { success: false, message: errors.join("\n") };
          }
          configureGitHub("default", { owner, repo, token });
          return { success: true, message: `GitHub connected: ${owner}/${repo}` };
        }

        return { success: false, message: `Unknown provider: ${provider}. Use "slack" or "github"` };
      }

      case "cron": {
        const expression = args[1];
        if (!expression) {
          return {
            success: false,
            message: "Usage: /automations cron <expression>\n" +
              "Examples:\n" +
              "  0 9 * * 1-5  — Every weekday at 9:00 AM\n" +
              "  */30 * * * * — Every 30 minutes\n" +
              "  0 0 * * 0    — Every Sunday at midnight",
          };
        }
        const valid = validateCronExpression(expression);
        if (!valid) {
          return { success: false, message: `Invalid cron expression: ${expression}` };
        }
        const description = describeCronExpression(expression);
        return { success: true, message: `Valid cron: ${expression}\nDescription: ${description}` };
      }

      case "help":
      case "--help":
      case "-h":
        return {
          success: true,
          message: getHelpText(),
        };

      default:
        return {
          success: false,
          message: `Unknown sub-command: ${subCommand}\n${getHelpText()}`,
        };
    }
  },
};

function getHelpText(): string {
  return `
┌─ Automations ─────────────────────────────────────────────┐
│                                                           │
│  /automations list              List all automations      │
│  /automations create            Create new automation     │
│  /automations templates         Show ready-to-use templates│
│  /automations toggle <name>     Enable/disable automation │
│  /automations delete <name>     Delete an automation      │
│  /automations run <name>        Run automation now        │
│  /automations connect <provider> Connect Slack or GitHub  │
│  /automations cron <expr>       Validate cron expression  │
│                                                           │
│ Connect integrations:                                     │
│  /automations connect slack --webhook <url>               │
│  /automations connect github --owner <org> --repo <name>  │
│                                                           │
│ Cron examples:                                            │
│  0 9 * * 1-5  Every weekday at 9 AM                       │
│  */30 * * * * Every 30 minutes                            │
│  0 0 * * 0    Every Sunday at midnight                    │
└───────────────────────────────────────────────────────────┘
`.trim();
}

export default automationsCommand;
