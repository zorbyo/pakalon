/**
 * /local-models command - Manage local LLM providers (Ollama, LM Studio)
 *
 * Usage:
 *   /local-models - List all local models
 *   /local-models status - Check provider status
 *   /local-models set-default <model> - Set default local model
 */

import { detectLocalProviders, listAllLocalModels, checkProviderHealth } from "@/providers/local-models.js";
import type { CommandDefinition } from "./types.js";
import logger from "@/utils/logger.js";

export const localModelsCommandDefinition: CommandDefinition = {
  name: "local-models",
  description: "Manage local LLM providers (Ollama, LM Studio)",
  usage: "/local-models [status|set-default <model>]",
  category: "advanced",
  async execute(_context, args) {
    const subcommand = args[0] || "list";

    try {
      switch (subcommand) {
        case "status":
          return await showProviderStatus();
        case "set-default":
          return await setDefaultModel(args[1]);
        case "list":
        default:
          return await listModels();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[local-models] Error: ${message}`);
      return {
        success: false,
        message: `Error: ${message}`,
      };
    }
  },
};

async function listModels() {
  const models = await listAllLocalModels();

  if (models.length === 0) {
    return {
      success: true,
      message: [
        "No local models found.",
        "",
        "Start Ollama or LM Studio to use local models:",
        "  Ollama: ollama serve (default: http://localhost:11434)",
        "  LM Studio: Start the app (default: http://localhost:1234)",
        "",
        "Then pull or load a model and run /local-models again.",
      ].join("\n"),
    };
  }

  const ollamaModels = models.filter((m) => m.provider === "ollama");
  const lmstudioModels = models.filter((m) => m.provider === "lmstudio");

  const lines = ["Local Models", ""];

  if (ollamaModels.length > 0) {
    lines.push("Ollama");
    for (const model of ollamaModels) {
      const context = model.contextLength ? `${Math.round(model.contextLength / 1000)}K` : "N/A";
      const size = model.size || "";
      lines.push(`  ${model.id.padEnd(40)} ${context.padStart(8)} ${size}`);
    }
    lines.push("");
  }

  if (lmstudioModels.length > 0) {
    lines.push("LM Studio");
    for (const model of lmstudioModels) {
      const context = model.contextLength ? `${Math.round(model.contextLength / 1000)}K` : "N/A";
      lines.push(`  ${model.id.padEnd(40)} ${context.padStart(8)}`);
    }
    lines.push("");
  }

  lines.push(`Total: ${models.length} model(s)`);

  return {
    success: true,
    message: lines.join("\n"),
  };
}

async function showProviderStatus() {
  const providers = await detectLocalProviders();
  const lines = ["Provider Status", ""];

  const ollamaHealth = await checkProviderHealth("ollama");
  const lmstudioHealth = await checkProviderHealth("lmstudio");

  lines.push(`Ollama:      ${ollamaHealth.healthy ? "✓ Running" : "✗ Not running"} (${ollamaHealth.latency}ms)`);
  lines.push(`LM Studio:   ${lmstudioHealth.healthy ? "✓ Running" : "✗ Not running"} (${lmstudioHealth.latency}ms)`);
  lines.push("");
  lines.push(`Available providers: ${providers.length > 0 ? providers.join(", ") : "none"}`);

  return {
    success: true,
    message: lines.join("\n"),
  };
}

async function setDefaultModel(modelId: string | undefined) {
  if (!modelId) {
    return {
      success: false,
      message: "Usage: /local-models set-default <model-id>\n\nExample: /local-models set-default ollama:llama3",
    };
  }

  // Store in local config
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  const configPath = path.join(os.homedir(), ".config", "pakalon", "local-models.json");
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  config.defaultModel = modelId;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  return {
    success: true,
    message: `Default local model set to: ${modelId}`,
  };
}
