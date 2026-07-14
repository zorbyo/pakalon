import type { Component } from "../tui";
import { Ellipsis, truncateToWidth } from "../utils";

export interface ChoiceOption {
	value: string;
	label: string;
	description?: string;
}

export interface MultiChoicePromptOptions {
	/** The question or prompt text */
	question: string;
	/** Available choices */
	choices: ChoiceOption[];
	/** Allow multiple selections (checkbox mode) */
	multi?: boolean;
	/** Callback when user makes a selection */
	onSelect: (values: string[]) => void;
	/** Callback when user cancels */
	onCancel?: () => void;
	/** Follow-up questions shown below choices */
	followUpQuestions?: string[];
	/** Callback when user clicks a follow-up question */
	onFollowUp?: (question: string) => void;
	/** Theme functions */
	theme: {
		questionText: (text: string) => string;
		selectedBg: (text: string) => string;
		normalText: (text: string) => string;
		dimText: (text: string) => string;
		hintText: (text: string) => string;
	};
}

/**
 * Interactive multiple-choice prompt component for HIL (Human-in-Loop) mode.
 * Displays a question with selectable options and optional follow-up questions.
 *
 * Used in Phase 1 for Q&A sessions where the AI agent asks the user about
 * tech stack, design preferences, etc.
 */
export class MultiChoicePrompt implements Component {
	#selectedIndex = 0;
	#selectedValues = new Set<string>();
	#filteredChoices: ChoiceOption[];

	constructor(private readonly options: MultiChoicePromptOptions) {
		this.#filteredChoices = [...options.choices];
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const maxWidth = Math.max(40, width - 4);

		// Question
		lines.push("");
		lines.push(this.options.theme.questionText(`  ${this.options.question}`));
		lines.push("");

		// Instructions
		if (this.options.multi) {
			lines.push(this.options.theme.hintText("  Space to toggle, Enter to confirm, ↑↓ to navigate"));
		} else {
			lines.push(this.options.theme.hintText("  ↑↓ to navigate, Enter to select, Esc to cancel"));
		}
		lines.push("");

		// Choices
		for (let i = 0; i < this.#filteredChoices.length; i++) {
			const choice = this.#filteredChoices[i];
			if (!choice) continue;

			const isSelected = i === this.#selectedIndex;
			const isChecked = this.options.multi && this.#selectedValues.has(choice.value);
			const prefix = isSelected ? "  > " : "    ";
			const checkbox = this.options.multi ? (isChecked ? "[x] " : "[ ] ") : "";

			const label = truncateToWidth(choice.label, maxWidth - 8, Ellipsis.Omit);
			const desc = choice.description
				? ` — ${truncateToWidth(choice.description, maxWidth - label.length - 12, Ellipsis.Omit)}`
				: "";

			const text = isSelected
				? this.options.theme.selectedBg(`${checkbox}${label}`)
				: this.options.theme.normalText(`${checkbox}${label}`);

			const descText = desc ? this.options.theme.dimText(desc) : "";
			lines.push(`${prefix}${text}${descText}`);
		}

		// Follow-up questions
		if (this.options.followUpQuestions && this.options.followUpQuestions.length > 0) {
			lines.push("");
			lines.push(this.options.theme.hintText("  Follow-up questions:"));
			for (const q of this.options.followUpQuestions) {
				const truncated = truncateToWidth(q, maxWidth - 6, Ellipsis.Omit);
				lines.push(`    ${this.options.theme.dimText(`• ${truncated}`)}`);
			}
		}

		lines.push("");
		return lines;
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A" || keyData === "k") {
			this.#selectedIndex = this.#selectedIndex === 0 ? this.#filteredChoices.length - 1 : this.#selectedIndex - 1;
		}
		// Down arrow
		else if (keyData === "\x1b[B" || keyData === "j") {
			this.#selectedIndex = this.#selectedIndex === this.#filteredChoices.length - 1 ? 0 : this.#selectedIndex + 1;
		}
		// Enter
		else if (keyData === "\r" || keyData === "\n") {
			if (this.options.multi) {
				// In multi mode, Enter confirms the selection
				this.options.onSelect([...this.#selectedValues]);
			} else {
				// In single mode, Enter selects the current item
				const choice = this.#filteredChoices[this.#selectedIndex];
				if (choice) {
					this.options.onSelect([choice.value]);
				}
			}
		}
		// Space (multi-select toggle)
		else if (keyData === " " && this.options.multi) {
			const choice = this.#filteredChoices[this.#selectedIndex];
			if (choice) {
				if (this.#selectedValues.has(choice.value)) {
					this.#selectedValues.delete(choice.value);
				} else {
					this.#selectedValues.add(choice.value);
				}
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			this.options.onCancel?.();
		}
		// Number keys for quick selection
		else if (/^[1-9]$/.test(keyData)) {
			const idx = parseInt(keyData, 10) - 1;
			if (idx < this.#filteredChoices.length) {
				const choice = this.#filteredChoices[idx];
				if (choice) {
					if (this.options.multi) {
						if (this.#selectedValues.has(choice.value)) {
							this.#selectedValues.delete(choice.value);
						} else {
							this.#selectedValues.add(choice.value);
						}
					} else {
						this.options.onSelect([choice.value]);
					}
				}
			}
		}
	}

	getSelectedValues(): string[] {
		return [...this.#selectedValues];
	}

	invalidate(): void {}
}

export interface QAQuestionOptions {
	/** The question text */
	question: string;
	/** Numbered choices */
	choices: string[];
	/** The "End Phase" option label */
	endLabel?: string;
	/** Callback when user selects a choice */
	onSelect: (index: number) => void;
	/** Callback when user selects "End Phase" */
	onEndPhase?: () => void;
	theme: {
		questionText: (text: string) => string;
		selectedBg: (text: string) => string;
		normalText: (text: string) => string;
		dimText: (text: string) => string;
		hintText: (text: string) => string;
	};
}

/**
 * Simplified Q&A question component for Phase 1 interactive sessions.
 * Shows a question with numbered choices and an "End Phase" option.
 */
export class QAQuestion implements Component {
	#selectedIndex = 0;

	constructor(private readonly options: QAQuestionOptions) {}

	render(width: number): string[] {
		const lines: string[] = [];
		const maxWidth = Math.max(40, width - 4);

		lines.push("");
		lines.push(this.options.theme.questionText(`  ${this.options.question}`));
		lines.push("");
		lines.push(this.options.theme.hintText("  ↑↓ to navigate, Enter to select, Esc to cancel"));
		lines.push("");

		const allChoices = [...this.options.choices, this.options.endLabel ?? "End Phase 1"];

		for (let i = 0; i < allChoices.length; i++) {
			const choice = allChoices[i];
			if (!choice) continue;

			const isSelected = i === this.#selectedIndex;
			const isEndPhase = i === this.options.choices.length;
			const prefix = isSelected ? "  > " : "    ";
			const number = `${i + 1}. `;
			const text = isSelected
				? this.options.theme.selectedBg(`${number}${choice}`)
				: isEndPhase
					? this.options.theme.hintText(`${number}${choice}`)
					: this.options.theme.normalText(`${number}${choice}`);

			lines.push(`${prefix}${text}`);
		}

		lines.push("");
		return lines;
	}

	handleInput(keyData: string): void {
		const allChoices = [...this.options.choices, this.options.endLabel ?? "End Phase 1"];
		const maxIndex = allChoices.length - 1;

		// Up arrow
		if (keyData === "\x1b[A" || keyData === "k") {
			this.#selectedIndex = this.#selectedIndex === 0 ? maxIndex : this.#selectedIndex - 1;
		}
		// Down arrow
		else if (keyData === "\x1b[B" || keyData === "j") {
			this.#selectedIndex = this.#selectedIndex === maxIndex ? 0 : this.#selectedIndex + 1;
		}
		// Enter
		else if (keyData === "\r" || keyData === "\n") {
			const isEndPhase = this.#selectedIndex === this.options.choices.length;
			if (isEndPhase) {
				this.options.onEndPhase?.();
			} else {
				this.options.onSelect(this.#selectedIndex);
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			// Do nothing — user can navigate to "End Phase" to exit
		}
		// Number keys
		else if (/^[1-9]$/.test(keyData)) {
			const idx = parseInt(keyData, 10) - 1;
			if (idx <= maxIndex) {
				this.#selectedIndex = idx;
				const isEndPhase = idx === this.options.choices.length;
				if (isEndPhase) {
					this.options.onEndPhase?.();
				} else {
					this.options.onSelect(idx);
				}
			}
		}
	}

	invalidate(): void {}
}
