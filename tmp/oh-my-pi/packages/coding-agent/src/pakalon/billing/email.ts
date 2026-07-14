import { logger } from "@oh-my-pi/pi-utils";
import type { BillingEmailPayload, BillingInvoice, BillingPlan, BillingUsage } from "./types";

const EMAIL_ENDPOINT = process.env.PAKALON_EMAIL_ENDPOINT ?? "http://localhost:7432/api/billing/email";

export async function sendBillingEmail(payload: BillingEmailPayload): Promise<void> {
	try {
		const response = await fetch(EMAIL_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			logger.warn("Billing email failed", { status: response.statusText });
		}
	} catch (error) {
		logger.warn("Billing email notification could not be sent", { type: payload.type, error });
	}
}

export async function sendUsageWarning(
	plan: BillingPlan,
	usage: BillingUsage,
	tokenPercent: number,
	requestPercent: number,
): Promise<void> {
	await sendBillingEmail({
		type: "usage-warning",
		plan,
		usage,
		tokenPercent,
		requestPercent,
	});
}

export async function sendLimitReached(
	plan: BillingPlan,
	usage: BillingUsage,
	tokenPercent: number,
	requestPercent: number,
): Promise<void> {
	await sendBillingEmail({
		type: "limit-reached",
		plan,
		usage,
		tokenPercent,
		requestPercent,
	});
}

export async function sendBillingReminder(email: string, daysUntilDue: number, amount: number): Promise<void> {
	await sendBillingEmail({
		type: "billing-reminder",
		email,
		plan: {
			id: "post-paid",
			name: "Post-Paid",
			price: amount,
			features: [],
			tokenLimit: Infinity as any,
			requestLimit: Infinity as any,
		},
		usage: { tokens: 0, requests: 0, lastReset: Date.now(), costUsd: amount },
		reminderDays: daysUntilDue,
	});
}

export async function sendPaymentReceipt(email: string, invoice: BillingInvoice): Promise<void> {
	await sendBillingEmail({
		type: "payment-receipt",
		email,
		plan: {
			id: "post-paid",
			name: "Post-Paid",
			price: invoice.totalUsd,
			features: [],
			tokenLimit: Infinity as any,
			requestLimit: Infinity as any,
		},
		usage: { tokens: 0, requests: 0, lastReset: Date.now(), costUsd: invoice.totalUsd },
	});
}

export async function sendPaymentFailed(plan: BillingPlan): Promise<void> {
	await sendBillingEmail({
		type: "payment-failed",
		plan,
		usage: { tokens: 0, requests: 0, lastReset: Date.now() },
		tokenPercent: 0,
		requestPercent: 0,
	});
}

export function formatUsageMessage(plan: BillingPlan, usage: BillingUsage): string {
	const tokenPercent = Math.round((usage.tokens / plan.tokenLimit) * 100);
	const requestPercent = Math.round((usage.requests / (plan.requestLimit ?? Infinity)) * 100);
	return [
		"Usage Summary:",
		`- Tokens: ${usage.tokens.toLocaleString()} / ${plan.tokenLimit.toLocaleString()} (${tokenPercent}%)`,
		`- Requests: ${usage.requests.toLocaleString()} / ${(plan.requestLimit ?? "∞").toLocaleString()} (${requestPercent}%)`,
		`- Plan: ${plan.name} ($${plan.price}/month)`,
		"",
		"Warning: You are approaching your usage limit. Consider upgrading your plan.",
	].join("\n");
}
