/**
 * Multi-session dashboard TUI component.
 *
 * Renders one card per session in the current project, with a
 * per-session blink indicator (running / needs-input / done /
 * archived) and a `+` button at the bottom for creating a new
 * session. Uses the existing `tui/blink.ts` indicator under the hood.
 */
import * as React from "react";
import { startIndicator, stopIndicator } from "../../tui/blink";
import { PakalonStatusPanel, type PakalonStatusPanelProps } from "./status-panel";

/** Local status enum — kept here so the dashboard is self-contained. */
export type BlinkStatus = "running" | "idle" | "needsInput" | "done" | "error" | "archived";

/** Render the indicator glyph + label for a status. */
export function describeBlinkStatus(status: BlinkStatus): string {
	switch (status) {
		case "running":
			return "●  running";
		case "needsInput":
			return "▲  needs input";
		case "done":
			return "✓  done";
		case "error":
			return "✗  error";
		case "archived":
			return "▣  archived";
		default:
			return "○  idle";
	}
}

export interface SessionCard {
	id: string;
	name: string;
	status: BlinkStatus;
	createdAt: number;
	messageCount: number;
	model: string;
	phase?: string;
}

export interface MultiSessionDashboardProps {
	cards: SessionCard[];
	selectedIndex: number;
	onSelect: (id: string) => void;
	onNew: () => void;
	onClose: () => void;
	statusPanel?: PakalonStatusPanelProps;
}

const PALETTE: Record<BlinkStatus, string> = {
	running: "cyan",
	idle: "gray",
	needsInput: "yellow",
	done: "green",
	error: "red",
	archived: "gray",
};

/** Manage live indicator lifecycles for the visible cards. */
export function useBlinkIndicators(cards: SessionCard[]): void {
	React.useEffect(() => {
		const ids: string[] = [];
		for (const c of cards) {
			if (c.status === "running" || c.status === "needsInput") {
				ids.push(startIndicator(c.name));
			}
		}
		return () => {
			for (const id of ids) stopIndicator(id);
		};
	}, [cards]);
}

export function MultiSessionDashboard({
	cards,
	selectedIndex,
	onSelect,
	onNew,
	onClose,
	statusPanel,
}: MultiSessionDashboardProps): React.ReactElement {
	useBlinkIndicators(cards);
	return React.createElement(
		"box",
		{ borderStyle: "round", borderColor: "magenta", padding: 1, flexDirection: "column" },
		statusPanel ? React.createElement(PakalonStatusPanel, statusPanel) : null,
		React.createElement(
			"text",
			{ bold: true, color: "magenta" },
			`Multi-Session Dashboard (${cards.length} session${cards.length === 1 ? "" : "s"})`,
		),
		React.createElement(
			"box",
			{ marginTop: 1, flexDirection: "column" },
			...cards.map((c, i) => renderCard(c, i === selectedIndex, onSelect)),
		),
		React.createElement(
			"box",
			{ marginTop: 1, flexDirection: "row" },
			React.createElement("text", { color: "green" }, "+ New session"),
			React.createElement("text", { dim: true }, "    "),
			React.createElement("text", { color: "red" }, "q Close"),
		),
	);
}

function renderCard(card: SessionCard, selected: boolean, onSelect: (id: string) => void): React.ReactElement {
	const indicator = describeBlinkStatus(card.status);
	const color = PALETTE[card.status];
	const marker = selected ? ">" : " ";
	return React.createElement(
		"box",
		{
			borderStyle: selected ? "double" : "single",
			borderColor: selected ? "magenta" : "gray",
			paddingX: 1,
			marginY: 0,
			flexDirection: "row",
			onClick: () => onSelect(card.id),
		},
		React.createElement("text", { color }, indicator),
		React.createElement("text", { color }, ` ${marker} ${card.name} `),
		React.createElement("text", { dim: true }, `(${card.id.slice(0, 8)} · ${card.messageCount} msgs · ${card.model}`),
		card.phase ? React.createElement("text", { dim: true }, ` · ${card.phase}`) : null,
		React.createElement("text", { dim: true }, ")"),
	);
}

/** Default per-session name when none is provided. */
export function defaultSessionName(index: number): string {
	return `Session ${index + 1}`;
}
