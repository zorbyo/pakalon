/**
 * emailTemplates.ts — Email template definitions for the notification system.
 * Provides HTML/text templates for billing reminders, trial expiration, and subscription renewal.
 */

export interface TemplateVariables {
  display_name: string;
  days_remaining?: number;
  upgrade_url?: string;
  billing_url?: string;
  amount_usd?: number;
  period_end?: string;
  trial_end?: string;
  features_list?: string[];
}

const BASE_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
  .header { background: #0070f3; padding: 32px; text-align: center; }
  .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
  .content { padding: 32px; }
  .content h2 { color: #111827; margin-top: 0; }
  .content p { color: #4b5563; line-height: 1.6; }
  .button { display: inline-block; background: #0070f3; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 16px 0; }
  .button-danger { background: #e53e3e; }
  .warning-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; margin: 16px 0; border-radius: 4px; }
  .footer { background: #f9fafb; padding: 24px; text-align: center; color: #6b7280; font-size: 12px; }
  .features { list-style: none; padding: 0; }
  .features li { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .features li:last-child { border-bottom: none; }
`;

function wrapTemplate(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
${body}
<div style="background:#f9fafb;padding:24px;text-align:center;color:#6b7280;font-size:12px;">
<p style="margin:0;">You received this email because you have a Pakalon account.</p>
<p style="margin:8px 0 0;">&copy; ${new Date().getFullYear()} Pakalon. All rights reserved.</p>
</div>
</div>
</body>
</html>`;
}

export const templates = {
  billingReminder7Day: (vars: TemplateVariables): { subject: string; html: string; text: string } => {
    const subject = `Payment reminder: Your Pakalon billing cycle ends in ${vars.days_remaining} days`;
    const html = wrapTemplate(`
      <div style="background:#0070f3;padding:32px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Billing Reminder</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#111827;margin-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Hi ${vars.display_name},</h2>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your current Pakalon billing cycle will end in <strong>${vars.days_remaining} days</strong>.
          ${vars.amount_usd ? `Your plan costs $${vars.amount_usd}/month.` : ""}
        </p>
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;color:#856404;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            No action is needed if you want to continue your subscription. Your payment method will be charged automatically.
          </p>
        </div>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          To manage your billing settings or update your payment method:
        </p>
        <a href="${vars.billing_url ?? "https://pakalon.com/dashboard/billing"}" style="display:inline-block;background:#0070f3;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Manage Billing
        </a>
      </div>
    `);
    const text = `Hi ${vars.display_name},\n\nYour Pakalon billing cycle ends in ${vars.days_remaining} days. No action is needed to continue your subscription.\n\nManage billing: ${vars.billing_url ?? "https://pakalon.com/dashboard/billing"}\n\n— The Pakalon Team`;
    return { subject, html, text };
  },

  trialExpiringSoon: (vars: TemplateVariables): { subject: string; html: string; text: string } => {
    const subject = `Your Pakalon free trial ends in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}`;
    const html = wrapTemplate(`
      <div style="background:#f59e0b;padding:32px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Trial Expiring Soon</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#111827;margin-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Hi ${vars.display_name},</h2>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your Pakalon free trial has <strong>${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""} remaining</strong>.
        </p>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Upgrade to Pakalon Pro for $22/month to keep full access to all features:
        </p>
        <ul style="list-style:none;padding:0;">
          ${(vars.features_list ?? ["Unlimited AI model access", "Priority support", "Advanced analytics", "Team collaboration"]).map(f =>
            `<li style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#4b5563;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">[OK] ${f}</li>`
          ).join("")}
        </ul>
        <a href="${vars.upgrade_url ?? "https://pakalon.com/pricing"}" style="display:inline-block;background:#0070f3;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Upgrade to Pro — $22/mo
        </a>
      </div>
    `);
    const text = `Hi ${vars.display_name},\n\nYour Pakalon free trial ends in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}.\n\nUpgrade to Pro for $22/month to keep full access.\n\nUpgrade: ${vars.upgrade_url ?? "https://pakalon.com/pricing"}\n\n— The Pakalon Team`;
    return { subject, html, text };
  },

  trialExpired: (vars: TemplateVariables): { subject: string; html: string; text: string } => {
    const subject = "Your Pakalon free trial has expired";
    const html = wrapTemplate(`
      <div style="background:#e53e3e;padding:32px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Trial Expired</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#111827;margin-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Hi ${vars.display_name},</h2>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your Pakalon free trial has <strong>expired</strong>. Your account has been moved to the free plan.
        </p>
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;color:#856404;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            With the free plan, you still have access to free-tier AI models. Upgrade to Pro for unlimited access to all models.
          </p>
        </div>
        <a href="${vars.upgrade_url ?? "https://pakalon.com/pricing"}" style="display:inline-block;background:#0070f3;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Upgrade to Pro
        </a>
      </div>
    `);
    const text = `Hi ${vars.display_name},\n\nYour Pakalon free trial has expired. Your account is now on the free plan.\n\nYou still have access to free-tier models. Upgrade to Pro for unlimited access.\n\nUpgrade: ${vars.upgrade_url ?? "https://pakalon.com/pricing"}\n\n— The Pakalon Team`;
    return { subject, html, text };
  },

  subscriptionRenewal: (vars: TemplateVariables): { subject: string; html: string; text: string } => {
    const subject = `Your Pakalon Pro subscription renews in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}`;
    const html = wrapTemplate(`
      <div style="background:#0070f3;padding:32px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Subscription Renewal</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#111827;margin-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Hi ${vars.display_name},</h2>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your Pakalon Pro subscription will renew in <strong>${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}</strong>.
        </p>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your subscription is set to automatically renew on your billing date.
          If you'd like to manage or cancel your subscription, you can do so from your dashboard.
        </p>
        <a href="${vars.billing_url ?? "https://pakalon.com/dashboard/billing"}" style="display:inline-block;background:#0070f3;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Manage Subscription
        </a>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Thank you for being a Pakalon Pro member!
        </p>
      </div>
    `);
    const text = `Hi ${vars.display_name},\n\nYour Pakalon Pro subscription renews in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}.\n\nManage subscription: ${vars.billing_url ?? "https://pakalon.com/dashboard/billing"}\n\nThank you for being a Pakalon Pro member!\n\n— The Pakalon Team`;
    return { subject, html, text };
  },

  gracePeriodWarning: (vars: TemplateVariables): { subject: string; html: string; text: string } => {
    const subject = `Warning: Your Pakalon Pro access ends in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}`;
    const html = wrapTemplate(`
      <div style="background:#e53e3e;padding:32px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Access Ending Soon</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#111827;margin-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Hi ${vars.display_name},</h2>
        <p style="color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Your Pakalon account is currently in its <strong>grace period</strong>, which ends in
          <strong>${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}</strong>.
        </p>
        <div style="background:#fee;border-left:4px solid #e53e3e;padding:16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;color:#c53030;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            After the grace period ends, your account will be locked and all stored sessions will become read-only.
          </p>
        </div>
        <a href="${vars.upgrade_url ?? "https://pakalon.com/pricing"}" style="display:inline-block;background:#e53e3e;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          Re-subscribe — $22/mo
        </a>
      </div>
    `);
    const text = `Hi ${vars.display_name},\n\nYour Pakalon grace period ends in ${vars.days_remaining} day${vars.days_remaining !== 1 ? "s" : ""}. After that, your account will be locked.\n\nRe-subscribe: ${vars.upgrade_url ?? "https://pakalon.com/pricing"}\n\n— The Pakalon Team`;
    return { subject, html, text };
  },
} as const;

export type TemplateName = keyof typeof templates;

export function getTemplate(name: TemplateName, vars: TemplateVariables) {
  return templates[name](vars);
}
