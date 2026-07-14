/**
 * `pakalon local-models` command — Manage local LLM models.
 */
import chalk from "chalk";
import { checkProviderHealth, detectLocalProviders, formatProviderStatus } from "../selfhost";

interface LocalModelsArgs {
	action?: "list" | "status" | "set-default";
	model?: string;
}

function parseArgs(args: string[]): LocalModelsArgs {
	const result: LocalModelsArgs = {};
	for (let i = 2; i < args.length; i++) {
		const arg = args[i];
		if (arg === "list" || arg === "ls") {
			result.action = "list";
		} else if (arg === "status" || arg === "health") {
			result.action = "status";
		} else if (arg === "set-default" || arg === "default") {
			result.action = "set-default";
			if (args[i + 1] && !args[i + 1].startsWith("-")) {
				result.model = args[++i];
			}
		}
	}
	return result;
}

export default async function localModelsCommand(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const action = parsed.action ?? "list";

	console.log(chalk.cyan("Detecting local LLM providers...\n"));
	const providers = await detectLocalProviders();

	if (providers.length === 0) {
		console.log(chalk.yellow("No local providers detected.\n"));
		console.log(chalk.dim("Start one of:"));
		console.log(chalk.dim("  • Ollama:     ollama serve"));
		console.log(chalk.dim("  • LM Studio:  Start the LM Studio application"));
		console.log(chalk.dim("\nOr set custom URLs:"));
		console.log(chalk.dim("  OLLAMA_HOST=http://localhost:11434"));
		console.log(chalk.dim("  LMSTUDIO_HOST=http://localhost:1234"));
		return;
	}

	if (action === "status") {
		console.log(chalk.bold("Provider Health Status:\n"));
		const health = await checkProviderHealth();
		for (const h of health) {
			const icon = h.healthy ? chalk.green("●") : chalk.red("●");
			const latency = chalk.dim(`${h.latencyMs}ms`);
			console.log(`  ${icon} ${chalk.bold(h.provider)} — ${h.modelCount} model(s) ${latency}`);
			if (h.error) {
				console.log(chalk.red(`    Error: ${h.error}`));
			}
		}
		return;
	}

	if (action === "set-default") {
		if (!parsed.model) {
			console.log(chalk.red("Usage: pakalon local-models set-default <model-id>"));
			console.log(chalk.dim("Example: pakalon local-models set-default ollama:llama3"));
			return;
		}
		// Verify model exists
		const allModels = providers.flatMap(p => p.models);
		const found = allModels.find(m => m.id === parsed.model);
		if (!found) {
			console.log(chalk.red(`Model "${parsed.model}" not found.`));
			console.log(chalk.dim("Available models:"));
			for (const m of allModels) {
				console.log(chalk.dim(`  ${m.id} — ${m.name}`));
			}
			return;
		}
		// Save to config
		const configPath = `${process.env.HOME || process.env.USERPROFILE}/.config/pakalon/selfhost.json`;
		const config = { defaultModel: parsed.model, defaultProvider: found.provider };
		await Bun.write(configPath, JSON.stringify(config, null, 2));
		console.log(chalk.green(`✓ Default model set to ${parsed.model}`));
		return;
	}

	// Default: list models
	console.log(chalk.bold("Local LLM Models:\n"));
	console.log(formatProviderStatus(providers));
	console.log(
		chalk.dim(
			`\nTotal: ${providers.reduce((s, p) => s + p.models.length, 0)} model(s) across ${providers.length} provider(s)`,
		),
	);
}
