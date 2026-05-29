/**
 * Ink re-exports and custom hooks.
 * Re-exports from the `ink` library, plus custom animation/focus hooks.
 */

// Re-export Ink core
export { render, Box, Text, useInput, useApp, useStdout, useStderr, Static, measureElement } from "ink";
export type { DOMElement } from "ink";

// Custom hooks expected by useBlink — implemented as passthroughs to Ink
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Animation frame hook — fires callback at the given interval.
 * Returns a ref setter and the elapsed time since the animation started.
 */
export function useAnimationFrame(
  interval: number | null,
): [ref: (element: DOMElement | null) => void, time: number] {
  const [time, setTime] = useState(0);
  const ref = useCallback((_element: DOMElement | null) => {
    // Element attachment tracking — no-op for blink purposes
  }, []);

  useEffect(() => {
    if (interval === null) return;
    const id = setInterval(() => {
      setTime((t) => t + interval);
    }, interval);
    return () => clearInterval(id);
  }, [interval]);

  return [ref, time];
}

/**
 * Terminal focus hook — returns true when the terminal is focused.
 * Ink terminals are always considered focused unless a specific
 * blur event is detected (e.g. SIGTSTP/SIGCONT).
 */
export function useTerminalFocus(): boolean {
  const [focused] = useState(true);
  return focused;
}
