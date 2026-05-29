/**
 * AbortController helpers shared by streaming tool orchestration.
 */

export function createChildAbortController(parent?: AbortController | AbortSignal): AbortController {
  const controller = new AbortController();
  const parentSignal = parent instanceof AbortController ? parent.signal : parent;

  if (!parentSignal) return controller;

  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason);
    return controller;
  }

  parentSignal.addEventListener(
    "abort",
    () => {
      if (!controller.signal.aborted) {
        controller.abort(parentSignal.reason);
      }
    },
    { once: true },
  );

  return controller;
}

export function abortWithReason(controller: AbortController, reason: unknown): void {
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}
