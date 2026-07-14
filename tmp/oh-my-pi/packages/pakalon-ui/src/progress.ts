const BAR_WIDTH = 30;

export function renderProgressBar(percentage: number): string {
	const filled = Math.round((percentage / 100) * BAR_WIDTH);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	return `[${bar}] ${Math.round(percentage)}%`;
}

export function renderPhaseProgress(current: number, total: number): string {
	return `Phase ${current}/${total} ${renderProgressBar((current / total) * 100)}`;
}
