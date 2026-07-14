/**
 * Pakalon React status panel.
 *
 * Composite React component rendering auth status, context meter, active
 * model, phase info, and HIL/YOLO mode in a single horizontal bar.
 */
import * as React from "react";
import { ContextMeter } from "./context-meter.tsx";
import { type BlinkStatus, describeBlinkStatus } from "./multi-session-dashboard";

export type PhaseName = "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";
export type HilYoloMode = "HIL" | "YOLO";

export interface PakalonStatusPanelProps {
	authTier: "free" | "pro" | "selfhost" | "anonymous";
	modelName: string;
	contextWindow: number;
	usedTokens: number;
	permissionMode: "plan" | "edit" | "auto-accept" | "bypass";
	currentPhase?: PhaseName | null;
	hilYoloMode?: HilYoloMode | null;
	sessionStatus?: BlinkStatus;
	indicatorId?: string;
	tokenUsage?: { used: number; allocated: number; percentage: number };
}

const PERMISSION_MODE_LABELS: Record<PakalonStatusPanelProps["permissionMode"], string> = {
	plan: "PLAN",
	edit: "EDIT",
	"auto-accept": "AUTO",
	bypass: "YOLO",
};

const PERMISSION_MODE_COLORS: Record<PakalonStatusPanelProps["permissionMode"], string> = {
	plan: "cyan",
	edit: "blue",
	"auto-accept": "yellow",
	bypass: "red",
};

const TIER_LABELS: Record<PakalonStatusPanelProps["authTier"], string> = {
	free: "FREE",
	pro: "PRO",
	selfhost: "SELF-HOST",
	anonymous: "GUEST",
};

const TIER_COLORS: Record<PakalonStatusPanelProps["authTier"], string> = {
	free: "gray",
	pro: "magenta",
	selfhost: "green",
	anonymous: "red",
};

const PHASE_LABELS: Record<PhaseName, string> = {
	"phase-1": "Planning",
	"phase-2": "Design",
	"phase-3": "Dev",
	"phase-4": "Testing",
	"phase-5": "Deploy",
	"phase-6": "Docs",
};

const PHASE_SHORT: Record<PhaseName, string> = {
	"phase-1": "P1",
	"phase-2": "P2",
	"phase-3": "P3",
	"phase-4": "P4",
	"phase-5": "P5",
	"phase-6": "P6",
};

export function PakalonStatusPanel(props: PakalonStatusPanelProps): React.ReactElement {
	const children: React.ReactElement[] = [];

	children.push(
		React.createElement(
			"text",
			{ key: "tier", color: TIER_COLORS[props.authTier] },
			`[${TIER_LABELS[props.authTier]}]`,
		),
	);

	children.push(React.createElement("text", { key: "s1" }, "  "));
	children.push(React.createElement("text", { key: "model", color: "white" }, props.modelName));

	children.push(React.createElement("text", { key: "s2" }, "  "));
	children.push(
		React.createElement(ContextMeter, {
			key: "meter",
			usedTokens: props.usedTokens,
			maxTokens: props.contextWindow,
		}),
	);

	children.push(React.createElement("text", { key: "s3" }, "  "));
	children.push(
		React.createElement(
			"text",
			{ key: "pmode", color: PERMISSION_MODE_COLORS[props.permissionMode] },
			`[${PERMISSION_MODE_LABELS[props.permissionMode]}]`,
		),
	);

	if (props.currentPhase) {
		const short = PHASE_SHORT[props.currentPhase];
		const label = PHASE_LABELS[props.currentPhase];
		children.push(React.createElement("text", { key: "s4" }, "  "));
		children.push(React.createElement("text", { key: "phase", color: "cyan" }, `[${short}:${label}]`));
	}

	if (props.hilYoloMode) {
		const hilColor = props.hilYoloMode === "HIL" ? "yellow" : "red";
		children.push(React.createElement("text", { key: "s5" }, "  "));
		children.push(React.createElement("text", { key: "mode", color: hilColor }, `[${props.hilYoloMode}]`));
	}

	if (props.tokenUsage) {
		const { used, allocated, percentage } = props.tokenUsage;
		children.push(React.createElement("text", { key: "s6" }, "  "));
		children.push(
			React.createElement(
				"text",
				{ key: "tokens", color: "white" },
				`Tokens: ${used.toLocaleString()} / ${allocated.toLocaleString()} (${percentage.toFixed(1)}%)`,
			),
		);
	} else if (props.currentPhase) {
		children.push(React.createElement("text", { key: "s6" }, "  "));
		children.push(React.createElement("text", { key: "tokens", color: "white" }, `Tokens: --`));
	}

	if (props.sessionStatus) {
		children.push(
			React.createElement(
				"text",
				{ key: "session", color: "white" },
				`  ${describeBlinkStatus(props.sessionStatus)}`,
			),
		);
	}

	return React.createElement(
		"box",
		{ borderStyle: "single", borderColor: "gray", flexDirection: "row", paddingX: 1 },
		...children,
	);
}
