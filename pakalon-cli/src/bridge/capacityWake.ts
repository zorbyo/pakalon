/**
 * Shared capacity-wake primitive for bridge poll loops.
 *
 * Both replBridge.ts and bridgeMain.ts need to sleep while "at capacity"
 * but wake early when either (a) the outer loop signal aborts (shutdown),
 * or (b) capacity frees up (session done / transport lost).
 */

import type { CapacitySignal, CapacityWake } from "./types.js";

export function createCapacityWake(outerSignal: AbortSignal): CapacityWake {
  let wakeController = new AbortController();

  function wake(): void {
    wakeController.abort();
    wakeController = new AbortController();
  }

  function signal(): CapacitySignal {
    const merged = new AbortController();
    const abort = (): void => merged.abort();

    if (outerSignal.aborted || wakeController.signal.aborted) {
      merged.abort();
      return { signal: merged.signal, cleanup: () => {} };
    }

    outerSignal.addEventListener("abort", abort, { once: true });
    const capSig = wakeController.signal;
    capSig.addEventListener("abort", abort, { once: true });

    return {
      signal: merged.signal,
      cleanup: () => {
        outerSignal.removeEventListener("abort", abort);
        capSig.removeEventListener("abort", abort);
      },
    };
  }

  return { signal, wake };
}

export type { CapacitySignal, CapacityWake };