/**
 * types.ts — TypeScript type definitions for the email notification system.
 */

export type NotificationType =
  | "billing_reminder"
  | "trial_expiration"
  | "trial_expiring_soon"
  | "subscription_renewal"
  | "grace_period"
  | "system"
  | "announcement";

export type EmailStatus = "pending" | "sending" | "sent" | "failed";

export interface EmailNotification {
  id: string;
  user_id: string;
  to_email: string;
  subject: string;
  email_type: string;
  status: EmailStatus;
  retry_count: number;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  notification_type: NotificationType;
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

export interface EmailListResponse {
  emails: EmailNotification[];
  total: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlTemplate: string;
  textTemplate: string;
  variables: string[];
}

export interface BillingReminderPayload {
  user_id: string;
  email: string;
  display_name: string;
  days_remaining: number;
  plan: "free" | "pro";
  amount_usd?: number;
  period_end?: string;
}

export interface TrialExpirationPayload {
  user_id: string;
  email: string;
  display_name: string;
  days_remaining: number;
  trial_end: string;
}

export interface NotificationCreateRequest {
  user_id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  action_url?: string;
  action_label?: string;
  expires_at?: string;
}

export interface NotificationReadResponse {
  id: string;
  read: boolean;
}

export interface LocalNotificationRecord {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  dismissed: boolean;
  created_at: string;
  shown_at: string | null;
  action_url: string | null;
  action_label: string | null;
}

export interface NotificationPreferences {
  email_billing_reminders: boolean;
  email_trial_expiration: boolean;
  email_subscription_renewal: boolean;
  in_app_notifications: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

export interface EmailDeliveryStatus {
  email_id: string;
  status: EmailStatus;
  sent_at: string | null;
  error_message: string | null;
  retry_count: number;
}
