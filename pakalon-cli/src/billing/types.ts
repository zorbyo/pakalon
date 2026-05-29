/**
 * Billing Types for Pakalon CLI
 */
export interface BillingPlan {
  id: string;
  name: string;
  price: number;
  features: string[];
  tokenLimit: number;
  requestLimit: number;
}

export interface PostPaidPlan {
  id: string;
  depositAmountUsd: number;
  platformFeeRate: number;
}

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

export interface BillingUsage {
  tokens: number;
  requests: number;
  lastReset: number;
  costUsd?: number;
}

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

export interface BillingInfo {
  userId?: string;
  plan: BillingPlan;
  usage: BillingUsage;
  nextBillingDate: number | null;
  paymentMethod: PaymentMethod | null;
  postPaidPlan?: PostPaidPlan;
  usageHistory?: UsageRecord[];
  billingCycles?: BillingCycle[];
  invoices?: BillingInvoice[];
}

export interface PaymentMethod {
  type: "card" | "paypal" | "invoice";
  last4?: string;
  expiry?: string;
  email?: string;
}

export interface BillingEmailPayload {
  type: "usage-warning" | "limit-reached" | "billing-reminder" | "payment-failed" | "payment-receipt" | "subscription-expired";
  plan: BillingPlan;
  usage: BillingUsage;
  email?: string;
  tokenPercent?: number;
  requestPercent?: number;
  reminderDays?: number;
}
