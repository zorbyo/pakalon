/**
 * /models command - Model selection with dynamic OpenRouter integration
 */

import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";

export const modelsSelectorCommand: CommandEntry = {
	name: "models",
	description: "Select AI model or view available models",
	usage: "/models [model-name|'auto']",
	async execute(args: string[]) {
		if (args.length === 0) {
			return showModelList();
		}

		const selection = args[0]?.toLowerCase();

		if (selection === "auto") {
			return setAutoModel();
		}

		return setSpecificModel(selection || "auto");
	},
};

function showModelList(): { success: boolean; message: string } {
	const freeModels = [
		"google/gemini-2.0-flash-exp:free",
		"meta-llama/llama-4-maverick:free",
		"mistralai/mistral-small-3.1-24b-instruct:free",
	];

	const proModels = [
		"anthropic/claude-sonnet-4.5",
		"openai/gpt-4o",
		"google/gemini-2.5-pro",
		"meta-llama/llama-4-maverick",
		"mistralai/mistral-large",
	];

	const userTier = process.env.PAKALON_USER_TIER || "free";

	return {
		success: true,
		message:
			`Model Selection\n\n` +
			`Your tier: ${userTier}\n` +
			`Current model: auto (auto-selects best available)\n\n` +
			`Available models:\n\n` +
			`Free models:\n${freeModels.map(m => `   - ${m}`).join("\n")}\n\n` +
			`Pro models:\n${proModels.map(m => `   - ${m}`).join("\n")}\n\n` +
			`Usage:\n` +
			`   /models auto          - Auto-select best model\n` +
			`   /models <name>        - Use specific model\n` +
			`   /models               - Show this list\n\n` +
			`Tip: 'auto' mode selects the model with the largest context window and lowest cost.`,
	};
}

function setAutoModel(): { success: boolean; message: string } {
	const configPath = getModelsConfigPath();
	ensureConfigDir(configPath);

	const config = {
		selectedModel: "auto",
		updatedAt: new Date().toISOString(),
	};

	try {
		const fs = require("fs");
		const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
		Object.assign(existing, config);
		fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

		return {
			success: true,
			message:
				"[OK] Model set to auto\n\n" +
				"Pakalon will automatically select the best model based on:\n" +
				"   - Largest context window\n" +
				"   - Lowest cost per token\n" +
				"   - Availability\n\n" +
				"The model may change as new models are released.",
		};
	} catch (err) {
		return {
			success: false,
			message: `Error: Failed to save model preference: ${err}`,
		};
	}
}

function setSpecificModel(modelName: string): { success: boolean; message: string } {
	const configPath = getModelsConfigPath();
	ensureConfigDir(configPath);

	const config = {
		selectedModel: modelName,
		updatedAt: new Date().toISOString(),
	};

	try {
		const fs = require("fs");
		const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
		Object.assign(existing, config);
		fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

		return {
			success: true,
			message:
				`[OK] Model set to ${modelName}\n\n` +
				"Pakalon will use this model for all interactions.\n\n" +
				"Tip: Use /models auto to return to auto-selection mode.",
		};
	} catch (err) {
		return {
			success: false,
			message: `Error: Failed to save model preference: ${err}`,
		};
	}
}

function getModelsConfigPath(): string {
	return require("path").join(process.cwd(), ".pakalon-agents", "models-config.json");
}

function ensureConfigDir(configPath: string): void {
	const dir = require("path").dirname(configPath);
	require("fs").mkdirSync(dir, { recursive: true });
}

export default modelsSelectorCommand;
