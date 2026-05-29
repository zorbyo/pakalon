/**
 * storage.ts — Local notification tracking for the CLI.
 * Persists notification state to disk for offline access and TUI display.
 */
import fs from "fs";
import path from "path";
import os from "os";
import type {
  LocalNotificationRecord,
  NotificationPreferences,
  NotificationType,
} from "./types.js";

function getConfigDir(): string {
  const base =
    process.env.PAKALON_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "pakalon")
      : path.join(os.homedir(), ".config", "pakalon"));

  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  }
  return base;
}

function getNotificationsPath(): string {
  return path.join(getConfigDir(), "notifications.json");
}

function getPreferencesPath(): string {
  return path.join(getConfigDir(), "notification_prefs.json");
}

function loadNotifications(): LocalNotificationRecord[] {
  const filePath = getNotificationsPath();
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as LocalNotificationRecord[];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: LocalNotificationRecord[]): void {
  const filePath = getNotificationsPath();
  const content = JSON.stringify(notifications, null, 2);
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

export function getNotificationRecords(): LocalNotificationRecord[] {
  return loadNotifications();
}

export function saveNotificationRecord(record: LocalNotificationRecord): void {
  const records = loadNotifications();
  const existingIndex = records.findIndex((r) => r.id === record.id);

  if (existingIndex >= 0) {
    records[existingIndex] = { ...records[existingIndex], ...record };
  } else {
    records.unshift(record);
  }

  const maxRecords = 100;
  const trimmed = records.slice(0, maxRecords);
  saveNotifications(trimmed);
}

export function markNotificationRead(id: string): void {
  const records = loadNotifications();
  const record = records.find((r) => r.id === id);
  if (record) {
    record.read = true;
    saveNotifications(records);
  }
}

export function markNotificationDismissed(id: string): void {
  const records = loadNotifications();
  const record = records.find((r) => r.id === id);
  if (record) {
    record.dismissed = true;
    record.read = true;
    saveNotifications(records);
  }
}

export function getUnreadNotifications(): LocalNotificationRecord[] {
  return loadNotifications().filter((r) => !r.read && !r.dismissed);
}

export function getUnreadBillingReminders(): LocalNotificationRecord[] {
  return loadNotifications().filter(
    (r) =>
      !r.read &&
      !r.dismissed &&
      (r.notification_type === "billing_reminder" ||
        r.notification_type === "subscription_renewal"),
  );
}

export function getUnreadTrialNotifications(): LocalNotificationRecord[] {
  return loadNotifications().filter(
    (r) =>
      !r.read &&
      !r.dismissed &&
      (r.notification_type === "trial_expiration" ||
        r.notification_type === "trial_expiring_soon"),
  );
}

export function clearOldNotifications(maxAgeDays: number = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const records = loadNotifications().filter((r) => {
    const created = new Date(r.created_at).getTime();
    return created > cutoff;
  });
  saveNotifications(records);
}

export function getNotificationCount(): {
  total: number;
  unread: number;
  billing: number;
  trial: number;
} {
  const records = loadNotifications();
  return {
    total: records.length,
    unread: records.filter((r) => !r.read && !r.dismissed).length,
    billing: records.filter(
      (r) =>
        r.notification_type === "billing_reminder" ||
        r.notification_type === "subscription_renewal",
    ).length,
    trial: records.filter(
      (r) =>
        r.notification_type === "trial_expiration" ||
        r.notification_type === "trial_expiring_soon",
    ).length,
  };
}

export function loadNotificationPreferences(): NotificationPreferences {
  const filePath = getPreferencesPath();
  if (!fs.existsSync(filePath)) {
    return {
      email_billing_reminders: true,
      email_trial_expiration: true,
      email_subscription_renewal: true,
      in_app_notifications: true,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return {
      email_billing_reminders: true,
      email_trial_expiration: true,
      email_subscription_renewal: true,
      in_app_notifications: true,
    };
  }
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  const filePath = getPreferencesPath();
  const content = JSON.stringify(prefs, null, 2);
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

export function updateNotificationPreferences(
  updates: Partial<NotificationPreferences>,
): NotificationPreferences {
  const current = loadNotificationPreferences();
  const updated = { ...current, ...updates };
  saveNotificationPreferences(updated);
  return updated;
}
