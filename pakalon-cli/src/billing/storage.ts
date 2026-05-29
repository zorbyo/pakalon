/**
 * Billing Storage - persists billing configuration to disk
 */
import type { BillingInfo, UsageRecord, BillingInvoice, BillingCycle } from "./types.js";
import path from "path";
import fs from "fs";

const BILLING_FILE = ".pakalon/.billing.json";

export function getBillingPath(): string {
  return path.join(process.cwd(), BILLING_FILE);
}

export function loadBillingConfig(): BillingInfo | null {
  try {
    const billingPath = getBillingPath();
    if (!fs.existsSync(billingPath)) {
      return null;
    }
    const data = fs.readFileSync(billingPath, "utf-8");
    return JSON.parse(data) as BillingInfo;
  } catch {
    return null;
  }
}

export function saveBillingConfig(config: BillingInfo): void {
  try {
    const billingPath = getBillingPath();
    const dir = path.dirname(billingPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(billingPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Silently fail - billing should not break the app
  }
}

export function clearBillingConfig(): void {
  try {
    const billingPath = getBillingPath();
    if (fs.existsSync(billingPath)) {
      fs.unlinkSync(billingPath);
    }
  } catch {
    // Silently fail
  }
}

export function loadUsageHistory(): UsageRecord[] {
  const config = loadBillingConfig();
  return config?.usageHistory ?? [];
}

export function saveUsageHistory(usageHistory: UsageRecord[]): void {
  const config = loadBillingConfig();
  if (!config) return;
  saveBillingConfig({ ...config, usageHistory });
}

export function loadInvoices(): BillingInvoice[] {
  const config = loadBillingConfig();
  return config?.invoices ?? [];
}

export function saveInvoices(invoices: BillingInvoice[]): void {
  const config = loadBillingConfig();
  if (!config) return;
  saveBillingConfig({ ...config, invoices });
}

export function loadBillingCycles(): BillingCycle[] {
  const config = loadBillingConfig();
  return config?.billingCycles ?? [];
}

export function saveBillingCycles(billingCycles: BillingCycle[]): void {
  const config = loadBillingConfig();
  if (!config) return;
  saveBillingConfig({ ...config, billingCycles });
}
