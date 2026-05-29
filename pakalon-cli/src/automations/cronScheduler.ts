/**
 * Cron Job Scheduler — manages scheduled automation execution.
 */
import type { AutomationRecord, AutomationRunResult } from "./types.js";
import { debugLog } from "@/utils/logger.js";

interface ScheduledJob {
  automationId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  timer?: NodeJS.Timeout;
}

const scheduledJobs = new Map<string, ScheduledJob>();

function parseCronExpression(cron: string): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cron}. Expected 5 fields: minute hour dayOfMonth month dayOfWeek`);
  }

  return {
    minute: parts[0] === "*" ? -1 : parseInt(parts[0], 10),
    hour: parts[1] === "*" ? -1 : parseInt(parts[1], 10),
    dayOfMonth: parts[2] === "*" ? -1 : parseInt(parts[2], 10),
    month: parts[3] === "*" ? -1 : parseInt(parts[3], 10),
    dayOfWeek: parts[4] === "*" ? -1 : parseInt(parts[4], 10),
  };
}

function getNextRunTime(cronExpression: string, from: Date = new Date()): Date | null {
  try {
    const parsed = parseCronExpression(cronExpression);
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);

    for (let i = 0; i < 525600; i++) {
      if (
        (parsed.minute === -1 || next.getMinutes() === parsed.minute) &&
        (parsed.hour === -1 || next.getHours() === parsed.hour) &&
        (parsed.dayOfMonth === -1 || next.getDate() === parsed.dayOfMonth) &&
        (parsed.month === -1 || next.getMonth() + 1 === parsed.month) &&
        (parsed.dayOfWeek === -1 || next.getDay() === parsed.dayOfWeek)
      ) {
        return next;
      }
      next.setMinutes(next.getMinutes() + 1);
    }
    return null;
  } catch {
    return null;
  }
}

function calculateDelay(nextRunAt: Date): number {
  const now = new Date();
  const delay = nextRunAt.getTime() - now.getTime();
  return Math.max(delay, 0);
}

export function scheduleJob(
  automation: AutomationRecord,
  onRun: (automation: AutomationRecord) => Promise<AutomationRunResult>
): void {
  if (!automation.scheduleCron) return;

  cancelJob(automation.id);

  const nextRunAt = getNextRunTime(automation.scheduleCron);
  if (!nextRunAt) {
    debugLog(`[cron] Could not calculate next run for ${automation.name}`);
    return;
  }

  const delay = calculateDelay(nextRunAt);
  debugLog(`[cron] Scheduling ${automation.name} to run in ${Math.round(delay / 60000)} minutes`);

  const timer = setTimeout(async () => {
    debugLog(`[cron] Executing automation: ${automation.name}`);
    try {
      await onRun(automation);
    } catch (error) {
      debugLog(`[cron] Automation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    scheduleJob(automation, onRun);
  }, delay);

  timer.unref();

  scheduledJobs.set(automation.id, {
    automationId: automation.id,
    cronExpression: automation.scheduleCron,
    timezone: automation.scheduleTimezone ?? "UTC",
    enabled: automation.enabled,
    lastRunAt: automation.lastRunAt ?? undefined,
    nextRunAt: nextRunAt.toISOString(),
    timer,
  });
}

export function cancelJob(automationId: string): void {
  const job = scheduledJobs.get(automationId);
  if (job?.timer) {
    clearTimeout(job.timer);
    debugLog(`[cron] Cancelled job for ${automationId}`);
  }
  scheduledJobs.delete(automationId);
}

export function rescheduleJob(
  automation: AutomationRecord,
  onRun: (automation: AutomationRecord) => Promise<AutomationRunResult>
): void {
  cancelJob(automation.id);
  if (automation.enabled && automation.scheduleCron) {
    scheduleJob(automation, onRun);
  }
}

export function cancelAllJobs(): void {
  for (const [id, job] of scheduledJobs) {
    if (job.timer) clearTimeout(job.timer);
    scheduledJobs.delete(id);
  }
  debugLog("[cron] All jobs cancelled");
}

export function getJobStatus(automationId: string): ScheduledJob | undefined {
  return scheduledJobs.get(automationId);
}

export function getAllJobStatuses(): Map<string, ScheduledJob> {
  return new Map(scheduledJobs);
}

export function getNextRunTimeForCron(cronExpression: string, from?: Date): Date | null {
  return getNextRunTime(cronExpression, from);
}

export function validateCronExpression(cron: string): boolean {
  try {
    parseCronExpression(cron);
    return true;
  } catch {
    return false;
  }
}

export function describeCronExpression(cron: string): string {
  try {
    const parsed = parseCronExpression(cron);

    const minuteDesc = parsed.minute === -1 ? "every minute" : `at minute ${parsed.minute}`;
    const hourDesc = parsed.hour === -1 ? "" : ` past hour ${parsed.hour}`;
    const dayDesc = parsed.dayOfMonth === -1 ? "" : ` on day ${parsed.dayOfMonth}`;
    const monthDesc = parsed.month === -1 ? "" : ` in month ${parsed.month}`;

    const dayOfWeekNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeekDesc = parsed.dayOfWeek === -1 ? "" : ` on ${dayOfWeekNames[parsed.dayOfWeek] ?? "Unknown"}`;

    return `${minuteDesc}${hourDesc}${dayDesc}${monthDesc}${dayOfWeekDesc}`.trim();
  } catch {
    return "Invalid cron expression";
  }
}
