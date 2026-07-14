import * as fs from "node:fs";
import * as path from "node:path";
import type { BillingCycle, BillingInfo, BillingInvoice, UsageRecord } from "./types";

const BILLING_FILE = ".pakalon/.billing.json";

export function getBillingPath(baseDir?: string): string {
	return path.join(baseDir ?? process.cwd(), BILLING_FILE);
}

export function loadBillingConfig(baseDir?: string): BillingInfo | null {
	try {
		const p = getBillingPath(baseDir);
		return Bun.file(p).json() as Promise<BillingInfo | null>;
	} catch {
		return null;
	}
}

export function saveBillingConfig(config: BillingInfo, baseDir?: string): void {
	try {
		const p = getBillingPath(baseDir);
		const dir = path.dirname(p);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		Bun.write(p, JSON.stringify(config, null, 2));
	} catch {
		// Silently fail — billing persistence should never block the app
	}
}

export function clearBillingConfig(baseDir?: string): void {
	try {
		const p = getBillingPath(baseDir);
		if (fs.existsSync(p)) {
			fs.unlinkSync(p);
		}
	} catch {
		// Silently fail
	}
}

export function loadUsageHistory(baseDir?: string): UsageRecord[] {
	const config = loadBillingConfig(baseDir);
	return config?.usageHistory ?? [];
}

export function saveUsageHistory(usageHistory: UsageRecord[], baseDir?: string): void {
	const config = loadBillingConfig(baseDir);
	if (!config) return;
	saveBillingConfig({ ...config, usageHistory }, baseDir);
}

export function loadInvoices(baseDir?: string): BillingInvoice[] {
	const config = loadBillingConfig(baseDir);
	return config?.invoices ?? [];
}

export function saveInvoices(invoices: BillingInvoice[], baseDir?: string): void {
	const config = loadBillingConfig(baseDir);
	if (!config) return;
	saveBillingConfig({ ...config, invoices }, baseDir);
}

export function loadBillingCycles(baseDir?: string): BillingCycle[] {
	const config = loadBillingConfig(baseDir);
	return config?.billingCycles ?? [];
}

export function saveBillingCycles(billingCycles: BillingCycle[], baseDir?: string): void {
	const config = loadBillingConfig(baseDir);
	if (!config) return;
	saveBillingConfig({ ...config, billingCycles }, baseDir);
}
