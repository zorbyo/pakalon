import { z } from "zod";

export type PlanTier = "free" | "pro" | "enterprise";

export interface BillingPlan {
	tier: PlanTier;
	name: string;
	price: number;
	credits: number;
	features: string[];
}

export interface BillingCustomer {
	id: string;
	email: string;
	tier: PlanTier;
	polarCustomerId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface BillingInvoice {
	id: string;
	customerId: string;
	amount: number;
	currency: string;
	status: "pending" | "paid" | "overdue" | "cancelled";
	periodStart: string;
	periodEnd: string;
	issuedAt: string;
	paidAt?: string;
}

export interface UsageRecord {
	id: string;
	customerId: string;
	metric: string;
	value: number;
	timestamp: string;
}

export const BillingPlanSchema = z.object({
	tier: z.enum(["free", "pro", "enterprise"]),
	name: z.string(),
	price: z.number(),
	credits: z.number(),
	features: z.array(z.string()),
});

export const BillingCustomerSchema = z.object({
	id: z.string(),
	email: z.string(),
	tier: z.enum(["free", "pro", "enterprise"]),
	polarCustomerId: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const BillingInvoiceSchema = z.object({
	id: z.string(),
	customerId: z.string(),
	amount: z.number(),
	currency: z.string(),
	status: z.enum(["pending", "paid", "overdue", "cancelled"]),
	periodStart: z.string(),
	periodEnd: z.string(),
	issuedAt: z.string(),
	paidAt: z.string().optional(),
});

export const UsageRecordSchema = z.object({
	id: z.string(),
	customerId: z.string(),
	metric: z.string(),
	value: z.number(),
	timestamp: z.string(),
});
