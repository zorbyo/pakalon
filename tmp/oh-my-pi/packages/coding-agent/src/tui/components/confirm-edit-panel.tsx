/**
 * ConfirmEditPanel — shown after a sub-agent completes its work (Phase 3
 * frontend designing, etc.). Displays what changed, with options:
 *   Enter  → Confirm Edit (accept changes)
 *   M      → Make Changes (enter feedback mode)
 *   Esc    → Dismiss
 *
 * Supports three modes:
 *   hil        — full interactive (Enter/M/Esc)
 *   auto-accept — auto-confirms after a 3-second countdown
 *   yolo       — auto-confirms immediately
 */

import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────

export interface ConfirmEditPanelProps {
	subAgentName: string;
	changesSummary: string;
	filesChanged: string[];
	mode: "hil" | "auto-accept" | "yolo";
	onConfirm: () => void;
	onMakeChanges: () => void;
	onFeedback?: (message: string) => void;
}

type FileChangeType = "added" | "modified" | "deleted";

interface ParsedFileChange {
	path: string;
	type: FileChangeType;
}

const CHANGE_COLORS: Record<FileChangeType, string> = {
	added: "green",
	modified: "yellow",
	deleted: "red",
};

// ─── Helpers ───────────────────────────────────────────────────────────

function parseFileChange(input: string): ParsedFileChange {
	const normalized = input.trim();
	const prefixMatch = normalized.match(/^(added|modified|deleted)[:\s]+(.+)$/i);
	if (prefixMatch) {
		return {
			type: prefixMatch[1]!.toLowerCase() as FileChangeType,
			path: prefixMatch[2]!.trim(),
		};
	}
	if (normalized.startsWith("+")) return { type: "added", path: normalized.slice(1).trim() };
	if (normalized.startsWith("-")) return { type: "deleted", path: normalized.slice(1).trim() };
	return { type: "modified", path: normalized };
}

// ─── Component ─────────────────────────────────────────────────────────

const ConfirmEditPanel: React.FC<ConfirmEditPanelProps> = ({
	subAgentName,
	changesSummary,
	filesChanged,
	mode,
	onConfirm,
	onMakeChanges,
	onFeedback,
}) => {
	const [countdown, setCountdown] = useState(3);
	const actionTakenRef = useRef(false);

	const parsedFiles = useMemo(() => filesChanged.map(parseFileChange), [filesChanged]);

	const confirmOnce = useCallback(() => {
		if (actionTakenRef.current) return;
		actionTakenRef.current = true;
		onConfirm();
	}, [onConfirm]);

	const makeChangesOnce = useCallback(() => {
		if (actionTakenRef.current) return;
		actionTakenRef.current = true;
		onMakeChanges();
	}, [onMakeChanges]);

	useEffect(() => {
		if (mode === "yolo") {
			confirmOnce();
			return;
		}
		if (mode !== "auto-accept") return;
		setCountdown(3);
		const timer = setInterval(() => {
			setCountdown(current => {
				if (current <= 1) {
					clearInterval(timer);
					confirmOnce();
					return 0;
				}
				return current - 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [mode, confirmOnce]);

	useInput((input, key) => {
		if (key.return) {
			confirmOnce();
			return;
		}
		if (input === "m" || input === "M") {
			makeChangesOnce();
			return;
		}
	});

	return React.createElement(
		Box,
		{ flexDirection: "column", marginY: 1, borderStyle: "round", borderColor: "green", paddingX: 1 },
		// Header
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(Text, { bold: true, color: "green" }, "Phase 3 Complete"),
			React.createElement(Text, null, " "),
			React.createElement(Text, { dimColor: true, color: "gray" }, `— ${subAgentName}`),
		),
		// Summary
		React.createElement(
			Box,
			{ marginBottom: 1, flexDirection: "column" },
			React.createElement(Text, null, changesSummary),
		),
		// Files changed
		React.createElement(
			Box,
			{ flexDirection: "column", marginBottom: 1 },
			React.createElement(Text, { bold: true, color: "gray" }, "Files changed"),
			parsedFiles.length > 0
				? parsedFiles.map(file =>
						React.createElement(
							Box,
							{ key: `${file.type}:${file.path}` },
							React.createElement(Text, { color: CHANGE_COLORS[file.type] }, `[${file.type}]`),
							React.createElement(Text, null, ` ${file.path}`),
						),
					)
				: React.createElement(Text, { dimColor: true }, "No files reported"),
		),
		// Action buttons
		React.createElement(
			Box,
			{ flexDirection: "row", gap: 2, marginBottom: 1 },
			React.createElement(
				Box,
				{ borderStyle: "single", borderColor: "green", paddingX: 1 },
				React.createElement(Text, { color: "green", bold: true }, "Confirm Edit"),
			),
			React.createElement(
				Box,
				{ borderStyle: "single", borderColor: "yellow", paddingX: 1 },
				React.createElement(Text, { color: "yellow", bold: true }, "Make Changes"),
			),
		),
		// Keyboard hints
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(Text, { dimColor: true, color: "gray" }, "Enter: confirm  M: make changes"),
		),
		// Mode-specific messages
		mode === "auto-accept"
			? React.createElement(
					Box,
					null,
					React.createElement(Text, { color: "yellow" }, `Auto-confirming in ${countdown}s`),
				)
			: null,
		mode === "yolo"
			? React.createElement(Box, null, React.createElement(Text, { color: "green" }, "Auto-confirming now"))
			: null,
		onFeedback && mode === "hil"
			? React.createElement(
					Box,
					{ marginTop: 1 },
					React.createElement(Text, { dimColor: true, color: "gray" }, "Use the feedback flow to request edits."),
				)
			: null,
	);
};

export default React.memo(ConfirmEditPanel);
