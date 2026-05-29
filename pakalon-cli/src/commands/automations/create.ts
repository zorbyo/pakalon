/**
 * /automations create — wizard for creating new automations.
 */
import type { CommandContext, CommandResult } from "../types.js";
import type { AutomationTemplate } from "@/automations/types.js";
import { createAutomation } from "@/automations/automationManager.js";
import { validateCronExpression } from "@/automations/cronScheduler.js";
import { debugLog } from "@/utils/logger.js";

const COMMON_TEMPLATES: AutomationTemplate[] = [
  {
    key: "pr-review-alert",
    name: "PR Review Alert",
    description: "Monitor PRs for review issues and notify on Slack",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "*/30 * * * *",
    promptHint: "Check all open PRs for change requests and CI failures",
  },
  {
    key: "daily-standup",
    name: "Daily Standup Report",
    description: "Generate daily summary of PR activity and issues",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 9 * * 1-5",
    promptHint: "Summarize yesterday's PR merges and open issues",
  },
  {
    key: "weekly-health",
    name: "Weekly Repo Health",
    description: "Weekly repository health check with stale PR/issue report",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 10 * * 1",
    promptHint: "Analyze repo health: stale PRs, open issues, CI status",
  },
  {
    key: "release-tracker",
    name: "Release Tracker",
    description: "Track release-related PRs and notify when ready",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 */4 * * *",
    promptHint: "Check PRs labeled with release tags for readiness",
  },
  {
    key: "custom",
    name: "Custom Automation",
    description: "Build your own automation from scratch",
    recommendedConnectors: [],
    defaultCron: "0 9 * * *",
    promptHint: "Describe what you want to automate",
  },
];

export async function cmdCreateAutomation(args: string[]): Promise<CommandResult> {
  const parsed = parseCreateArgs(args);

  if (parsed.help) {
    return {
      success: true,
      message: getCreateHelpText(),
    };
  }

  if (parsed.template) {
    return createFromTemplate(parsed);
  }

  if (!parsed.name || !parsed.prompt) {
    return {
      success: false,
      message: getCreateHelpText(),
    };
  }

  if (parsed.cron && !validateCronExpression(parsed.cron)) {
    return {
      success: false,
      message: `Invalid cron expression: ${parsed.cron}\nUse /automations cron <expr> to validate`,
    };
  }

  try {
    const automation = createAutomation({
      name: parsed.name,
      prompt: parsed.prompt,
      requiredConnectors: parsed.connectors.length > 0 ? parsed.connectors : undefined,
      scheduleCron: parsed.cron ?? undefined,
      scheduleTimezone: parsed.timezone ?? "UTC",
    });

    return {
      success: true,
      message: formatAutomationCreated(automation),
    };
  } catch (error) {
    debugLog(`[automations] Create failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      message: `Failed to create automation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

interface ParsedCreateArgs {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  connectors: string[];
  template?: string;
  help: boolean;
}

function parseCreateArgs(args: string[]): ParsedCreateArgs {
  const parsed: ParsedCreateArgs = {
    connectors: [],
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--name" || arg === "-n") {
      parsed.name = args[++i];
    } else if (arg === "--prompt" || arg === "-p") {
      parsed.prompt = args[++i];
    } else if (arg === "--cron" || arg === "-c") {
      parsed.cron = args[++i];
    } else if (arg === "--timezone" || arg === "-tz") {
      parsed.timezone = args[++i];
    } else if (arg === "--connector" || arg === "--connectors") {
      const value = args[++i];
      if (value) {
        parsed.connectors = value.split(",").map((c) => c.trim().toLowerCase());
      }
    } else if (arg === "--template" || arg === "-t") {
      parsed.template = args[++i];
    } else if (!parsed.name) {
      parsed.name = arg;
    } else if (!parsed.prompt) {
      parsed.prompt = args.slice(i).join(" ");
      break;
    }
    i++;
  }

  return parsed;
}

async function createFromTemplate(parsed: ParsedCreateArgs): Promise<CommandResult> {
  const template = COMMON_TEMPLATES.find((t) => t.key === parsed.template);
  if (!template) {
    const available = COMMON_TEMPLATES.map((t) => `  ${t.key.padEnd(20)} ${t.name}`).join("\n");
    return {
      success: false,
      message: `Template "${parsed.template}" not found.\n\nAvailable templates:\n${available}`,
    };
  }

  const name = parsed.name ?? template.name;
  const prompt = parsed.prompt ?? template.promptHint;
  const cron = parsed.cron ?? template.defaultCron;
  const connectors = parsed.connectors.length > 0 ? parsed.connectors : template.recommendedConnectors;

  try {
    const automation = createAutomation({
      name,
      prompt,
      requiredConnectors: connectors,
      scheduleCron: cron,
      scheduleTimezone: parsed.timezone ?? "UTC",
      templateKey: template.key,
    });

    return {
      success: true,
      message: formatAutomationCreated(automation),
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create from template: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function formatAutomationCreated(automation: {
  id: string;
  name: string;
  scheduleCron?: string | null;
  requiredConnectors: string[];
  enabled: boolean;
}): string {
  const lines = [
    `[OK] Automation created: ${automation.name}`,
    `   ID: ${automation.id}`,
    `   Status: ${automation.enabled ? "Enabled" : "Disabled"}`,
  ];

  if (automation.scheduleCron) {
    lines.push(`   Schedule: ${automation.scheduleCron}`);
  }

  if (automation.requiredConnectors.length > 0) {
    lines.push(`   Connectors: ${automation.requiredConnectors.join(", ")}`);
  }

  lines.push("\nUse /automations run to trigger it now, or /automations toggle to enable/disable.");

  return lines.join("\n");
}

function getCreateHelpText(): string {
  return `
┌─ Create Automation ──────────────────────────────────────┐
│                                                           │
│  Usage:                                                   │
│  /automations create <name> <prompt> [options]            │
│                                                           │
│  Options:                                                 │
│  --name, -n <name>       Automation name                 │
│  --prompt, -p <prompt>   What to automate                 │
│  --cron, -c <expr>       Schedule (e.g. "0 9 * * 1-5")   │
│  --timezone, -tz <tz>    Timezone (default: UTC)          │
│  --connectors <list>     Comma-separated connectors       │
│  --template, -t <key>    Use a template                   │
│                                                           │
│  Templates:                                               │
│  pr-review-alert       Monitor PRs for issues             │
│  daily-standup         Daily PR summary                   │
│  weekly-health         Weekly repo health check           │
│  release-tracker       Track release PRs                  │
│  custom                Build from scratch                 │
│                                                           │
│  Examples:                                                │
│  /automations create "PR Monitor" "Check PRs"             │
│    --cron "*/30 * * * *" --connectors github,slack        │
│  /automations create --template pr-review-alert           │
└───────────────────────────────────────────────────────────┘
`.trim();
}
