import { logger } from "@oh-my-pi/pi-utils";

export interface BillingReminder {
	id: string;
	userId: string;
	email: string;
	type: "payment_due" | "trial_expiring" | "subscription_expired";
	dueDate: Date;
	daysRemaining: number;
	sent: boolean;
	sentAt?: Date;
}

export interface ReminderConfig {
	enabled: boolean;
	daysBeforeDue: number;
	dailyReminders: boolean;
	emailProvider?: "sendgrid" | "ses" | "smtp";
	apiKey?: string;
	fromEmail?: string;
	fromName?: string;
}

const DEFAULT_CONFIG: ReminderConfig = {
	enabled: true,
	daysBeforeDue: 7,
	dailyReminders: true,
	fromEmail: "billing@pakalon.com",
	fromName: "Pakalon Billing",
};

let config: ReminderConfig = { ...DEFAULT_CONFIG };
const reminders: BillingReminder[] = [];

export function configureReminders(newConfig: Partial<ReminderConfig>): void {
	config = { ...config, ...newConfig };
	logger.info("Billing reminder configuration updated");
}

export function getReminderConfig(): ReminderConfig {
	return { ...config };
}

export function createReminder(params: {
	userId: string;
	email: string;
	type: BillingReminder["type"];
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
	logger.info("Created billing reminder", {
		userId: params.userId,
		type: params.type,
		daysRemaining,
	});

	return reminder;
}

export function getUserReminders(userId: string): BillingReminder[] {
	return reminders.filter(r => r.userId === userId);
}

export function getPendingReminders(): BillingReminder[] {
	return reminders.filter(r => !r.sent && r.daysRemaining <= config.daysBeforeDue);
}

export function markReminderSent(reminderId: string): void {
	const reminder = reminders.find(r => r.id === reminderId);
	if (reminder) {
		reminder.sent = true;
		reminder.sentAt = new Date();
		logger.info("Marked reminder sent", { reminderId });
	}
}

export async function sendReminderEmail(reminder: BillingReminder): Promise<{ success: boolean; error?: string }> {
	if (!config.enabled) {
		return { success: false, error: "Reminders are disabled" };
	}

	const subject = buildSubject(reminder);
	const body = buildEmailBody(reminder);

	logger.info("Sending billing reminder email", {
		email: reminder.email,
		subject,
	});

	// TODO: Integrate with actual email provider (SendGrid, SES, SMTP)
	logger.info("Reminder email body", { body });

	markReminderSent(reminder.id);
	return { success: true };
}

function buildSubject(reminder: BillingReminder): string {
	switch (reminder.type) {
		case "payment_due":
			return `Pakalon: Payment due in ${reminder.daysRemaining} day${reminder.daysRemaining !== 1 ? "s" : ""}`;
		case "trial_expiring":
			return `Pakalon: Your free trial expires in ${reminder.daysRemaining} day${reminder.daysRemaining !== 1 ? "s" : ""}`;
		case "subscription_expired":
			return "Pakalon: Your subscription has expired";
	}
}

function buildEmailBody(reminder: BillingReminder): string {
	const dateStr = reminder.dueDate.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	switch (reminder.type) {
		case "payment_due":
			return [
				"Hello,",
				"",
				`Your Pakalon Pro subscription payment is due on ${dateStr}.`,
				"",
				`Days remaining: ${reminder.daysRemaining}`,
				"",
				"Please ensure your payment method is up to date to avoid service interruption.",
				"",
				"To update your payment method, visit: https://pakalon.com/billing",
				"",
				"Best regards,",
				"The Pakalon Team",
			].join("\n");
		case "trial_expiring":
			return [
				"Hello,",
				"",
				`Your Pakalon free trial expires on ${dateStr}.`,
				"",
				`Days remaining: ${reminder.daysRemaining}`,
				"",
				"After your trial expires, you'll only have access to free models. Upgrade to Pro to continue using all models.",
				"",
				"To upgrade, visit: https://pakalon.com/upgrade",
				"",
				"Best regards,",
				"The Pakalon Team",
			].join("\n");
		case "subscription_expired":
			return [
				"Hello,",
				"",
				"Your Pakalon Pro subscription has expired.",
				"",
				"To regain access to all features, please renew your subscription.",
				"",
				"To renew, visit: https://pakalon.com/upgrade",
				"",
				"Best regards,",
				"The Pakalon Team",
			].join("\n");
	}
}

export async function processPendingReminders(): Promise<{
	sent: number;
	failed: number;
}> {
	const pending = getPendingReminders();
	let sent = 0;
	let failed = 0;

	for (const reminder of pending) {
		const result = await sendReminderEmail(reminder);
		if (result.success) {
			sent++;
		} else {
			failed++;
			logger.error("Failed to send reminder", {
				reminderId: reminder.id,
				error: result.error,
			});
		}
	}

	logger.info("Processed pending reminders", { total: pending.length, sent, failed });
	return { sent, failed };
}

export function cleanupOldReminders(): number {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 30);

	const initialCount = reminders.length;
	const filtered = reminders.filter(r => r.dueDate >= cutoff);

	reminders.length = 0;
	reminders.push(...filtered);

	const removed = initialCount - reminders.length;
	if (removed > 0) {
		logger.info("Cleaned up old reminders", { removed });
	}

	return removed;
}

export function getReminderStats(): {
	total: number;
	pending: number;
	sent: number;
	byType: Record<BillingReminder["type"], number>;
} {
	const byType: Record<BillingReminder["type"], number> = {
		payment_due: 0,
		trial_expiring: 0,
		subscription_expired: 0,
	};

	for (const reminder of reminders) {
		byType[reminder.type]++;
	}

	return {
		total: reminders.length,
		pending: reminders.filter(r => !r.sent).length,
		sent: reminders.filter(r => r.sent).length,
		byType,
	};
}
