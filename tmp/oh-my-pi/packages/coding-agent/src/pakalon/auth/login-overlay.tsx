/**
 * Login overlay for the device-code 6-digit auth flow.
 *
 * Renders a centered card with the code, a clickable verify URL, and
 * a live countdown. When the user opens the URL and confirms, the
 * overlay's poll loop returns the resolved user record.
 */

import { Chalk } from "chalk";
import * as React from "react";

export { type LoginOverlayHandle, type ShowLoginOverlayOptions, showLoginOverlay } from "./login-overlay.ts";

export interface LoginOverlayProps {
	code: string;
	verifyUrl: string;
	expiresAt: number;
	/** Called when the user confirms in the web companion. */
	onConfirmed: (user: { id: string; email: string }) => void;
	/** Called when the user presses q/Esc to cancel. */
	onCancel: () => void;
}

const chalk = new Chalk({ level: 1 });

/** Hook that polls a backend every 1.5s for a code confirmation. */
export function useDeviceCodePoll(
	code: string,
	expiresAt: number,
	signal: AbortSignal,
): { user: { id: string; email: string } | null; secondsLeft: number } {
	const [user, setUser] = React.useState<{ id: string; email: string } | null>(null);
	const [secondsLeft, setSecondsLeft] = React.useState(() => Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

	React.useEffect(() => {
		const id = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1_000);
		return () => clearInterval(id);
	}, []);

	React.useEffect(() => {
		const id = setInterval(async () => {
			if (signal.aborted || user) return;
			try {
				const resp = await fetch(`/auth/poll?code=${code}`);
				if (resp.ok) {
					const data = (await resp.json()) as { status: string; userId?: string; email?: string };
					if (data.status === "confirmed" && data.userId && data.email) {
						setUser({ id: data.userId, email: data.email });
					}
				}
			} catch {
				/* ignore network blip */
			}
		}, 1_500);
		return () => clearInterval(id);
	}, [code, signal, user]);

	return { user, secondsLeft };
}

export function LoginOverlay({ code, verifyUrl, expiresAt, onConfirmed, onCancel }: LoginOverlayProps) {
	const ctrl = React.useMemo(() => new AbortController(), []);
	const { user, secondsLeft } = useDeviceCodePoll(code, expiresAt, ctrl.signal);

	React.useEffect(() => {
		if (user) onConfirmed(user);
	}, [user, onConfirmed]);

	const minutes = Math.floor(secondsLeft / 60);
	const seconds = secondsLeft % 60;

	return React.createElement(
		"box",
		{ borderStyle: "round", borderColor: "cyan", padding: 1, flexDirection: "column", alignItems: "center" },
		Text({ children: "Pakalon — Sign in", bold: true, color: "cyan" }),
		React.createElement(
			"box",
			{ marginTop: 1, flexDirection: "column", alignItems: "center" },
			Text({ children: "Open this URL in your browser:" }),
			Text({ children: verifyUrl, color: "blue", underline: true }),
		),
		React.createElement(
			"box",
			{ marginTop: 1, flexDirection: "column", alignItems: "center" },
			Text({ children: "Then enter this 6-digit code:" }),
			Text({ children: formatCode(code), bold: true, color: "yellow" }),
		),
		React.createElement(
			"box",
			{ marginTop: 1, flexDirection: "row" },
			Text({
				children: `Code expires in ${minutes}:${seconds.toString().padStart(2, "0")} — press q to cancel`,
				dim: true,
			}),
		),
	);
}

interface TextProps {
	children: string;
	bold?: boolean;
	color?: string;
	dim?: boolean;
	underline?: boolean;
}

function Text(props: TextProps): React.ReactElement {
	const propsOut: Record<string, string | boolean> = {};
	if (props.bold) propsOut.bold = true;
	if (props.dim) propsOut.dim = true;
	if (props.underline) propsOut.underline = true;
	if (props.color !== undefined) propsOut.color = props.color;
	return React.createElement("text", propsOut, props.children);
}

function formatCode(code: string): string {
	// Render with thin spaces between digits for legibility: 123 456
	return code.split("").join(" ");
}

/** Re-export the chalk instance for callers that want to embed it. */
export { chalk };
