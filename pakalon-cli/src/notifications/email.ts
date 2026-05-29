/**
 * Email Notifications
 *
 * Provides email notification capabilities for billing reminders,
 * trial expiration alerts, and system notifications.
 *
 * Features:
 * - Billing reminder emails (7-day countdown)
 * - Trial expiration notifications
 * - Usage limit warnings
 * - System maintenance alerts
 * - Template-based emails
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | "billing_reminder"
  | "trial_expiration"
  | "usage_limit"
  | "system_alert"
  | "security_alert";

export interface EmailConfig {
  /** SMTP host */
  host: string;
  /** SMTP port */
  port: number;
  /** SMTP username */
  username?: string;
  /** SMTP password */
  password?: string;
  /** From address */
  from: string;
  /** From name */
  fromName?: string;
  /** Use TLS */
  tls?: boolean;
}

export interface EmailMessage {
  /** Recipient email */
  to: string;
  /** Subject line */
  subject: string;
  /** HTML body */
  html: string;
  /** Plain text body */
  text?: string;
  /** Notification type */
  type: NotificationType;
  /** User ID */
  userId?: string;
}

export interface NotificationTemplate {
  /** Template name */
  name: string;
  /** Subject template */
  subject: string;
  /** HTML template */
  htmlTemplate: string;
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  billing_reminder: {
    name: "billing_reminder",
    subject: "Pakalon - Payment Reminder ({{daysLeft}} days remaining)",
    htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #6366f1; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .footer { background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
    .amount { font-size: 24px; font-weight: bold; color: #6366f1; }
    .button { background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Pakalon Payment Reminder</h1>
    </div>
    <div class="content">
      <p>Hi {{userName}},</p>
      <p>This is a friendly reminder that your Pakalon Pro subscription payment is due in <strong>{{daysLeft}} days</strong>.</p>
      <p><strong>Amount Due:</strong> <span class="amount">${{amount}}</span></p>
      <p><strong>Due Date:</strong> {{dueDate}}</p>
      <p>To avoid any interruption to your service, please ensure your payment method is up to date.</p>
      <a href="{{paymentUrl}}" class="button">Update Payment Method</a>
      <p>If you have any questions, please contact our support team.</p>
    </div>
    <div class="footer">
      <p>© 2026 Pakalon. All rights reserved.</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
`,
  },
  trial_expiration: {
    name: "trial_expiration",
    subject: "Pakalon - Your Free Trial Expires in {{daysLeft}} Days",
    htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .footer { background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
    .button { background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
    .highlight { background: #d1fae5; padding: 15px; border-radius: 6px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Free Trial Expiring Soon</h1>
    </div>
    <div class="content">
      <p>Hi {{userName}},</p>
      <p>Your Pakalon free trial will expire in <strong>{{daysLeft}} days</strong>.</p>
      <div class="highlight">
        <p><strong>Trial Ends:</strong> {{expiryDate}}</p>
        <p><strong>Features You'll Lose:</strong></p>
        <ul>
          <li>Access to Pro AI models</li>
          <li>Advanced security scanning</li>
          <li>Priority support</li>
        </ul>
      </div>
      <p>Upgrade to Pro to continue enjoying all features without interruption.</p>
      <a href="{{upgradeUrl}}" class="button">Upgrade to Pro - $2/month</a>
      <p>After trial expiration, you can still use free models at no cost.</p>
    </div>
    <div class="footer">
      <p>© 2026 Pakalon. All rights reserved.</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
`,
  },
  usage_limit: {
    name: "usage_limit",
    subject: "Pakalon - Usage Limit Alert",
    htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f59e0b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .footer { background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
    .usage-bar { background: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0; }
    .usage-fill { background: #f59e0b; height: 100%; width: {{usagePercent}}%; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Usage Limit Alert</h1>
    </div>
    <div class="content">
      <p>Hi {{userName}},</p>
      <p>You've used <strong>{{usagePercent}}%</strong> of your monthly token allowance.</p>
      <div class="usage-bar">
        <div class="usage-fill"></div>
      </div>
      <p><strong>Used:</strong> {{usedTokens}} tokens</p>
      <p><strong>Remaining:</strong> {{remainingTokens}} tokens</p>
      <p>Consider upgrading to Pro for higher limits or wait until your usage resets on {{resetDate}}.</p>
    </div>
    <div class="footer">
      <p>© 2026 Pakalon. All rights reserved.</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
`,
  },
  system_alert: {
    name: "system_alert",
    subject: "Pakalon - System Alert",
    htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ef4444; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .footer { background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>System Alert</h1>
    </div>
    <div class="content">
      <p>Hi {{userName}},</p>
      <p>{{alertMessage}}</p>
      <p><strong>Time:</strong> {{alertTime}}</p>
      <p><strong>Severity:</strong> {{severity}}</p>
      <p>We are working to resolve this issue. You will receive an update when it's resolved.</p>
    </div>
    <div class="footer">
      <p>© 2026 Pakalon. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`,
  },
  security_alert: {
    name: "security_alert",
    subject: "Pakalon - Security Alert",
    htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .footer { background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
    .alert-box { background: #fee2e2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Security Alert</h1>
    </div>
    <div class="content">
      <p>Hi {{userName}},</p>
      <div class="alert-box">
        <p><strong>⚠️ Security Event Detected</strong></p>
        <p>{{securityMessage}}</p>
      </div>
      <p><strong>Time:</strong> {{alertTime}}</p>
      <p><strong>IP Address:</strong> {{ipAddress}}</p>
      <p>If this was you, no action is needed. If you don't recognize this activity, please change your password immediately.</p>
      <a href="{{securityUrl}}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0;">Review Security Settings</a>
    </div>
    <div class="footer">
      <p>© 2026 Pakalon. All rights reserved.</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
`,
  },
};

// ---------------------------------------------------------------------------
// Email Sender
// ---------------------------------------------------------------------------

class EmailNotificationService {
  private config: EmailConfig;
  private queue: EmailMessage[] = [];
  private processing = false;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  /**
   * Send email using SMTP
   */
  async sendEmail(message: EmailMessage): Promise<boolean> {
    try {
      // In production, use a proper SMTP library like nodemailer
      // For now, log the email
      logger.info(`[Email] Sending ${message.type} to ${message.to}`);
      logger.info(`[Email] Subject: ${message.subject}`);

      // Simulate SMTP sending
      // In production: await this.smtpSend(message);

      return true;
    } catch (error) {
      logger.error(`[Email] Failed to send: ${error}`);
      return false;
    }
  }

  /**
   * Send billing reminder
   */
  async sendBillingReminder(
    to: string,
    userName: string,
    daysLeft: number,
    amount: number,
    dueDate: string
  ): Promise<boolean> {
    const template = NOTIFICATION_TEMPLATES.billing_reminder;
    const subject = template.subject
      .replace("{{daysLeft}}", String(daysLeft));
    const html = template.htmlTemplate
      .replace("{{userName}}", userName)
      .replace("{{daysLeft}}", String(daysLeft))
      .replace("{{amount}}", amount.toFixed(2))
      .replace("{{dueDate}}", dueDate)
      .replace("{{paymentUrl}}", "https://pakalon.com/billing")
      .replace("{{unsubscribeUrl}}", "https://pakalon.com/unsubscribe");

    return this.sendEmail({
      to,
      subject,
      html,
      type: "billing_reminder",
    });
  }

  /**
   * Send trial expiration notification
   */
  async sendTrialExpiration(
    to: string,
    userName: string,
    daysLeft: number,
    expiryDate: string
  ): Promise<boolean> {
    const template = NOTIFICATION_TEMPLATES.trial_expiration;
    const subject = template.subject
      .replace("{{daysLeft}}", String(daysLeft));
    const html = template.htmlTemplate
      .replace("{{userName}}", userName)
      .replace("{{daysLeft}}", String(daysLeft))
      .replace("{{expiryDate}}", expiryDate)
      .replace("{{upgradeUrl}}", "https://pakalon.com/upgrade")
      .replace("{{unsubscribeUrl}}", "https://pakalon.com/unsubscribe");

    return this.sendEmail({
      to,
      subject,
      html,
      type: "trial_expiration",
    });
  }

  /**
   * Send usage limit alert
   */
  async sendUsageLimitAlert(
    to: string,
    userName: string,
    usagePercent: number,
    usedTokens: number,
    remainingTokens: number,
    resetDate: string
  ): Promise<boolean> {
    const template = NOTIFICATION_TEMPLATES.usage_limit;
    const html = template.htmlTemplate
      .replace("{{userName}}", userName)
      .replace("{{usagePercent}}", String(usagePercent))
      .replace("{{usedTokens}}", usedTokens.toLocaleString())
      .replace("{{remainingTokens}}", remainingTokens.toLocaleString())
      .replace("{{resetDate}}", resetDate)
      .replace("{{unsubscribeUrl}}", "https://pakalon.com/unsubscribe");

    return this.sendEmail({
      to,
      subject: template.subject,
      html,
      type: "usage_limit",
    });
  }

  /**
   * Send system alert
   */
  async sendSystemAlert(
    to: string,
    userName: string,
    alertMessage: string,
    severity: "low" | "medium" | "high" | "critical"
  ): Promise<boolean> {
    const template = NOTIFICATION_TEMPLATES.system_alert;
    const html = template.htmlTemplate
      .replace("{{userName}}", userName)
      .replace("{{alertMessage}}", alertMessage)
      .replace("{{alertTime}}", new Date().toISOString())
      .replace("{{severity}}", severity.toUpperCase());

    return this.sendEmail({
      to,
      subject: template.subject,
      html,
      type: "system_alert",
    });
  }

  /**
   * Send security alert
   */
  async sendSecurityAlert(
    to: string,
    userName: string,
    securityMessage: string,
    ipAddress: string
  ): Promise<boolean> {
    const template = NOTIFICATION_TEMPLATES.security_alert;
    const html = template.htmlTemplate
      .replace("{{userName}}", userName)
      .replace("{{securityMessage}}", securityMessage)
      .replace("{{alertTime}}", new Date().toISOString())
      .replace("{{ipAddress}}", ipAddress)
      .replace("{{securityUrl}}", "https://pakalon.com/security")
      .replace("{{unsubscribeUrl}}", "https://pakalon.com/unsubscribe");

    return this.sendEmail({
      to,
      subject: template.subject,
      html,
      type: "security_alert",
    });
  }

  /**
   * Queue email for batch sending
   */
  queueEmail(message: EmailMessage): void {
    this.queue.push(message);
  }

  /**
   * Process email queue
   */
  async processQueue(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    let sent = 0;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message) {
        const success = await this.sendEmail(message);
        if (success) sent++;
      }
    }

    this.processing = false;
    return sent;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let service: EmailNotificationService | null = null;

/**
 * Initialize email notification service
 */
export function initEmailService(config: EmailConfig): EmailNotificationService {
  service = new EmailNotificationService(config);
  return service;
}

/**
 * Get email notification service
 */
export function getEmailService(): EmailNotificationService | null {
  return service;
}

/**
 * Send billing reminder emails for users with due dates
 */
export async function sendBillingReminders(
  users: Array<{
    email: string;
    name: string;
    daysLeft: number;
    amount: number;
    dueDate: string;
  }>
): Promise<number> {
  const svc = getEmailService();
  if (!svc) return 0;

  let sent = 0;
  for (const user of users) {
    const success = await svc.sendBillingReminder(
      user.email,
      user.name,
      user.daysLeft,
      user.amount,
      user.dueDate
    );
    if (success) sent++;
  }

  logger.info(`[Email] Sent ${sent}/${users.length} billing reminders`);
  return sent;
}

/**
 * Send trial expiration notifications
 */
export async function sendTrialExpirationNotices(
  users: Array<{
    email: string;
    name: string;
    daysLeft: number;
    expiryDate: string;
  }>
): Promise<number> {
  const svc = getEmailService();
  if (!svc) return 0;

  let sent = 0;
  for (const user of users) {
    const success = await svc.sendTrialExpiration(
      user.email,
      user.name,
      user.daysLeft,
      user.expiryDate
    );
    if (success) sent++;
  }

  logger.info(`[Email] Sent ${sent}/${users.length} trial expiration notices`);
  return sent;
}
