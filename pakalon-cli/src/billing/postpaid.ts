/**
 * Post-paid billing helpers for Pakalon CLI
 */
import type { BillingInvoice, ModelUsageRecord, PostPaidPlan } from "./types.js";
import {
  generateMonthlyBill,
  getCurrentCycleUsage,
  getPlatformFee,
  getTotalDue,
  sendBillingReminderNotification,
} from "./billing.js";
import { initializeBilling, getBillingInfo } from "./billing.js";

export async function initializePostPaidPlan(userId: string): Promise<PostPaidPlan> {
  const billing = getBillingInfo() ?? initializeBilling();
  billing.userId = userId;
  billing.postPaidPlan = billing.postPaidPlan ?? {
    id: "post-paid",
    depositAmountUsd: 2,
    platformFeeRate: 0.1,
  };
  return billing.postPaidPlan;
}

export async function processEndOfMonthBilling(): Promise<BillingInvoice> {
  return await generateMonthlyBill();
}

export async function getUsageBreakdownByModel(userId: string, month: Date): Promise<ModelUsageRecord[]> {
  const cycleUsage = await getCurrentCycleUsage();
  if (getBillingInfo()?.userId && getBillingInfo()?.userId !== userId) {
    return [];
  }

  const sameMonth =
    cycleUsage.periodStart.getFullYear() === month.getFullYear() &&
    cycleUsage.periodStart.getMonth() === month.getMonth();

  return sameMonth ? cycleUsage.modelBreakdown : [];
}

export { getPlatformFee, getTotalDue };

export async function sendPostPaidReminder(email: string, daysUntilDue: number, amount: number): Promise<void> {
  await sendBillingReminderNotification(email, daysUntilDue, amount);
}
