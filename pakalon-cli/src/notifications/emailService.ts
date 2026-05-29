/**
 * emailService.ts — Core email service for the CLI notification system.
 * Wraps backend email API calls for sending, tracking, and managing email notifications.
 */
import { getApiClient } from "@/api/client.js";
import type {
  EmailNotification,
  EmailListResponse,
  EmailDeliveryStatus,
  BillingReminderPayload,
  TrialExpirationPayload,
  NotificationPreferences,
} from "./types.js";

const EMAIL_BATCH_SIZE = 20;

export async function fetchEmailHistory(
  limit = EMAIL_BATCH_SIZE,
  offset = 0,
): Promise<EmailNotification[]> {
  try {
    const client = getApiClient();
    const { data } = await client.get<EmailListResponse>("/notifications/emails", {
      params: { limit, offset },
    });
    return data.emails ?? [];
  } catch {
    return [];
  }
}

export async function fetchEmailStatus(emailId: string): Promise<EmailDeliveryStatus | null> {
  try {
    const client = getApiClient();
    const { data } = await client.get<EmailDeliveryStatus>(`/notifications/emails/${emailId}/status`);
    return data;
  } catch {
    return null;
  }
}

export async function requestBillingReminder(payload: BillingReminderPayload): Promise<boolean> {
  try {
    const client = getApiClient();
    await client.post("/notifications/billing-reminders", payload);
    return true;
  } catch {
    return false;
  }
}

export async function requestTrialExpirationNotification(
  payload: TrialExpirationPayload,
): Promise<boolean> {
  try {
    const client = getApiClient();
    await client.post("/notifications/trial-expiration", payload);
    return true;
  } catch {
    return false;
  }
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences | null> {
  try {
    const client = getApiClient();
    const { data } = await client.get<NotificationPreferences>("/notifications/preferences");
    return data;
  } catch {
    return null;
  }
}

export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<boolean> {
  try {
    const client = getApiClient();
    await client.patch("/notifications/preferences", prefs);
    return true;
  } catch {
    return false;
  }
}

export async function retryFailedEmail(emailId: string): Promise<boolean> {
  try {
    const client = getApiClient();
    await client.post(`/notifications/emails/${emailId}/retry`);
    return true;
  } catch {
    return false;
  }
}

export function isWithinQuietHours(
  prefs: NotificationPreferences | null,
): boolean {
  if (!prefs?.quiet_hours_start || !prefs?.quiet_hours_end) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = prefs.quiet_hours_start.split(":").map(Number);
  const [endH, endM] = prefs.quiet_hours_end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}
