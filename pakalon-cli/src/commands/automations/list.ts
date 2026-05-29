/**
 * /automations list — display all configured automations.
 */
import type { CommandResult } from "../types.js";
import { getAllAutomations, getAutomationStatus } from "@/automations/automationManager.js";
import { getJobStatus, describeCronExpression } from "@/automations/cronScheduler.js";

export function cmdListAutomations(): CommandResult {
  const automations = getAllAutomations();

  if (automations.length === 0) {
    return {
      success: true,
      message:
        "No automations configured.\n" +
        "Create one with: /automations create <name> <prompt>\n" +
        "Or use a template: /automations templates",
    };
  }

  const lines: string[] = [
    `┌─ Automations (${automations.length}) ─────────────────────────────────┐`,
    "",
  ];

  for (const automation of automations) {
    const status = getAutomationStatus(automation.id);
    const statusIcon = status === "success" ? "[OK]" : status === "failed" ? "[X]" : status === "running" ? "[Refresh]" : status === "disabled" ? "" : "[o]";
    const enabledLabel = automation.enabled ? "enabled" : "disabled";

    lines.push(`  ${statusIcon} ${automation.name}`);
    lines.push(`    ID:      ${automation.id}`);
    lines.push(`    Status:  ${enabledLabel}${automation.lastStatus ? ` (last: ${automation.lastStatus})` : ""}`);

    if (automation.scheduleCron) {
      const job = getJobStatus(automation.id);
      const description = describeCronExpression(automation.scheduleCron);
      lines.push(`    Cron:    ${automation.scheduleCron} (${description})`);
      if (job?.nextRunAt) {
        const nextRun = new Date(job.nextRunAt);
        lines.push(`    Next:    ${nextRun.toLocaleString()}`);
      }
    }

    if (automation.requiredConnectors.length > 0) {
      lines.push(`    Connect: ${automation.requiredConnectors.join(", ")}`);
    }

    if (automation.lastRunAt) {
      const lastRun = new Date(automation.lastRunAt);
      lines.push(`    Last:    ${lastRun.toLocaleString()}`);
    }

    if (automation.lastError) {
      lines.push(`    Error:   ${automation.lastError.slice(0, 100)}`);
    }

    lines.push("");
  }

  lines.push("  Commands: toggle | delete | run | connect");
  lines.push("  ─────────────────────────────────────────────────────────────┘");

  return {
    success: true,
    message: lines.join("\n"),
  };
}
