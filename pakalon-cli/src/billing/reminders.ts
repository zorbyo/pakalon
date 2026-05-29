/**
 * Email Billing Reminders
 *
 * Provides 7-day billing notification system for:
 * - Pro users: Daily reminders for 7 days before payment due
 * - Free users: Daily reminders for 7 days before trial expiration
 */

import logger from '@/utils/logger.js';

export interface BillingReminder {
  id: string;
  userId: string;
  email: string;
  type: 'payment_due' | 'trial_expiring' | 'subscription_expired';
  dueDate: Date;
  daysRemaining: number;
  sent: boolean;
  sentAt?: Date;
}

export interface ReminderConfig {
  enabled: boolean;
  daysBeforeDue: number;
  dailyReminders: boolean;
  emailProvider?: 'sendgrid' | 'ses' | 'smtp';
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
}

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: true,
  daysBeforeDue: 7,
  dailyReminders: true,
  fromEmail: 'billing@pakalon.com',
  fromName: 'Pakalon Billing',
};

let config: ReminderConfig = { ...DEFAULT_CONFIG };
const reminders: BillingReminder[] = [];

/**
 * Configure the reminder system
 */
export function configureReminders(newConfig: Partial<ReminderConfig>): void {
  config = { ...config, ...newConfig };
  logger.info('[billing-reminder] Configuration updated');
}

/**
 * Get current configuration
 */
export function getReminderConfig(): ReminderConfig {
  return { ...config };
}

/**
 * Create a billing reminder for a user
 */
export function createReminder(params: {
  userId: string;
  email: string;
  type: BillingReminder['type'];
  dueDate: Date;
}): BillingReminder {
  const now = new Date();
  const diffMs = params.dueDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const reminder: BillingReminder = {
    id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    email: params.email,
    type: params.type,
    dueDate: params.dueDate,
    daysRemaining,
    sent: false,
  };

  reminders.push(reminder);
  logger.info(`[billing-reminder] Created reminder for user ${params.userId}: ${params.type} in ${daysRemaining} days`);

  return reminder;
}

/**
 * Get reminders for a user
 */
export function getUserReminders(userId: string): BillingReminder[] {
  return reminders.filter((r) => r.userId === userId);
}

/**
 * Get pending reminders that need to be sent
 */
export function getPendingReminders(): BillingReminder[] {
  return reminders.filter((r) => !r.sent && r.daysRemaining <= config.daysBeforeDue);
}

/**
 * Mark a reminder as sent
 */
export function markReminderSent(reminderId: string): void {
  const reminder = reminders.find((r) => r.id === reminderId);
  if (reminder) {
    reminder.sent = true;
    reminder.sentAt = new Date();
    logger.info(`[billing-reminder] Marked reminder ${reminderId} as sent`);
  }
}

/**
 * Send a reminder email (placeholder - integrate with email provider)
 */
export async function sendReminderEmail(reminder: BillingReminder): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled) {
    return { success: false, error: 'Reminders are disabled' };
  }

  // Build email content based on reminder type
  const subject = buildSubject(reminder);
  const body = buildEmailBody(reminder);

  logger.info(`[billing-reminder] Sending email to ${reminder.email}: ${subject}`);

  // TODO: Integrate with actual email provider (SendGrid, SES, SMTP)
  // For now, just log the email content
  logger.info(`[billing-reminder] Email subject: ${subject}`);
  logger.info(`[billing-reminder] Email body: ${body}`);

  markReminderSent(reminder.id);

  return { success: true };
}

/**
 * Build email subject based on reminder type
 */
function buildSubject(reminder: BillingReminder): string {
  switch (reminder.type) {
    case 'payment_due':
      return `Pakalon: Payment due in ${reminder.daysRemaining} day${reminder.daysRemaining !== 1 ? 's' : ''}`;
    case 'trial_expiring':
      return `Pakalon: Your free trial expires in ${reminder.daysRemaining} day${reminder.daysRemaining !== 1 ? 's' : ''}`;
    case 'subscription_expired':
      return `Pakalon: Your subscription has expired`;
  }
}

/**
 * Build email body based on reminder type
 */
function buildEmailBody(reminder: BillingReminder): string {
  const dateStr = reminder.dueDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  switch (reminder.type) {
    case 'payment_due':
      return `
Hello,

Your Pakalon Pro subscription payment is due on ${dateStr}.

Days remaining: ${reminder.daysRemaining}

Please ensure your payment method is up to date to avoid service interruption.

To update your payment method, visit: https://pakalon.com/billing

Best regards,
The Pakalon Team
      `.trim();

    case 'trial_expiring':
      return `
Hello,

Your Pakalon free trial expires on ${dateStr}.

Days remaining: ${reminder.daysRemaining}

After your trial expires, you'll only have access to free models. Upgrade to Pro to continue using all models.

To upgrade, visit: https://pakalon.com/upgrade

Best regards,
The Pakalon Team
      `.trim();

    case 'subscription_expired':
      return `
Hello,

Your Pakalon Pro subscription has expired.

To regain access to all features, please renew your subscription.

To renew, visit: https://pakalon.com/upgrade

Best regards,
The Pakalon Team
      `.trim();
  }
}

/**
 * Process all pending reminders
 */
export async function processPendingReminders(): Promise<{ sent: number; failed: number }> {
  const pending = getPendingReminders();
  let sent = 0;
  let failed = 0;

  for (const reminder of pending) {
    const result = await sendReminderEmail(reminder);
    if (result.success) {
      sent++;
    } else {
      failed++;
      logger.error(`[billing-reminder] Failed to send reminder ${reminder.id}: ${result.error}`);
    }
  }

  logger.info(`[billing-reminder] Processed ${pending.length} reminders: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

/**
 * Clean up old reminders (older than 30 days)
 */
export function cleanupOldReminders(): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const initialCount = reminders.length;
  const filtered = reminders.filter((r) => r.dueDate >= cutoff);

  reminders.length = 0;
  reminders.push(...filtered);

  const removed = initialCount - reminders.length;
  if (removed > 0) {
    logger.info(`[billing-reminder] Cleaned up ${removed} old reminders`);
  }

  return removed;
}

/**
 * Get reminder statistics
 */
export function getReminderStats(): {
  total: number;
  pending: number;
  sent: number;
  byType: Record<BillingReminder['type'], number>;
} {
  const byType: Record<BillingReminder['type'], number> = {
    payment_due: 0,
    trial_expiring: 0,
    subscription_expired: 0,
  };

  for (const reminder of reminders) {
    byType[reminder.type]++;
  }

  return {
    total: reminders.length,
    pending: reminders.filter((r) => !r.sent).length,
    sent: reminders.filter((r) => r.sent).length,
    byType,
  };
}
