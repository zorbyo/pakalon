import { afterEach, describe, expect, it, vi } from "vitest";

import * as mode from "@/config/mode.js";
import { checkTokenBudget, createBudgetTracker } from "@/ai/token-budget.js";

describe("token budget diminishing returns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops after 3 continuations when deltas stay below the threshold", () => {
    vi.spyOn(mode, "isSelfHosted").mockReturnValue(false);

    const tracker = createBudgetTracker();
    const limits = { turnBudget: 10_000 };

    const first = checkTokenBudget(tracker, undefined, limits, 1_000);
    expect(first.action).toBe("continue");

    const second = checkTokenBudget(tracker, undefined, limits, 1_300);
    expect(second.action).toBe("continue");

    const third = checkTokenBudget(tracker, undefined, limits, 1_600);
    expect(third.action).toBe("continue");

    const fourth = checkTokenBudget(tracker, undefined, limits, 1_850);
    expect(fourth.action).toBe("stop");
    expect(fourth.completionEvent).not.toBeNull();
    if (fourth.completionEvent) {
      expect(fourth.completionEvent.diminishingReturns).toBe(true);
      expect(fourth.completionEvent.continuationCount).toBe(3);
    }
    expect(tracker.diminishingReturnsDetected).toBe(true);
  });

  it("continues normally when token deltas remain above the threshold", () => {
    vi.spyOn(mode, "isSelfHosted").mockReturnValue(false);

    const tracker = createBudgetTracker();
    const limits = { turnBudget: 10_000 };

    const first = checkTokenBudget(tracker, undefined, limits, 1_000);
    const second = checkTokenBudget(tracker, undefined, limits, 2_100);
    const third = checkTokenBudget(tracker, undefined, limits, 3_400);
    const fourth = checkTokenBudget(tracker, undefined, limits, 4_800);

    expect(first.action).toBe("continue");
    expect(second.action).toBe("continue");
    expect(third.action).toBe("continue");
    expect(fourth.action).toBe("continue");
    expect(tracker.diminishingReturnsDetected).toBe(false);
  });
});
