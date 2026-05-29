import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { formatDuration } from "@/utils/format.js";

export type BlinkingIndicatorStatus = "running" | "completed" | "failed" | "idle";
export type BlinkingIndicatorVariant = "spinner" | "dots" | "pulse" | "blink";

export interface BlinkingIndicatorProps {
  label?: string;
  status: BlinkingIndicatorStatus;
  variant: BlinkingIndicatorVariant;
  elapsed?: number | string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT_FRAMES = ["·  ", "·· ", "···", " ··", "  ·"];
const PULSE_FRAMES = ["◜", "◠", "◝", "◞", "◡", "◟"];

function formatElapsed(elapsed?: number | string): string | null {
  if (elapsed === undefined) return null;
  if (typeof elapsed === "string") return elapsed;
  return formatDuration(Math.max(0, elapsed));
}

const BlinkingIndicator: React.FC<BlinkingIndicatorProps> = ({
  label,
  status,
  variant,
  elapsed,
}) => {
  const [frame, setFrame] = useState(0);
  const [runningElapsed, setRunningElapsed] = useState(() =>
    typeof elapsed === "number" ? elapsed : 0,
  );
  const lastElapsedRef = useRef<number | null>(typeof elapsed === "number" ? elapsed : null);

  useEffect(() => {
    if (typeof elapsed === "number") {
      lastElapsedRef.current = elapsed;
      setRunningElapsed(elapsed);
    }
  }, [elapsed]);

  useEffect(() => {
    if (status !== "running") {
      setFrame(0);
      return;
    }

    const intervalMs = variant === "spinner" ? 80 : variant === "dots" ? 180 : 220;
    const timer = setInterval(() => {
      setFrame((current) => current + 1);
      if (typeof lastElapsedRef.current === "number") {
        setRunningElapsed((current) => current + 1000);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [status, variant]);

  useInput(() => {}, { isActive: status === "running" && variant === "blink" });

  const indicator = useMemo(() => {
    if (status === "completed") return "✓";
    if (status === "failed") return "✗";
    if (status === "idle") return "○";

    if (variant === "dots") return DOT_FRAMES[frame % DOT_FRAMES.length] ?? DOT_FRAMES[0];
    if (variant === "pulse") return PULSE_FRAMES[frame % PULSE_FRAMES.length] ?? PULSE_FRAMES[0];
    if (variant === "blink") return frame % 2 === 0 ? "▍" : " ";
    return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
  }, [frame, status, variant]);

  const color =
    status === "running" ? "yellow" : status === "completed" ? "green" : status === "failed" ? "red" : "gray";

  const elapsedText = formatElapsed(elapsed ?? (status === "running" ? runningElapsed : undefined));

  return (
    <Box>
      <Text color={color}>{indicator}</Text>
      {label ? (
        <Text color={color}>
          {" "}
          {label}
        </Text>
      ) : null}
      {elapsedText ? <Text dimColor>{` (${elapsedText})`}</Text> : null}
    </Box>
  );
};

export default React.memo(BlinkingIndicator);
