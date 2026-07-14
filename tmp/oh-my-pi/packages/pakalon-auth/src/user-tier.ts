import { logger } from "@oh-my-pi/pi-utils";
import type { UserProfile, UserTier } from "./types";

const TIER_CREDITS: Record<UserTier, number> = {
	free: 100,
	pro: 10_000,
};

const TIER_FEATURES: Record<UserTier, string[]> = {
	free: ["basic-commands", "single-session", "plan-mode", "edit-mode"],
	pro: [
		"all-commands",
		"multi-session",
		"all-modes",
		"agent-teams",
		"automations",
		"memory",
		"penpot-wireframing",
		"billing-api",
		"priority-support",
	],
};

export class UserTierManager {
	private currentTier: UserTier = "free";
	private monthlyUsage = 0;
	private billingPeriodStart = new Date().toISOString();

	getTier(): UserTier {
		return this.currentTier;
	}

	setTier(tier: UserTier): void {
		const previous = this.currentTier;
		this.currentTier = tier;
		this.monthlyUsage = 0;
		this.billingPeriodStart = new Date().toISOString();
		logger.info("User tier changed", { from: previous, to: tier });
	}

	getCreditsRemaining(): number {
		return TIER_CREDITS[this.currentTier] - this.monthlyUsage;
	}

	hasCreditsAvailable(required: number): boolean {
		if (this.currentTier === "pro") return true;
		return this.getCreditsRemaining() >= required;
	}

	consumeCredits(amount: number): boolean {
		if (this.currentTier === "pro") return true;
		if (!this.hasCreditsAvailable(amount)) return false;
		this.monthlyUsage += amount;
		return true;
	}

	resetMonthlyUsage(): void {
		this.monthlyUsage = 0;
		this.billingPeriodStart = new Date().toISOString();
		logger.info("Monthly usage reset");
	}

	getFeatureAccess(): string[] {
		return TIER_FEATURES[this.currentTier];
	}

	hasFeatureAccess(feature: string): boolean {
		return TIER_FEATURES[this.currentTier].includes(feature);
	}

	getMonthlyUsage(): number {
		return this.monthlyUsage;
	}

	getUsagePercentage(): number {
		return (this.monthlyUsage / TIER_CREDITS[this.currentTier]) * 100;
	}

	getTierLimit(): number {
		return TIER_CREDITS[this.currentTier];
	}

	getBillingPeriodStart(): string {
		return this.billingPeriodStart;
	}

	isPro(): boolean {
		return this.currentTier === "pro";
	}

	getProfile(): UserProfile {
		return {
			tier: this.currentTier,
			creditsRemaining: this.getCreditsRemaining(),
			creditsUsed: this.monthlyUsage,
			featureAccess: this.getFeatureAccess(),
			isPro: this.isPro(),
		};
	}
}
