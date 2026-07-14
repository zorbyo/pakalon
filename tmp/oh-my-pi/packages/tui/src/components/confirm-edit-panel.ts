import type { Component } from "../tui";
import { Ellipsis, truncateToWidth, visibleWidth } from "../utils";

export interface ConfirmEditItem {
	filePath: string;
	/** Brief description of what changed */
	summary: string;
	/** Optional diff preview */
	diff?: string;
}

export interface ConfirmEditPanelOptions {
	/** List of files/changes to review */
	changes: ConfirmEditItem[];
	/** Title shown at top */
	title?: string;
	/** Callback when user confirms all changes */
	onConfirm?: () => void;
	/** Callback when user requests changes */
	onMakeChanges?: () => void;
	/** Callback when user cancels */
	onCancel?: () => void;
	/** Theme functions */
	theme: {
		selectedBg: (text: string) => string;
		normalText: (text: string) => string;
		dimText: (text: string) => string;
		successText: (text: string) => string;
		warningText: (text: string) => string;
	};
}

/**
 * Panel shown after a sub-agent completes work (e.g., frontend design).
 * Shows the user what changed and gives them options:
 *   1. Confirm Edit — accept changes and proceed
 *   2. Make Changes — open chat for modification requests
 *   3. Cancel — reject changes
 */
export class ConfirmEditPanel implements Component {
	#selectedIndex = 0;
	private readonly actions = ["Confirm Edit", "Make Changes", "Cancel"];

	constructor(private readonly options: ConfirmEditPanelOptions) {}

	render(width: number): string[] {
		const lines: string[] = [];
		const title = this.options.title ?? "Review Changes";
		const titleWidth = visibleWidth(title);
		const pad = Math.max(0, Math.floor((width - titleWidth - 2) / 2));
		lines.push("");
		lines.push(`${" ".repeat(pad)}${this.options.theme.selectedBg(` ${title} `)}`);
		lines.push("");

		// Show file changes summary
		if (this.options.changes.length > 0) {
			lines.push(this.options.theme.normalText("  Changes:"));
			for (const change of this.options.changes) {
				const file = truncateToWidth(change.filePath, width - 6, Ellipsis.Middle);
				lines.push(`    ${this.options.theme.dimText(file)}`);
				if (change.summary) {
					const summary = truncateToWidth(change.summary, width - 8, Ellipsis.Omit);
					lines.push(`      ${this.options.theme.dimText(summary)}`);
				}
			}
			lines.push("");
		}

		// Show action buttons
		lines.push("  Actions:");
		for (let i = 0; this.actions.length; i++) {
			const action = this.actions[i];
			const isSelected = i === this.#selectedIndex;
			const prefix = isSelected ? "  > " : "    ";
			const text = isSelected ? this.options.theme.selectedBg(` ${action} `) : this.options.theme.normalText(action);
			lines.push(`${prefix}${text}`);
		}
		lines.push("");
		lines.push(this.options.theme.dimText("  ↑↓ to navigate, Enter to select, Esc to cancel"));
		lines.push("");

		return lines;
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A" || keyData === "k") {
			this.#selectedIndex = this.#selectedIndex === 0 ? this.actions.length - 1 : this.#selectedIndex - 1;
		}
		// Down arrow
		else if (keyData === "\x1b[B" || keyData === "j") {
			this.#selectedIndex = this.#selectedIndex === this.actions.length - 1 ? 0 : this.#selectedIndex + 1;
		}
		// Enter
		else if (keyData === "\r" || keyData === "\n") {
			const action = this.actions[this.#selectedIndex];
			if (action === "Confirm Edit") this.options.onConfirm?.();
			else if (action === "Make Changes") this.options.onMakeChanges?.();
			else if (action === "Cancel") this.options.onCancel?.();
		}
		// Escape
		else if (keyData === "\x1b") {
			this.options.onCancel?.();
		}
		// 1, 2, 3 shortcuts
		else if (keyData === "1") {
			this.#selectedIndex = 0;
			this.options.onConfirm?.();
		} else if (keyData === "2") {
			this.#selectedIndex = 1;
			this.options.onMakeChanges?.();
		} else if (keyData === "3") {
			this.#selectedIndex = 2;
			this.options.onCancel?.();
		}
	}

	invalidate(): void {}
}

export interface MakeChangesInputOptions {
	/** Context about what the user might want to change */
	context?: string;
	/** Callback when user submits a change request */
	onSubmit: (changeRequest: string) => void;
	/** Callback when user cancels */
	onCancel: () => void;
	theme: {
		inputText: (text: string) => string;
		dimText: (text: string) => string;
		promptText: (text: string) => string;
	};
}

/**
 * Inline input component for entering change requests.
 * Appears after the user selects "Make Changes" from ConfirmEditPanel.
 */
export class MakeChangesInput implements Component {
	#inputValue = "";
	#cursorPos = 0;

	constructor(private readonly options: MakeChangesInputOptions) {}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push("");
		if (this.options.context) {
			const context = truncateToWidth(this.options.context, width - 4, Ellipsis.Omit);
			lines.push(this.options.theme.dimText(`  Context: ${context}`));
		}
		lines.push(this.options.theme.promptText("  Describe the changes you want:"));

		const prompt = "  > ";
		const inputDisplay = this.options.theme.inputText(this.#inputValue);
		lines.push(`${prompt}${inputDisplay}_`);
		lines.push(this.options.theme.dimText("  Enter to submit, Esc to cancel"));
		lines.push("");

		return lines;
	}

	handleInput(keyData: string): void {
		// Enter
		if (keyData === "\r" || keyData === "\n") {
			if (this.#inputValue.trim()) {
				this.options.onSubmit(this.#inputValue.trim());
			}
			return;
		}
		// Escape
		if (keyData === "\x1b") {
			this.options.onCancel();
			return;
		}
		// Backspace
		if (keyData === "\x7f" || keyData === "\b") {
			if (this.#cursorPos > 0) {
				this.#inputValue = this.#inputValue.slice(0, this.#cursorPos - 1) + this.#inputValue.slice(this.#cursorPos);
				this.#cursorPos--;
			}
			return;
		}
		// Arrow left
		if (keyData === "\x1b[D") {
			this.#cursorPos = Math.max(0, this.#cursorPos - 1);
			return;
		}
		// Arrow right
		if (keyData === "\x1b[C") {
			this.#cursorPos = Math.min(this.#inputValue.length, this.#cursorPos + 1);
			return;
		}
		// Home
		if (keyData === "\x1b[H" || keyData === "\x01") {
			this.#cursorPos = 0;
			return;
		}
		// End
		if (keyData === "\x1b[F" || keyData === "\x05") {
			this.#cursorPos = this.#inputValue.length;
			return;
		}
		// Printable characters
		if (keyData.length === 1 && keyData >= " ") {
			this.#inputValue =
				this.#inputValue.slice(0, this.#cursorPos) + keyData + this.#inputValue.slice(this.#cursorPos);
			this.#cursorPos++;
		}
	}

	getValue(): string {
		return this.#inputValue;
	}

	invalidate(): void {}
}
