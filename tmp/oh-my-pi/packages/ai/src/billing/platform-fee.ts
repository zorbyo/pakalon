/**
 * Platform-fee wrapper around `models.ts::calculateCost`.
 *
 * Applies the 10% Pakalon platform fee on top of the underlying model
 * cost. Use this everywhere user-facing costs are computed (billing,
 * usage tracking, the `/budget` slash command, etc.) so the fee is
 * applied consistently.
 *
 * The fee is per `requirments/CLI-req.md §Usage`:
 *   "the user will pay the amount of 2$ as the deposit amount ...
 *    based upon the token and the model he/she uses they will pay
 *    that amount only with the platform fee of 10% of what they used."
 */
import { calculateCost } from "../models";
import type { Model, Usage } from "../types";

// `Model` and `Usage` are generic on `Api`; the platform fee
// wrapper is api-agnostic, so we erase the type parameter here.
type AnyModel = Model<any>;
type AnyUsage = Usage;

export const PLATFORM_FEE_PERCENT = 0.1;

/** Result of computing a user-facing cost. */
export interface PlatformCost {
	/** Raw model cost in USD. */
	modelCostUsd: number;
	/** 10% platform fee in USD. */
	feeUsd: number;
	/** `modelCostUsd + feeUsd`. This is what the user is billed. */
	totalUsd: number;
}

/**
 * Compute the platform-fee-adjusted cost for a single `Usage` record
 * (the shape returned by `streamSimple` from `packages/ai/src/stream.ts`).
 */
export function calculatePlatformCost(usage: AnyUsage | undefined, model: AnyModel | undefined): PlatformCost {
	const modelCostUsd = usage && model ? (calculateCost(model, usage) as unknown as number) : 0;
	const feeUsd = modelCostUsd * PLATFORM_FEE_PERCENT;
	return {
		modelCostUsd,
		feeUsd,
		totalUsd: modelCostUsd + feeUsd,
	};
}

/**
 * Apply the platform fee to a pre-computed model cost (in case the
 * caller has already run `calculateCost` and only needs the wrapper).
 */
export function applyPlatformFee(modelCostUsd: number): PlatformCost {
	const feeUsd = modelCostUsd * PLATFORM_FEE_PERCENT;
	return { modelCostUsd, feeUsd, totalUsd: modelCostUsd + feeUsd };
}
