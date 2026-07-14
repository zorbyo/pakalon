import type { BillingPlan, PlanTier } from "./types";

const PLANS: BillingPlan[] = [
	{
		tier: "free",
		name: "Free",
		price: 0,
		credits: 100,
		features: ["basic-commands", "single-session", "plan-mode", "edit-mode"],
	},
	{
		tier: "pro",
		name: "Pro",
		price: 20,
		credits: 10000,
		features: [
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
	},
	{
		tier: "enterprise",
		name: "Enterprise",
		price: 100,
		credits: 100000,
		features: ["all-features", "unlimited-sessions", "dedicated-support", "custom-integrations", "sla"],
	},
];

export function getPlan(tier: PlanTier): BillingPlan | undefined {
	return PLANS.find(p => p.tier === tier);
}

export function getAllPlans(): BillingPlan[] {
	return [...PLANS];
}

export function hasFeatureAccess(tier: PlanTier, feature: string): boolean {
	const plan = getPlan(tier);
	if (!plan) return false;
	return plan.features.includes(feature);
}

export function getCreditsForTier(tier: PlanTier): number {
	return getPlan(tier)?.credits ?? 0;
}

export function getPriceForTier(tier: PlanTier): number {
	return getPlan(tier)?.price ?? 0;
}

export function getDefaultTier(): PlanTier {
	return "free";
}
