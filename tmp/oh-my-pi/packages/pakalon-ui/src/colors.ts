export const COLORS = {
	primary: "#6366f1",
	secondary: "#8b5cf6",
	success: "#22c55e",
	warning: "#f59e0b",
	error: "#ef4444",
	info: "#3b82f6",
	background: "#0f172a",
	surface: "#1e293b",
	text: "#f1f5f9",
	textSecondary: "#94a3b8",
	border: "#334155",
};

export const STATUS_COLORS: Record<string, string> = {
	success: COLORS.success,
	warning: COLORS.warning,
	error: COLORS.error,
	info: COLORS.info,
	running: COLORS.primary,
	pending: COLORS.textSecondary,
	completed: COLORS.success,
	failed: COLORS.error,
	skipped: COLORS.warning,
};

export function colorize(text: string, color: string): string {
	return `\x1b[38;2;${hexToRgb(color)}m${text}\x1b[0m`;
}

export function bgColor(text: string, color: string): string {
	return `\x1b[48;2;${hexToRgb(color)}m${text}\x1b[0m`;
}

function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `${r};${g};${b}`;
}
