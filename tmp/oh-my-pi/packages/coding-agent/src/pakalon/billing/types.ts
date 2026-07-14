/**
 * Billing Types for Pakalon (oh-my-pi)
 *
 * Shared types between prepaid (budget-prompt, dunning, tier-gate) and
 * postpaid (Polar) billing subsystems.
 */
import type { BillingPlan as OMPBillingPlan } from "./budget-prompt";

// Re-export existing types so importing only from ./types works
export type { BillingPlan } from "./budget-prompt";
export type { DunningInfo } from "./dunning";
export type { TierInfo } from "./tier-gate";

// ═══════════════════════════════════════════════════════════════════════════════
// Plan types
// ═══════════════════════════════════════════════════════════════════════════════

export interface PostPaidPlan {
	id: string;
	depositAmountUsd: number;
	platformFeeRate: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Usage tracking
// ═══════════════════════════════════════════════════════════════════════════════

export interface UsageRecord {
	timestamp: number;
	tokens: number;
	requests: number;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
}

export interface ModelUsageRecord {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export interface BillingUsage {
	tokens: number;
	requests: number;
	lastReset: number;
	costUsd?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Invoice & cycle
// ═══════════════════════════════════════════════════════════════════════════════

export interface BillingCycle {
	startDate: Date;
	endDate: Date;
	totalCost: number;
	status: "pending" | "paid" | "overdue";
}

export interface BillingInvoice {
	id: string;
	userId: string;
	periodStart: Date;
	periodEnd: Date;
	modelBreakdown: ModelUsageRecord[];
	subtotalUsd: number;
	platformFeeUsd: number;
	totalUsd: number;
	depositApplied: number;
	amountDue: number;
	status: "pending" | "paid" | "overdue";
	dueDate: Date;
}

export interface BillingCycleUsage {
	periodStart: Date;
	periodEnd: Date;
	modelBreakdown: ModelUsageRecord[];
	subtotalUsd: number;
	platformFeeUsd: number;
	totalUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════════════════════════════════════

export interface ModelPricing {
	inputPerMillionUsd: number;
	outputPerMillionUsd: number;
}

export interface ModelUsageInput {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	requestCount?: number;
	pricing?: ModelPricing;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Top-level billing state
// ═══════════════════════════════════════════════════════════════════════════════

export interface PaymentMethod {
	type: "card" | "paypal" | "invoice";
	last4?: string;
	expiry?: string;
	email?: string;
}

export interface BillingInfo {
	userId?: string;
	plan: OMPBillingPlan;
	usage: BillingUsage;
	nextBillingDate: number | null;
	paymentMethod: PaymentMethod | null;
	postPaidPlan?: PostPaidPlan;
	usageHistory?: UsageRecord[];
	billingCycles?: BillingCycle[];
	invoices?: BillingInvoice[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Email
// ═══════════════════════════════════════════════════════════════════════════════

export interface BillingEmailPayload {
	type:
		| "usage-warning"
		| "limit-reached"
		| "billing-reminder"
		| "payment-failed"
		| "payment-receipt"
		| "subscription-expired";
	plan: OMPBillingPlan;
	usage: BillingUsage;
	email?: string;
	tokenPercent?: number;
	requestPercent?: number;
	reminderDays?: number;
}
