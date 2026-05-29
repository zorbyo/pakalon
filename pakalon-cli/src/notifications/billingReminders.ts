/**
 * billingReminders.ts — Billing reminder scheduler for the CLI.
 * Manages local billing reminder state and coordinates with backend email delivery.
 */
import { loadCredentials } from "@/auth/storage.js";
import { getApiClient } from "@/api/client.js";
import { fetchNotifications, markNotificationRead } from "@/api/notifications.js";
import {
  saveNotificationRecord,
  getNotificationRecords,
  getUnreadBillingReminders,
  markNotificationDismissed,
} from "./storage.js";
import type { AppNotification, BillingReminderPayload, LocalNotificationRecord } from "./types.js";

const BILLING_REMINDER_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const BILLING_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let _reminderCheckTimer: ReturnType<typeof setTimeout> | null = null;

export async function checkBillingReminders(): Promise<AppNotification[]> {
  try {
    const notifications = await fetchNotifications(true, 10);
    const billingReminders = notifications.filter(
      (n) => n.notification_type === "billing_reminder" || n.notification_type === "subscription_renewal",
    );

    for (const notif of billingReminders) {
      await syncToLocalStorage(notif);
    }

    return billingReminders;
  } catch {
    return [];
  }
}

async function syncToLocalStorage(notif: AppNotification): Promise<void> {
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
  } else if (!existing.read && notif.read) {
    const updated = { ...existing, read: true };
    saveNotificationRecord(updated);
  }
}

export async function triggerBillingReminder(
  daysRemaining: number,
  plan: "free" | "pro" = "free",
): Promise<boolean> {
  const creds = loadCredentials();
  if (!creds) return false;

  const records = getNotificationRecords();
  const recentReminder = records.find(
    (r) =>
      r.notification_type === "billing_reminder" &&
      r.shown_at &&
      Date.now() - new Date(r.shown_at).getTime() < BILLING_REMINDER_COOLDOWN_MS,
  );

  if (recentReminder) return false;

  const payload: BillingReminderPayload = {
    user_id: creds.userId,
    email: creds.githubLogin ? `${creds.githubLogin}@users.noreply.github.com` : "",
    display_name: creds.displayName || "User",
    days_remaining: daysRemaining,
    plan,
  };

  try {
    const client = getApiClient();
    await client.post("/notifications/billing-reminders", payload);
    return true;
  } catch {
    return false;
  }
}

export function startBillingReminderPolling(
  intervalMs: number = BILLING_REMINDER_CHECK_INTERVAL_MS,
): void {
  stopBillingReminderPolling();

  _reminderCheckTimer = setInterval(async () => {
    await checkBillingReminders();
  }, intervalMs);

  _reminderCheckTimer.unref?.();
}

export function stopBillingReminderPolling(): void {
  if (_reminderCheckTimer) {
    clearTimeout(_reminderCheckTimer);
    _reminderCheckTimer = null;
  }
}

export function getPendingBillingReminders(): LocalNotificationRecord[] {
  return getUnreadBillingReminders().filter(
    (r) => !r.dismissed && (!r.shown_at || Date.now() - new Date(r.shown_at).getTime() > BILLING_REMINDER_COOLDOWN_MS),
  );
}

export async function dismissBillingReminder(id: string): Promise<void> {
  markNotificationDismissed(id);
  try {
    await markNotificationRead(id);
  } catch {
    // Non-critical
  }
}

export function formatBillingReminderForTUI(record: LocalNotificationRecord): string {
  const icon = record.notification_type === "grace_period" ? "Warning: " : " ";
  const lines: string[] = [`${icon}**${record.title}**`, record.body];
  if (record.action_label && record.action_url) {
    lines.push(`\n→ ${record.action_label}: https://pakalon.com${record.action_url}`);
  }
  return lines.join("\n");
}
