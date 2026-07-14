/**
 * BlinkingIndicator — a React component that renders an animated
 * indicator glyph (spinner / dots / pulse / blink) alongside a label
 * and optional elapsed time. Wraps the low-level `blink.ts` primitives.
 *
 * Variants:
 *   spinner — braille dots (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
 *   dots    — three-dot progression (·  ·· ··· ·· · )
 *   pulse   — rotating arc (◜ ◠ ◝ ◞ ◡ ◟)
 *   blink   — block cursor blink (▍ / space)
 */

import { Box, Text } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";

// ─── Frames ────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT_FRAMES = ["·  ", "·· ", "···", " ··", "  ·"];
const PULSE_FRAMES = ["◜", "◠", "◝", "◞", "◡", "◟"];

// ─── Types ─────────────────────────────────────────────────────────────

export type BlinkingIndicatorStatus = "running" | "completed" | "failed" | "idle";
export type BlinkingIndicatorVariant = "spinner" | "dots" | "pulse" | "blink";

export interface BlinkingIndicatorProps {
	label?: string;
	status: BlinkingIndicatorStatus;
	variant?: BlinkingIndicatorVariant;
	/** Pass a number (ms) or a pre-formatted string. */
	elapsed?: number | string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatElapsed(elapsed?: number | string): string | null {
	if (elapsed === undefined) return null;
	if (typeof elapsed === "string") return elapsed;
	const ms = Math.max(0, elapsed);
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ─── Component ─────────────────────────────────────────────────────────

const BlinkingIndicator: React.FC<BlinkingIndicatorProps> = ({ label, status, variant = "spinner", elapsed }) => {
	const [frame, setFrame] = useState(0);
	const [runningElapsed, setRunningElapsed] = useState(() => (typeof elapsed === "number" ? elapsed : 0));
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
			setFrame(c => c + 1);
			if (typeof lastElapsedRef.current === "number") {
				setRunningElapsed(c => c + intervalMs);
			}
		}, intervalMs);
		return () => clearInterval(timer);
	}, [status, variant]);

	const indicator = useMemo(() => {
		if (status === "completed") return "✓";
		if (status === "failed") return "✗";
		if (status === "idle") return "○";
		switch (variant) {
			case "dots":
				return DOT_FRAMES[frame % DOT_FRAMES.length] ?? DOT_FRAMES[0];
			case "pulse":
				return PULSE_FRAMES[frame % PULSE_FRAMES.length] ?? PULSE_FRAMES[0];
			case "blink":
				return frame % 2 === 0 ? "▍" : " ";
			default:
				return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
		}
	}, [frame, status, variant]);

	const color =
		status === "running" ? "yellow" : status === "completed" ? "green" : status === "failed" ? "red" : "gray";

	const elapsedText = formatElapsed(elapsed ?? (status === "running" ? runningElapsed : undefined));

	return React.createElement(
		Box,
		null,
		React.createElement(Text, { color }, indicator),
		label ? React.createElement(Text, { color }, ` ${label}`) : null,
		elapsedText ? React.createElement(Text, { dimColor: true }, ` (${elapsedText})`) : null,
	);
};

export default React.memo(BlinkingIndicator);
