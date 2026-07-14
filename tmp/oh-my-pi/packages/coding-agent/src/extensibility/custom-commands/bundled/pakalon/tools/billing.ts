/**
 * Billing tool.
 *
 * Handles Polar.sh billing integration for the Pakalon platform.
 * Manages deposits, usage tracking, and subscription handling.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { BillingConfig, BillingUsage } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface BillingBalance {
	available: number;
	used: number;
	total: number;
	currency: string;
}

export interface BillingCharge {
	id: string;
	amount: number;
	description: string;
	phase: string;
	timestamp: string;
}

export interface BillingCheckoutResult {
	checkout_url: string;
	session_id: string;
}

// ============================================================================
// Polar API Client
// ============================================================================

export class BillingClient {
	private config: BillingConfig;
	private baseUrl = "https://api.polar.sh/v1";

	constructor(config: BillingConfig) {
		this.config = config;
	}

	private headers(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.polar_access_token}`,
		};
	}

	// ------------------------------------------------------------------
	// Checkout
	// ------------------------------------------------------------------

	async createCheckout(depositAmount: number): Promise<BillingCheckoutResult> {
		const res = await fetch(`${this.baseUrl}/checkouts`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				product_id: this.config.deposit_product_id,
				amount: depositAmount,
				success_url: `${this.config.webhook_url}/billing/success`,
				cancel_url: `${this.config.webhook_url}/billing/cancel`,
			}),
		});
		if (!res.ok) throw new Error(`Polar checkout failed: ${res.status}`);
		const data = (await res.json()) as { id: string; url: string };
		return { checkout_url: data.url, session_id: data.id };
	}

	// ------------------------------------------------------------------
	// Balance
	// ------------------------------------------------------------------

	async getBalance(): Promise<BillingBalance> {
		try {
			const res = await fetch(`${this.baseUrl}/customers/balance`, {
				method: "GET",
				headers: this.headers(),
			});
			if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
			const data = (await res.json()) as { balance: number; currency: string };
			return {
				available: data.balance / 100, // Convert cents to dollars
				used: 0,
				total: data.balance / 100,
				currency: data.currency,
			};
		} catch (err) {
			logger.warn(`Failed to fetch balance: ${err}`);
			return { available: 0, used: 0, total: 0, currency: "USD" };
		}
	}

	// ------------------------------------------------------------------
	// Charges
	// ------------------------------------------------------------------

	async recordCharge(charge: Omit<BillingCharge, "id" | "timestamp">): Promise<BillingCharge> {
		const fullCharge: BillingCharge = {
			...charge,
			id: `charge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			timestamp: new Date().toISOString(),
		};

		logger.info(`Billing charge: $${charge.amount} for ${charge.description}`);
		return fullCharge;
	}

	async checkSufficientBalance(requiredAmount: number): Promise<boolean> {
		const balance = await this.getBalance();
		return balance.available >= requiredAmount;
	}
}

// ============================================================================
// Usage Tracker
// ============================================================================

export class UsageTracker {
	private usage: BillingUsage;
	private filePath: string;

	constructor(projectPath: string) {
		this.filePath = `${projectPath}/.pakalon-agents/billing.json`;
		this.usage = {
			deposits: [],
			charges: [],
			total_spent: 0,
			current_balance: 0,
		};
	}

	async load(): Promise<void> {
		try {
			const { readFile } = await import("node:fs/promises");
			const raw = await readFile(this.filePath, "utf-8");
			this.usage = JSON.parse(raw);
		} catch {
			// Start fresh
		}
	}

	async save(): Promise<void> {
		const { writeFile, mkdir } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, JSON.stringify(this.usage, null, 2));
	}

	addDeposit(amount: number): void {
		this.usage.deposits.push({
			amount,
			date: new Date().toISOString(),
		});
		this.usage.current_balance += amount;
	}

	addCharge(charge: BillingCharge): void {
		this.usage.charges.push(charge);
		this.usage.total_spent += charge.amount;
		this.usage.current_balance -= charge.amount;
	}

	getSummary(): string {
		const lines = [
			"# Billing Summary",
			"",
			`Total Deposited: $${this.usage.deposits.reduce((s, d) => s + d.amount, 0).toFixed(2)}`,
			`Total Spent: $${this.usage.total_spent.toFixed(2)}`,
			`Current Balance: $${this.usage.current_balance.toFixed(2)}`,
			"",
			"## Charges",
		];

		if (this.usage.charges.length === 0) {
			lines.push("No charges yet.");
		} else {
			for (const charge of this.usage.charges) {
				lines.push(`- $${charge.amount.toFixed(2)} — ${charge.description} (${charge.phase})`);
			}
		}

		return lines.join("\n");
	}
}

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildBillingPrompt(config: BillingConfig): string {
	const platformFee = config.platform_fee_percent;
	const minDeposit = config.minimum_deposit;
	const costPerPhase = config.cost_per_phase;

	return `You are the Pakalon Billing Agent. Your task is to manage billing and usage tracking.

## Configuration
- Platform Fee: ${platformFee}%
- Minimum Deposit: $${minDeposit}
- Cost Per Phase: $${costPerPhase}
- Billing Provider: Polar.sh

## Tasks
1. Check current balance before each phase
2. If balance is below minimum deposit, prompt user to deposit
3. Record charges for each phase execution
4. Apply platform fee (${platformFee}%) to each charge
5. Generate billing summary when requested

## Pricing Model
- Each phase costs $${costPerPhase} (plus ${platformFee}% platform fee)
- Total per phase: $${(costPerPhase * (1 + platformFee / 100)).toFixed(2)}
- Minimum deposit: $${minDeposit}

## Workflow
1. Before starting a phase, check balance
2. If insufficient, create checkout session for user
3. After phase completion, record charge
4. Update balance

Use the billing tool to manage deposits and charges.`;
}
