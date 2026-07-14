import { logger } from "@oh-my-pi/pi-utils";
import { getCreditsForTier, getPlan, hasFeatureAccess } from "./plans";
import type { BillingCustomer, BillingInvoice, PlanTier, UsageRecord } from "./types";

export interface ModelPricing {
	modelId: string;
	provider: string;
	inputCostPer1K: number;
	outputCostPer1K: number;
}

const MODEL_PRICING: ModelPricing[] = [
	// Frontier models
	{ modelId: "gpt-4o", provider: "openai", inputCostPer1K: 0.01, outputCostPer1K: 0.03 },
	{ modelId: "gpt-4o-mini", provider: "openai", inputCostPer1K: 0.0015, outputCostPer1K: 0.006 },
	{ modelId: "claude-sonnet-4", provider: "anthropic", inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
	{ modelId: "claude-haiku-3.5", provider: "anthropic", inputCostPer1K: 0.0008, outputCostPer1K: 0.004 },
	{ modelId: "gemini-2.0-flash", provider: "google", inputCostPer1K: 0.0001, outputCostPer1K: 0.0004 },
	{ modelId: "gemini-2.0-pro", provider: "google", inputCostPer1K: 0.002, outputCostPer1K: 0.008 },

	// OpenRouter / community models
	{ modelId: "deepseek-v3", provider: "deepseek", inputCostPer1K: 0.0005, outputCostPer1K: 0.002 },
	{ modelId: "deepseek-r1", provider: "deepseek", inputCostPer1K: 0.0005, outputCostPer1K: 0.002 },
	{ modelId: "llama-3.3-70b", provider: "meta", inputCostPer1K: 0.0005, outputCostPer1K: 0.001 },
	{ modelId: "qwen-2.5-72b", provider: "qwen", inputCostPer1K: 0.0004, outputCostPer1K: 0.001 },
	{ modelId: "mistral-large", provider: "mistral", inputCostPer1K: 0.002, outputCostPer1K: 0.006 },

	// Local models (free)
	{ modelId: "ollama/*", provider: "local", inputCostPer1K: 0, outputCostPer1K: 0 },
	{ modelId: "lm-studio/*", provider: "local", inputCostPer1K: 0, outputCostPer1K: 0 },
];

interface UsageCost {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
}

export class BillingManager {
	private customer: BillingCustomer | null = null;
	private invoices: BillingInvoice[] = [];
	private usageRecords: UsageRecord[] = [];
	private monthlyUsage = 0;
	private billingCycleStart: string = new Date().toISOString();
	private usageCosts: UsageCost[] = [];

	getCustomer(): BillingCustomer | null {
		return this.customer;
	}

	setCustomer(customer: BillingCustomer): void {
		this.customer = customer;
		logger.info("Billing customer set", { id: customer.id, tier: customer.tier });
	}

	createCustomer(email: string): BillingCustomer {
		const customer: BillingCustomer = {
			id: `cus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			email,
			tier: "free",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.customer = customer;
		return customer;
	}

	async createPolarCheckout(planTier: PlanTier): Promise<string> {
		const plan = getPlan(planTier);
		if (!plan || plan.price === 0) {
			return "Free plan - no checkout needed.";
		}
		logger.info("Polar checkout initiated", { tier: planTier, price: plan.price });
		return `https://polar.sh/checkout/pakalon-${planTier}-${Date.now()}`;
	}

	async handlePolarWebhook(payload: Record<string, unknown>): Promise<boolean> {
		const eventType = (payload.type as string) ?? "";
		logger.info("Polar webhook received", { eventType });

		if (eventType === "checkout.completed" || eventType === "subscription.active") {
			const customerEmail = ((payload.data as any)?.customer?.email as string) ?? "unknown@example.com";
			const tier: PlanTier = "pro";
			if (this.customer) {
				this.customer.tier = tier;
				this.customer.updatedAt = new Date().toISOString();
			} else {
				this.createCustomer(customerEmail);
				if (this.customer) this.customer.tier = tier;
			}
			this.monthlyUsage = 0;
			logger.info("Polar subscription activated", { email: customerEmail, tier });
			return true;
		}

		if (eventType === "subscription.cancelled") {
			if (this.customer) {
				this.customer.tier = "free";
				this.customer.updatedAt = new Date().toISOString();
			}
			logger.info("Polar subscription cancelled");
			return true;
		}

		return false;
	}

	getTier(): PlanTier {
		return this.customer?.tier ?? "free";
	}

	setTier(tier: PlanTier): void {
		if (!this.customer) return;
		this.customer.tier = tier;
		this.customer.updatedAt = new Date().toISOString();
		this.monthlyUsage = 0;
		logger.info("Billing tier changed", { tier });
	}

	hasFeature(feature: string): boolean {
		return hasFeatureAccess(this.getTier(), feature);
	}

	getCreditsRemaining(): number {
		if (this.getTier() === "pro" || this.getTier() === "enterprise") return Infinity;
		return getCreditsForTier(this.getTier()) - this.monthlyUsage;
	}

	consumeCredits(amount: number): boolean {
		if (this.getTier() === "pro" || this.getTier() === "enterprise") return true;
		if (this.getCreditsRemaining() < amount) return false;
		this.monthlyUsage += amount;
		return true;
	}

	calculateModelCost(modelId: string, inputTokens: number, outputTokens: number): UsageCost {
		const pricing = MODEL_PRICING.find(
			p => modelId.startsWith(p.modelId.replace("/*", "")) || p.modelId === modelId,
		) ?? {
			modelId: "unknown",
			provider: "unknown",
			inputCostPer1K: 0.01,
			outputCostPer1K: 0.03,
		};

		const inputCost = (inputTokens / 1000) * pricing.inputCostPer1K;
		const outputCost = (outputTokens / 1000) * pricing.outputCostPer1K;
		const totalCost = inputCost + outputCost;

		const cost: UsageCost = {
			modelId,
			inputTokens,
			outputTokens,
			inputCost,
			outputCost,
			totalCost,
		};

		this.usageCosts.push(cost);
		return cost;
	}

	getTotalUsageCost(): number {
		return this.usageCosts.reduce((sum, c) => sum + c.totalCost, 0);
	}

	getUsageCosts(): UsageCost[] {
		return [...this.usageCosts];
	}

	addInvoice(invoice: BillingInvoice): void {
		this.invoices.push(invoice);
	}

	getInvoices(): BillingInvoice[] {
		return [...this.invoices];
	}

	getOutstandingInvoices(): BillingInvoice[] {
		return this.invoices.filter(i => i.status === "pending" || i.status === "overdue");
	}

	generateInvoice(): BillingInvoice {
		const invoice: BillingInvoice = {
			id: `inv_${Date.now()}`,
			customerId: this.customer?.id ?? "unknown",
			amount: this.getTotalUsageCost(),
			currency: "USD",
			status: "pending",
			periodStart: this.billingCycleStart,
			periodEnd: new Date().toISOString(),
			issuedAt: new Date().toISOString(),
		};
		this.invoices.push(invoice);
		return invoice;
	}

	addUsageRecord(record: UsageRecord): void {
		this.usageRecords.push(record);
	}

	getUsageRecords(): UsageRecord[] {
		return [...this.usageRecords];
	}

	getMonthlyUsage(): number {
		return this.monthlyUsage;
	}

	resetMonthlyUsage(): void {
		this.monthlyUsage = 0;
		this.billingCycleStart = new Date().toISOString();
		this.usageCosts = [];
	}

	getUsagePercentage(): number {
		const max = getCreditsForTier(this.getTier());
		if (max === 0) return 0;
		return (this.monthlyUsage / max) * 100;
	}

	isEligibleForUpgrade(): boolean {
		return this.getTier() === "free";
	}

	isPro(): boolean {
		return this.getTier() === "pro" || this.getTier() === "enterprise";
	}

	static getModelPricing(): ModelPricing[] {
		return [...MODEL_PRICING];
	}
}
