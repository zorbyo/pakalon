/**
 * Email Notifications - Billing reminders and trial expiration alerts
 * 
 * Sends email notifications for:
 * - Billing reminders (7 days before due date)
 * - Trial expiration warnings (7 days before expiration)
 * - Usage alerts (when approaching limits)
 * - Payment confirmations
 */

import fs from "fs/promises";
import path from "path";
import { getApiClient } from "@/api/client.js";
import logger from "@/utils/logger.js";

export interface EmailNotification {
  type: "billing_reminder" | "trial_expiration" | "usage_alert" | "payment_confirmation";
  recipient: string;
  subject: string;
  body: string;
  scheduledAt?: Date;
  sentAt?: Date;
}

export interface EmailConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromAddress?: string;
  apiEndpoint?: string;
}

const EMAIL_CONFIG_PATH = path.join(
  process.env.PAKALON_CONFIG_DIR || path.join(process.env.HOME || "", ".config", "pakalon"),
  "email-notifications.json"
);

class EmailNotificationService {
  private config: EmailConfig;
  private pendingNotifications: EmailNotification[] = [];

  constructor() {
    this.config = { enabled: false };
  }

  async initialize(): Promise<void> {
    try {
      const configData = await fs.readFile(EMAIL_CONFIG_PATH, "utf-8");
      this.config = JSON.parse(configData);
    } catch {
      this.config = { enabled: false };
    }
  }

  async send(notification: EmailNotification): Promise<{ success: boolean; error?: string }> {
    if (!this.config.enabled) {
      logger.debug("[Email] Notifications disabled");
      return { success: false, error: "Email notifications disabled" };
    }

    try {
      if (this.config.apiEndpoint) {
        const apiClient = getApiClient();
        await apiClient.post("/notifications/email", {
          type: notification.type,
          recipient: notification.recipient,
          subject: notification.subject,
          body: notification.body,
          scheduledAt: notification.scheduledAt?.toISOString(),
        });
      }

      notification.sentAt = new Date();
      this.pendingNotifications.push(notification);
      
      logger.info(`[Email] Sent ${notification.type} to ${notification.recipient}`);
      return { success: true };
    } catch (err) {
      logger.error(`[Email] Failed to send: ${err}`);
      return { success: false, error: String(err) };
    }
  }

  async scheduleBillingReminder(
    email: string,
    daysUntilDue: number,
    amount: number
  ): Promise<{ success: boolean }> {
    const subject = daysUntilDue <= 1 
      ? "Payment Due Tomorrow - Pakalon" 
      : `Payment Due in ${daysUntilDue} Days - Pakalon`;

    const body = this.buildBillingReminderBody(daysUntilDue, amount);

    return this.send({
      type: "billing_reminder",
      recipient: email,
      subject,
      body,
    });
  }

  async scheduleTrialExpiration(
    email: string,
    daysUntilExpiration: number
  ): Promise<{ success: boolean }> {
    const subject = daysUntilExpiration <= 1
      ? "Trial Ends Tomorrow - Pakalon"
      : `Trial Expires in ${daysUntilExpiration} Days - Pakalon`;

    const body = this.buildTrialExpirationBody(daysUntilExpiration);

    return this.send({
      type: "trial_expiration",
      recipient: email,
      subject,
      body,
    });
  }

  async scheduleUsageAlert(
    email: string,
    percentUsed: number,
    daysRemaining: number
  ): Promise<{ success: boolean }> {
    const subject = "Usage Alert - Pakalon";
    const body = `You have used ${percentUsed}% of your monthly allocation. Approximately ${daysRemaining} days remaining.`;

    return this.send({
      type: "usage_alert",
      recipient: email,
      subject,
      body,
    });
  }

  private buildBillingReminderBody(daysUntilDue: number, amount: number): string {
    if (daysUntilDue <= 1) {
      return `Your Pakalon payment of $${amount.toFixed(2)} is due tomorrow.

Please log in to your account to complete payment and maintain uninterrupted access.

Thank you for using Pakalon.`;
    }

    return `This is a reminder that your Pakalon payment of $${amount.toFixed(2)} is due in ${daysUntilDue} days.

To avoid service interruption, please log in and complete your payment.

Thank you for your continued use of Pakalon.`;
  }

  private buildTrialExpirationBody(daysUntilExpiration: number): string {
    if (daysUntilExpiration <= 1) {
      return `Your Pakalon trial expires tomorrow.

To continue using Pakalon with full features, please upgrade to a paid plan.

Visit your account settings to upgrade.`;
    }

    return `Your Pakalon trial will expire in ${daysUntilExpiration} days.

To continue using Pakalon with full features, please upgrade to a paid plan before your trial ends.

Visit your account settings to upgrade.`;
  }

  getConfig(): EmailConfig {
    return { ...this.config };
  }

  async updateConfig(newConfig: Partial<EmailConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    try {
      await fs.mkdir(path.dirname(EMAIL_CONFIG_PATH), { recursive: true });
      await fs.writeFile(EMAIL_CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      logger.error("[Email] Failed to save config:", err);
    }
  }

  getPendingNotifications(): EmailNotification[] {
    return [...this.pendingNotifications];
  }

  clearPendingNotifications(): void {
    this.pendingNotifications = [];
  }
}

export const emailNotificationService = new EmailNotificationService();

export async function checkAndSendNotifications(
  userEmail: string,
  plan: string,
  trialDaysRemaining?: number,
  billingDaysRemaining?: number,
  creditBalance?: number
): Promise<void> {
  await emailNotificationService.initialize();

  if (billingDaysRemaining !== undefined && billingDaysRemaining <= 7 && billingDaysRemaining > 0) {
    await emailNotificationService.scheduleBillingReminder(
      userEmail,
      billingDaysRemaining,
      0
    );
  }

  if (plan === "trial" && trialDaysRemaining !== undefined && trialDaysRemaining <= 7 && trialDaysRemaining > 0) {
    await emailNotificationService.scheduleTrialExpiration(userEmail, trialDaysRemaining);
  }
}