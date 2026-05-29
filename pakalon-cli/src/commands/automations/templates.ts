/**
 * /automations templates — display ready-to-use automation templates.
 */
import type { CommandResult } from "../types.js";
import type { AutomationTemplate } from "@/automations/types.js";

const TEMPLATES: AutomationTemplate[] = [
  {
    key: "pr-review-alert",
    name: "PR Review Alert",
    description: "Monitor all open PRs for review issues, CI failures, and merge conflicts. Sends Slack notifications when problems are detected.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "*/30 * * * *",
    promptHint: "Check all open PRs for change requests, CI failures, and merge conflicts. Alert on any issues found.",
  },
  {
    key: "daily-standup",
    name: "Daily Standup Report",
    description: "Generate a daily summary of PR activity: merged PRs, new PRs, open issues, and blockers. Posted to Slack every weekday morning.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 9 * * 1-5",
    promptHint: "Summarize yesterday's PR merges, new PRs opened, and any blocking issues for the team standup.",
  },
  {
    key: "weekly-health",
    name: "Weekly Repository Health",
    description: "Comprehensive weekly health check: stale PRs (>7 days), open issues by severity, CI pass rate, and dependency updates.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 10 * * 1",
    promptHint: "Analyze repository health: list stale PRs, categorize open issues by severity, report CI pass/fail rate, and note any dependency updates.",
  },
  {
    key: "release-tracker",
    name: "Release Tracker",
    description: "Track PRs and issues tagged for the next release. Notify when all release items are merged or if blockers exist.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 */4 * * *",
    promptHint: "Check all PRs and issues labeled for the upcoming release. Report readiness and any blockers.",
  },
  {
    key: "stale-pr-reminder",
    name: "Stale PR Reminder",
    description: "Identify PRs that haven't been updated in 3+ days and send a reminder to the author and reviewers.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 14 * * 1-5",
    promptHint: "Find PRs with no activity in the last 3 days. List them with author, age, and last comment.",
  },
  {
    key: "ci-monitor",
    name: "CI/CD Pipeline Monitor",
    description: "Monitor CI/CD pipeline status across all branches. Alert on consecutive failures or unusually long build times.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "*/15 * * * *",
    promptHint: "Check recent CI/CD runs for failures. Flag consecutive failures or builds exceeding normal duration.",
  },
  {
    key: "dependency-alert",
    name: "Dependency Update Tracker",
    description: "Track dependency update PRs (Dependabot, Renovate). Summarize security patches and breaking changes.",
    recommendedConnectors: ["github", "slack"],
    defaultCron: "0 11 * * 3",
    promptHint: "List all open dependency update PRs. Highlight security patches and note any breaking changes.",
  },
  {
    key: "custom",
    name: "Custom Automation",
    description: "Build a custom automation workflow tailored to your specific needs.",
    recommendedConnectors: [],
    defaultCron: "0 9 * * *",
    promptHint: "Describe the automation you want to set up.",
  },
];

export function cmdShowTemplates(): CommandResult {
  const lines: string[] = [
    "┌─ Automation Templates ──────────────────────────────────────────┐",
    "",
    "  Ready-to-use templates. Create one with:",
    "  /automations create --template <key>",
    "",
  ];

  for (const template of TEMPLATES) {
    const connectors = template.recommendedConnectors.length > 0
      ? ` [${template.recommendedConnectors.join(", ")}]`
      : "";

    lines.push(`  [Clipboard] ${template.name}${connectors}`);
    lines.push(`     Key:  ${template.key}`);
    lines.push(`     Cron: ${template.defaultCron}`);
    lines.push(`     ${template.description}`);
    lines.push("");
  }

  lines.push("  Examples:");
  lines.push('  /automations create --template pr-review-alert');
  lines.push('  /automations create "My Monitor" "Check PRs" --template custom');
  lines.push('    --cron "*/30 * * * *" --connectors github,slack');
  lines.push("  ───────────────────────────────────────────────────────────────┘");

  return {
    success: true,
    message: lines.join("\n"),
  };
}

export function getTemplate(key: string): AutomationTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

export function getAllTemplates(): AutomationTemplate[] {
  return TEMPLATES;
}
