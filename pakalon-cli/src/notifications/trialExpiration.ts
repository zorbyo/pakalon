/**
 * trialExpiration.ts — Trial expiration notification manager for the CLI.
 * Handles trial expiry checks, local notifications, and backend coordination.
 */
import { loadCredentials, getPlanFromToken } from "@/auth/storage.js";
import { getApiClient } from "@/api/client.js";
import { fetchNotifications } from "@/api/notifications.js";
import {
  saveNotificationRecord,
  getNotificationRecords,
  getUnreadTrialNotifications,
} from "./storage.js";
import type {
  AppNotification,
  TrialExpirationPayload,
  LocalNotificationRecord,
} from "./types.js";

const TRIAL_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const TRIAL_WARNING_THRESHOLDS = [14, 7, 3, 1];

let _trialCheckTimer: ReturnType<typeof setTimeout> | null = null;

export async function checkTrialStatus(): Promise<{
  isExpiring: boolean;
  daysRemaining: number | null;
  notifications: AppNotification[];
}> {
  const creds = loadCredentials();
  if (!creds) {
    return { isExpiring: false, daysRemaining: null, notifications: [] };
  }

  const tokenPlan = creds.token ? getPlanFromToken(creds.token) : "free";
  if (tokenPlan !== "free") {
    return { isExpiring: false, daysRemaining: null, notifications: [] };
  }

  const daysRemaining = creds.trialDaysRemaining ?? null;
  if (daysRemaining === null || daysRemaining === undefined) {
    return { isExpiring: false, daysRemaining: null, notifications: [] };
  }

  const isExpiring = daysRemaining <= 14;

  let notifications: AppNotification[] = [];
  if (isExpiring) {
    notifications = await fetchTrialNotifications();
    for (const notif of notifications) {
      syncTrialNotificationToLocal(notif);
    }
  }

  return { isExpiring, daysRemaining, notifications };
}

async function fetchTrialNotifications(): Promise<AppNotification[]> {
  try {
    const allNotifications = await fetchNotifications(true, 20);
    return allNotifications.filter(
      (n) =>
        n.notification_type === "trial_expiration" ||
        n.notification_type === "trial_expiring_soon" ||
        n.notification_type === "billing_reminder",
    );
  } catch {
    return [];
  }
}

function syncTrialNotificationToLocal(notif: AppNotification): void {
  const records = getNotificationRecords();
  const existing = records.find((r) => r.id === notif.id);

  if (!existing) {
    const record: LocalNotificationRecord = {
      id: notif.id,
      notification_type: notif.notification_type,
      title: notif.title,
      body: notif.body,
      read: notif.read,
      dismissed: false,
      created_at: notif.created_at,
      shown_at: new Date().toISOString(),
      action_url: notif.action_url,
      action_label: notif.action_label,
    };
    saveNotificationRecord(record);
  }
}

export async function requestTrialExpirationEmail(
  daysRemaining: number,
): Promise<boolean> {
  const creds = loadCredentials();
  if (!creds || !creds.token) return false;

  const payload: TrialExpirationPayload = {
    user_id: creds.userId,
    email: "",
    display_name: creds.displayName || "User",
    days_remaining: daysRemaining,
    trial_end: creds.trialDaysRemaining
      ? new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString(),
  };

  try {
    const client = getApiClient();
    await client.post("/notifications/trial-expiration", payload);
    return true;
  } catch {
    return false;
  }
}

export function getTrialWarningThreshold(daysRemaining: number): number | null {
  for (const threshold of TRIAL_WARNING_THRESHOLDS) {
    if (daysRemaining === threshold) return threshold;
  }
  return null;
}

export function startTrialStatusPolling(
  intervalMs: number = TRIAL_CHECK_INTERVAL_MS,
): void {
  stopTrialStatusPolling();

  _trialCheckTimer = setInterval(async () => {
    await checkTrialStatus();
  }, intervalMs);

  _trialCheckTimer.unref?.();
}

export function stopTrialStatusPolling(): void {
  if (_trialCheckTimer) {
    clearTimeout(_trialCheckTimer);
    _trialCheckTimer = null;
  }
}

export function getPendingTrialNotifications(): LocalNotificationRecord[] {
  return getUnreadTrialNotifications().filter((r) => !r.dismissed);
}

export function formatTrialNotificationForTUI(record: LocalNotificationRecord): string {
  const icon = " ";
  const lines: string[] = [`${icon}**${record.title}**`, record.body];
  if (record.action_label && record.action_url) {
    lines.push(`\n→ ${record.action_label}: https://pakalon.com${record.action_url}`);
  }
  return lines.join("\n");
}

export function calculateTrialExpiryDate(
  trialDaysUsed: number,
  totalTrialDays: number = 30,
): Date {
  const daysRemaining = totalTrialDays - trialDaysUsed;
  return new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);
}
