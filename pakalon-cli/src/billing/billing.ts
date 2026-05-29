/**
 * Billing System for Pakalon CLI
 * Tracks usage, manages subscriptions, and handles billing notifications.
 */
import type {
  BillingPlan,
  UsageRecord,
  BillingInfo,
  ModelPricing,
  ModelUsageInput,
  BillingInvoice,
  ModelUsageRecord,
  BillingCycleUsage,
  PostPaidPlan,
} from "./types.js";
import {
  loadBillingConfig,
  saveBillingConfig,
  loadUsageHistory,
  saveUsageHistory,
  loadInvoices,
  saveInvoices,
  loadBillingCycles,
  saveBillingCycles,
} from "./storage.js";
import {
  sendBillingEmail,
  sendBillingReminder,
  sendPaymentReceipt,
} from "./email.js";

const DEFAULT_PLAN: BillingPlan = {
  id: "free",
  name: "Free",
  price: 0,
  features: ["basic-models", "limited-tokens", "community-support"],
  tokenLimit: 100_000,
  requestLimit: 100,
};

const DEFAULT_POST_PAID_PLAN: PostPaidPlan = {
  id: "post-paid",
  depositAmountUsd: 2,
  platformFeeRate: 0.1,
};

let currentBilling: BillingInfo | null = null;
let usageHistory: UsageRecord[] = [];
let invoices: BillingInvoice[] = [];

const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "openai/gpt-4.1": { inputPerMillionUsd: 2.00, outputPerMillionUsd: 8.00 },
  "openai/gpt-4.1-mini": { inputPerMillionUsd: 0.40, outputPerMillionUsd: 1.60 },
  "anthropic/claude-3-5-sonnet": { inputPerMillionUsd: 3.00, outputPerMillionUsd: 15.00 },
  "anthropic/claude-3-5-haiku": { inputPerMillionUsd: 0.80, outputPerMillionUsd: 4.00 },
  "anthropic/sonnet-4.6": { inputPerMillionUsd: 3.00, outputPerMillionUsd: 15.00 },
  "openrouter/sonnet-4.6": { inputPerMillionUsd: 3.00, outputPerMillionUsd: 15.00 },
  "openrouter/gpt-5.3-codex": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.00 },
  "gpt-5.3-codex": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.00 },
};

export function initializeBilling(): BillingInfo {
  const stored = loadBillingConfig();
  currentBilling = stored ?? {
    plan: DEFAULT_PLAN,
    usage: {
      tokens: 0,
      requests: 0,
      costUsd: 0,
      lastReset: Date.now(),
    },
    nextBillingDate: null,
    paymentMethod: null,
    postPaidPlan: DEFAULT_POST_PAID_PLAN,
    usageHistory: [],
    billingCycles: [],
    invoices: [],
  };

  usageHistory = stored?.usageHistory ?? loadUsageHistory();
  invoices = stored?.invoices ?? loadInvoices();

  currentBilling.userId ??= "local-user";
  currentBilling.postPaidPlan ??= DEFAULT_POST_PAID_PLAN;
  currentBilling.usageHistory = usageHistory;
  currentBilling.invoices = invoices;
  currentBilling.billingCycles = stored?.billingCycles ?? loadBillingCycles();
  saveBillingConfig(currentBilling);
  return currentBilling;
}

export function getBillingInfo(): BillingInfo | null {
  return currentBilling;
}

export function getPlan(): BillingPlan {
  return currentBilling?.plan ?? DEFAULT_PLAN;
}

function ensureBillingState(): BillingInfo | null {
  if (!currentBilling) {
    return initializeBilling();
  }
  return currentBilling;
}

export function calculateModelUsageCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing = DEFAULT_MODEL_PRICING[modelId] ?? { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(8));
}

export function calculateModelCost(modelId: string, inputTokens: number, outputTokens: number): number {
  return calculateModelUsageCost(modelId, inputTokens, outputTokens);
}

function getModelPricing(modelId: string): ModelPricing {
  return DEFAULT_MODEL_PRICING[modelId] ?? { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
}

export async function trackModelUsage(input: ModelUsageInput | string, inputTokens?: number, outputTokens?: number): Promise<UsageRecord | null> {
  const billing = ensureBillingState();
  if (!billing) return null;

  if (typeof input === "string") {
    const modelId = input;
    const inTokens = inputTokens ?? 0;
    const outTokens = outputTokens ?? 0;
    await trackUsage(inTokens + outTokens, 1, modelId, inTokens, outTokens, getModelPricing(modelId));
    return usageHistory[usageHistory.length - 1] ?? null;
  }

  await trackUsage(
    input.inputTokens + input.outputTokens,
    input.requestCount ?? 1,
    input.modelId,
    input.inputTokens,
    input.outputTokens,
    input.pricing ?? getModelPricing(input.modelId),
  );

  return usageHistory[usageHistory.length - 1] ?? null;
}

export async function trackUsage(
  tokens: number,
  requestCount: number = 1,
  modelId?: string,
  inputTokens?: number,
  outputTokens?: number,
  pricing?: ModelPricing,
): Promise<void> {
  const billing = ensureBillingState();
  if (!billing) return;

  const now = Date.now();
  const periodMs = 30 * 24 * 60 * 60 * 1000;

  if (now - billing.usage.lastReset > periodMs) {
    billing.usage = {
      tokens: 0,
      requests: 0,
      costUsd: 0,
      lastReset: now,
    };
  }

  const modelCost = modelId && inputTokens !== undefined && outputTokens !== undefined
    ? calculateModelUsageCost(modelId, inputTokens, outputTokens, pricing)
    : 0;

  billing.usage.tokens += tokens;
  billing.usage.requests += requestCount;
  billing.usage.costUsd = Number(((billing.usage.costUsd ?? 0) + modelCost).toFixed(8));

  usageHistory.push({
    timestamp: now,
    tokens,
    requests: requestCount,
    modelId,
    inputTokens,
    outputTokens,
    costUsd: modelCost || undefined,
  });

  if (usageHistory.length > 1000) {
    usageHistory = usageHistory.slice(-1000);
  }

  billing.usageHistory = usageHistory;
  saveUsageHistory(usageHistory);
  saveBillingConfig(billing);

  await checkUsageLimits();
}

function getCycleWindow(): { startDate: Date; endDate: Date } {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startDate, endDate };
}

function summarizeUsage(records: UsageRecord[]): BillingCycleUsage {
  const modelMap = new Map<string, ModelUsageRecord>();
  let subtotalUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const record of records) {
    if (!record.modelId || record.inputTokens === undefined || record.outputTokens === undefined) {
      continue;
    }

    const existing = modelMap.get(record.modelId) ?? {
      modelId: record.modelId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    existing.costUsd = Number((existing.costUsd + (record.costUsd ?? 0)).toFixed(8));
    modelMap.set(record.modelId, existing);

    subtotalUsd += record.costUsd ?? 0;
    totalInputTokens += record.inputTokens;
    totalOutputTokens += record.outputTokens;
  }

  const modelBreakdown = [...modelMap.values()];
  const platformFeeUsd = getPlatformFee(subtotalUsd);

  return {
    periodStart: getCycleWindow().startDate,
    periodEnd: getCycleWindow().endDate,
    modelBreakdown,
    subtotalUsd: Number(subtotalUsd.toFixed(8)),
    platformFeeUsd,
    totalUsd: getTotalDue(subtotalUsd),
    totalInputTokens,
    totalOutputTokens,
  };
}

export async function getCurrentCycleUsage(): Promise<BillingCycleUsage> {
  ensureBillingState();
  const { startDate, endDate } = getCycleWindow();
  const records = usageHistory.filter((record) => record.timestamp >= startDate.getTime() && record.timestamp <= endDate.getTime());
  const summary = summarizeUsage(records);
  summary.periodStart = startDate;
  summary.periodEnd = endDate;
  return summary;
}

export async function generateMonthlyBill(): Promise<BillingInvoice> {
  const billing = ensureBillingState();
  if (!billing) {
    throw new Error("Billing not initialized");
  }

  const cycle = await getCurrentCycleUsage();
  const periodStart = cycle.periodStart;
  const periodEnd = cycle.periodEnd;
  const subtotalUsd = cycle.subtotalUsd;
  const platformFeeUsd = getPlatformFee(subtotalUsd);
  const totalUsd = getTotalDue(subtotalUsd);
  const depositApplied = billing.postPaidPlan?.depositAmountUsd ?? DEFAULT_POST_PAID_PLAN.depositAmountUsd;
  const amountDue = Math.max(Number((totalUsd - depositApplied).toFixed(8)), 0);
  const dueDate = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const invoice: BillingInvoice = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `inv_${Date.now()}`,
    userId: billing.userId ?? "local-user",
    periodStart,
    periodEnd,
    modelBreakdown: cycle.modelBreakdown,
    subtotalUsd,
    platformFeeUsd,
    totalUsd,
    depositApplied,
    amountDue,
    status: amountDue > 0 ? "pending" : "paid",
    dueDate,
  };

  invoices.push(invoice);
  billing.invoices = invoices;
  billing.nextBillingDate = dueDate.getTime();
  billing.billingCycles = [...(billing.billingCycles ?? []), { startDate: periodStart, endDate: periodEnd, totalCost: totalUsd, status: invoice.status }];
  saveInvoices(invoices);
  saveBillingCycles(billing.billingCycles ?? []);
  saveBillingConfig(billing);

  return invoice;
}

export function getCurrentCycle(): { startDate: Date; endDate: Date } {
  return getCycleWindow();
}

export function getPlatformFee(subtotal: number): number {
  const rate = currentBilling?.postPaidPlan?.platformFeeRate ?? DEFAULT_POST_PAID_PLAN.platformFeeRate;
  return Number((subtotal * rate).toFixed(8));
}

export function getTotalDue(subtotal: number): number {
  return Number((subtotal + getPlatformFee(subtotal)).toFixed(8));
}

async function checkUsageLimits(): Promise<void> {
  if (!currentBilling) return;

  const plan = currentBilling.plan;
  const usage = currentBilling.usage;
  const tokenPercent = plan.tokenLimit === Infinity ? 0 : (usage.tokens / plan.tokenLimit) * 100;
  const requestPercent = plan.requestLimit === Infinity ? 0 : (usage.requests / plan.requestLimit) * 100;

  if (tokenPercent >= 90 || requestPercent >= 90) {
    await sendBillingEmail({
      type: "usage-warning",
      plan,
      usage,
      tokenPercent,
      requestPercent,
    });
  }

  if (tokenPercent >= 100 || requestPercent >= 100) {
    await sendBillingEmail({
      type: "limit-reached",
      plan,
      usage,
      tokenPercent,
      requestPercent,
    });
  }
}

export function upgradePlan(planId: string): BillingInfo {
  const plans: Record<string, BillingPlan> = {
    free: DEFAULT_PLAN,
    pro: {
      id: "pro",
      name: "Pro",
      price: 20,
      features: ["all-models", "priority-support", "higher-limits"],
      tokenLimit: 1_000_000,
      requestLimit: 1000,
    },
    team: {
      id: "team",
      name: "Team",
      price: 40,
      features: ["all-models", "team-sharing", "admin-panel", "unlimited-tokens"],
      tokenLimit: 5_000_000,
      requestLimit: 5000,
    },
    enterprise: {
      id: "enterprise",
      name: "Enterprise",
      price: 0,
      features: ["custom-model", "dedicated-support", "sla", "on-premise"],
      tokenLimit: Infinity,
      requestLimit: Infinity,
    },
  };

  const newPlan = plans[planId] ?? DEFAULT_PLAN;

  if (!currentBilling) {
    currentBilling = initializeBilling();
  }

  currentBilling.plan = newPlan;
  currentBilling.usage = {
    tokens: 0,
    requests: 0,
    costUsd: 0,
    lastReset: Date.now(),
  };
  currentBilling.nextBillingDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
  currentBilling.postPaidPlan = DEFAULT_POST_PAID_PLAN;

  saveBillingConfig(currentBilling);
  return currentBilling;
}

export function getUsageStats(): {
  tokens: number;
  requests: number;
  costUsd: number;
  tokenPercent: number;
  requestPercent: number;
  periodEnd: Date;
} | null {
  if (!currentBilling) return null;

  const plan = currentBilling.plan;
  return {
    tokens: currentBilling.usage.tokens,
    requests: currentBilling.usage.requests,
    costUsd: currentBilling.usage.costUsd ?? 0,
    tokenPercent: (currentBilling.usage.tokens / plan.tokenLimit) * 100,
    requestPercent: plan.requestLimit === Infinity ? 0 : (currentBilling.usage.requests / plan.requestLimit) * 100,
    periodEnd: new Date(currentBilling.usage.lastReset + 30 * 24 * 60 * 60 * 1000),
  };
}

export function getUsageHistory(limit: number = 100): UsageRecord[] {
  return usageHistory.slice(-limit);
}

export function resetUsage(): void {
  if (!currentBilling) return;
  currentBilling.usage = {
    tokens: 0,
    requests: 0,
    costUsd: 0,
    lastReset: Date.now(),
  };
  saveBillingConfig(currentBilling);
}

export function scheduleBillingReminder(daysBefore: number = 7): void {
  if (!currentBilling?.nextBillingDate) return;

  const reminderDate = currentBilling.nextBillingDate - daysBefore * 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    if (currentBilling) {
      await sendBillingEmail({
        type: "billing-reminder",
        plan: currentBilling.plan,
        usage: currentBilling.usage,
        reminderDays: daysBefore,
      });
    }
  }, reminderDate - Date.now());
}

export async function trackUsageAndBillReminder(email: string, amount: number, daysUntilDue: number): Promise<void> {
  await sendBillingReminder(email, daysUntilDue, amount);
}

export async function sendBillingReminderNotification(email: string, daysUntilDue: number, amount: number): Promise<void> {
  await sendBillingReminder(email, daysUntilDue, amount);
}

export async function sendBillingNotification(type: string, data: unknown): Promise<void> {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  await sendBillingEmail({ type: type as any, ...payload } as any);
}

export async function notifyPaymentReceipt(email: string, invoice: BillingInvoice): Promise<void> {
  await sendPaymentReceipt(email, invoice);
}

export * from "./types.js";
export * from "./storage.js";
export * from "./email.js";
