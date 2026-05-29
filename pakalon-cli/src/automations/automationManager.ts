/**
 * Core Automation Manager — orchestrates automation lifecycle.
 */
import { v4 as uuidv4 } from "uuid";
import type {
  AutomationRecord,
  AutomationCreateInput,
  AutomationRunResult,
  SlackConfig,
  GitHubConfig,
  AutomationStatus,
} from "./types.js";
import * as storage from "./storage.js";
import * as cronScheduler from "./cronScheduler.js";
import { sendAutomationNotification, sendPRAlert } from "./slackIntegration.js";
import { checkPullRequests } from "./githubIntegration.js";
import { debugLog } from "@/utils/logger.js";

const slackConfigs = new Map<string, SlackConfig>();
const gitHubConfigs = new Map<string, GitHubConfig>();

export function createAutomation(input: AutomationCreateInput): AutomationRecord {
  const now = new Date().toISOString();
  const automation: AutomationRecord = {
    id: `auto_${uuidv4()}`,
    name: input.name,
    prompt: input.prompt,
    templateKey: input.templateKey ?? null,
    description: null,
    inferredConfig: {},
    requiredConnectors: input.requiredConnectors ?? [],
    scheduleCron: input.scheduleCron ?? null,
    scheduleTimezone: input.scheduleTimezone ?? "UTC",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  storage.saveAutomation(automation);
  debugLog(`[automation] Created: ${automation.name} (${automation.id})`);

  if (automation.enabled && automation.scheduleCron) {
    cronScheduler.scheduleJob(automation, runAutomation);
  }

  return automation;
}

export function updateAutomation(id: string, updates: Partial<AutomationRecord>): AutomationRecord | null {
  const existing = storage.getAutomation(id);
  if (!existing) return null;

  const updated: AutomationRecord = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  storage.saveAutomation(updated);

  if (updated.enabled && updated.scheduleCron) {
    cronScheduler.rescheduleJob(updated, runAutomation);
  } else {
    cronScheduler.cancelJob(id);
  }

  debugLog(`[automation] Updated: ${updated.name}`);
  return updated;
}

export function deleteAutomation(id: string): boolean {
  cronScheduler.cancelJob(id);
  const result = storage.deleteAutomation(id);
  if (result) debugLog(`[automation] Deleted: ${id}`);
  return result;
}

export function getAutomation(id: string): AutomationRecord | null {
  return storage.getAutomation(id);
}

export function getAutomationByName(name: string): AutomationRecord | null {
  return storage.getAutomationByName(name);
}

export function getAllAutomations(): AutomationRecord[] {
  return storage.getAllAutomations();
}

export function toggleAutomation(id: string): AutomationRecord | null {
  const existing = storage.getAutomation(id);
  if (!existing) return null;

  return updateAutomation(id, { enabled: !existing.enabled });
}

async function runAutomation(automation: AutomationRecord): Promise<AutomationRunResult> {
  const startedAt = new Date().toISOString();
  debugLog(`[automation] Running: ${automation.name}`);

  storage.updateAutomationStatus(automation.id, {
    lastRunAt: startedAt,
    lastStatus: "running",
  });

  try {
    const connectors = automation.requiredConnectors;
    const results: string[] = [];

    if (connectors.includes("github") || connectors.includes("slack")) {
      const ghConfig = gitHubConfigs.get("default");
      if (ghConfig) {
        const prCheck = await checkPullRequests(ghConfig);

        if (prCheck.issues.length > 0) {
          const slackConfig = slackConfigs.get("default");
          if (slackConfig) {
            for (const issue of prCheck.issues) {
              await sendPRAlert(
                slackConfig,
                prCheck.repo,
                issue.prNumber,
                issue.title,
                issue.issue,
                issue.url
              );
            }
          }
          results.push(`Found ${prCheck.issues.length} PR issue(s) in ${prCheck.repo}`);
        } else {
          results.push(`No PR issues found in ${prCheck.repo}`);
        }
      }
    }

    const completedAt = new Date().toISOString();
    const summary = results.join("\n") || "Automation completed successfully";

    storage.updateAutomationStatus(automation.id, {
      lastRunAt: completedAt,
      lastStatus: "success",
    });

    const slackConfig = slackConfigs.get("default");
    if (slackConfig) {
      await sendAutomationNotification(slackConfig, automation.name, "success", summary);
    }

    return {
      success: true,
      automationId: automation.id,
      summary,
      startedAt,
      completedAt,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);

    storage.updateAutomationStatus(automation.id, {
      lastRunAt: completedAt,
      lastStatus: "failed",
      lastError: errorMessage,
    });

    const slackConfig = slackConfigs.get("default");
    if (slackConfig) {
      await sendAutomationNotification(slackConfig, automation.name, "failed", errorMessage);
    }

    debugLog(`[automation] Failed: ${automation.name} — ${errorMessage}`);

    return {
      success: false,
      automationId: automation.id,
      error: errorMessage,
      startedAt,
      completedAt,
    };
  }
}

export async function runAutomationNow(id: string): Promise<AutomationRunResult> {
  const automation = storage.getAutomation(id);
  if (!automation) {
    return {
      success: false,
      automationId: id,
      error: "Automation not found",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  return runAutomation(automation);
}

export function configureSlack(key: string, config: SlackConfig): void {
  slackConfigs.set(key, config);
  debugLog(`[automation] Slack configured: ${key}`);
}

export function configureGitHub(key: string, config: GitHubConfig): void {
  gitHubConfigs.set(key, config);
  debugLog(`[automation] GitHub configured: ${key}`);
}

export function getSlackConfig(key: string): SlackConfig | undefined {
  return slackConfigs.get(key);
}

export function getGitHubConfig(key: string): GitHubConfig | undefined {
  return gitHubConfigs.get(key);
}

export function initializeAutomations(): void {
  const automations = storage.getAllAutomations();
  for (const automation of automations) {
    if (automation.enabled && automation.scheduleCron) {
      cronScheduler.scheduleJob(automation, runAutomation);
    }
  }
  debugLog(`[automation] Initialized ${automations.length} automation(s)`);
}

export function shutdownAutomations(): void {
  cronScheduler.cancelAllJobs();
  debugLog("[automation] Shutdown complete");
}

export function getAutomationStatus(id: string): AutomationStatus {
  const automation = storage.getAutomation(id);
  if (!automation) return "idle";
  if (!automation.enabled) return "disabled";
  return (automation.lastStatus as AutomationStatus) ?? "idle";
}
