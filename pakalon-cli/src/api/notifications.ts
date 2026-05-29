/**
 * notifications.ts — In-app notification API client.
 * Wraps GET /notifications, PATCH /notifications/{id}/read, POST /notifications/read-all.
 * Used by ChatScreen to poll for billing reminders and system alerts on startup.
 */
import { getApiClient } from "@/api/client.js";

export interface AppNotification {
  id: string;
  notification_type: string; // "billing_reminder" | "grace_period" | "trial_expiration" | "trial_expiring_soon" | "system" | "announcement"
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  read: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface NotificationListResponse {
  notifications: AppNotification[];
  total: number;
  unread_count: number;
}

export interface EmailNotification {
  id: string;
  user_id: string;
  to_email: string;
  subject: string;
  email_type: string;
  status: "pending" | "sending" | "sent" | "failed";
  retry_count: number;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface EmailListResponse {
  emails: EmailNotification[];
  total: number;
}

export interface EmailDeliveryStatus {
  email_id: string;
  status: string;
  sent_at: string | null;
  error_message: string | null;
  retry_count: number;
}

export interface NotificationPreferences {
  email_billing_reminders: boolean;
  email_trial_expiration: boolean;
  email_subscription_renewal: boolean;
  in_app_notifications: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

/**
 * Fetch the user's unread (or all) notifications from the backend.
 * Returns an empty list on auth errors or network failure (non-throwing).
 */
export async function fetchNotifications(
  unreadOnly = true,
  limit = 10,
): Promise<AppNotification[]> {
  try {
    const client = getApiClient();
    const { data } = await client.get<NotificationListResponse>("/notifications", {
      params: { unread_only: unreadOnly, limit },
    });
    return data.notifications ?? [];
  } catch {
    return [];
  }
}

/**
 * Mark a single notification as read. Non-throwing.
 */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    const client = getApiClient();
    await client.patch(`/notifications/${id}/read`);
  } catch {
    // Ignore — read state will be re-synced on next poll
  }
}

/**
 * Mark all notifications as read. Non-throwing.
 */
export async function markAllNotificationsRead(): Promise<void> {
  try {
    const client = getApiClient();
    await client.post("/notifications/read-all");
  } catch {
    // Ignore
  }
}

/**
 * Format a notification for TUI display as an info message.
 * Billing reminders use a  prefix; grace-period warnings use a Warning: prefix.
 */
export function formatNotificationForTUI(n: AppNotification): string {
  const icon =
    n.notification_type === "grace_period"
      ? "Warning: "
      : n.notification_type === "billing_reminder" || n.notification_type === "subscription_renewal"
        ? " "
        : n.notification_type === "trial_expiration" || n.notification_type === "trial_expiring_soon"
          ? " "
          : n.notification_type === "system"
            ? "[Bell] "
            : "[Loudspeaker] ";

  const lines: string[] = [`${icon}**${n.title}**`, n.body];
  if (n.action_label && n.action_url) {
    lines.push(`\n→ ${n.action_label}: https://pakalon.com${n.action_url}`);
  }
  return lines.join("\n");
}

/**
 * Fetch user's email delivery history.
 */
export async function fetchEmailHistory(
  limit = 50,
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

/**
 * Fetch delivery status for a specific email.
 */
export async function fetchEmailStatus(emailId: string): Promise<EmailDeliveryStatus | null> {
  try {
    const client = getApiClient();
    const { data } = await client.get<EmailDeliveryStatus>(`/notifications/emails/${emailId}/status`);
    return data;
  } catch {
    return null;
  }
}

/**
 * Retry a failed email delivery.
 */
export async function retryFailedEmail(emailId: string): Promise<boolean> {
  try {
    const client = getApiClient();
    await client.post(`/notifications/emails/${emailId}/retry`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch notification preferences.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences | null> {
  try {
    const client = getApiClient();
    const { data } = await client.get<NotificationPreferences>("/notifications/preferences");
    return data;
  } catch {
    return null;
  }
}

/**
 * Update notification preferences.
 */
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
