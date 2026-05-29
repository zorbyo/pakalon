/**
 * /models command — inline (non-TUI) model listing and selection.
 * See ModelsScreen.tsx for the interactive TUI variant.
 * T-CLI-02: shows remaining_pct from API per model.
 */
import { getApiClient } from "@/api/client.js";
import { useStore } from "@/store/index.js";
import { debugLog } from "@/utils/logger.js";
import { isSelfHosted } from "@/config/mode.js";
import { discoverAllLocalModels, pickBestLocalModel } from "@/ai/local/discovery.js";
import { loadLocalModelRegistry, saveLocalSetting } from "@/db/local.js";
import { refreshModelsNow } from "@/ai/model-refresh.js";
import axios from "axios";
import type { CommandDefinition } from "./types.js";

interface ModelItem {
  id?: string;
  model_id?: string;
  name: string;
  context_length?: number;
  context_window?: number;
  tier?: string;
  pricing_tier?: string;
  remaining_pct?: number;
}

function normalizeModel(model: ModelItem) {
  const tier: "free" | "paid" = (model.tier ?? (model.pricing_tier === "free" ? "free" : "paid")) === "free"
    ? "free"
    : "paid";
  return {
    id: model.id ?? model.model_id ?? "",
    name: model.name,
    contextLength: model.context_length ?? model.context_window ?? 0,
    tier,
    remainingPct: model.remaining_pct,
  };
}

type NormalizedModel = ReturnType<typeof normalizeModel>;

function formatContextLength(contextLength: number): string {
  return contextLength >= 1000 ? `${Math.round(contextLength / 1000)}K` : `${contextLength}`;
}

function formatModelList(models: NormalizedModel[]): string {
  if (models.length === 0) {
    return "No models available. Try again shortly - model cache may still be refreshing.";
  }

  const free = models.filter((model) => model.tier === "free");
  const paid = models.filter((model) => model.tier !== "free");
  const lines: string[] = ["Available models", ""];

  if (free.length > 0) {
    lines.push("Free");
    for (const model of free) {
      const remaining = model.remainingPct !== undefined ? ` (${model.remainingPct}% remaining)` : "";
      lines.push(`  ${model.id.padEnd(50)} ${formatContextLength(model.contextLength).padStart(8)}${remaining}`);
    }
    lines.push("");
  }

  if (paid.length > 0) {
    lines.push("Pro");
    for (const model of paid) {
      const remaining = model.remainingPct !== undefined ? ` (${model.remainingPct}% remaining)` : "";
      lines.push(`  ${model.id.padEnd(50)} ${formatContextLength(model.contextLength).padStart(8)}${remaining}`);
    }
    lines.push("");
  }

  lines.push(`Total: ${free.length} free, ${paid.length} pro`);
  return lines.join("\n");
}

async function listModelsForCommand(): Promise<string> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();
    if (models.length === 0) {
      return [
        "No local models found.",
        "Start Ollama or LM Studio, then pull or load a model and run /models again.",
        "Ollama: http://localhost:11434",
        "LM Studio: http://localhost:1234",
      ].join("\n");
    }

    return [
      "Local models",
      "",
      ...models.map((model) => {
        const provider = model.provider === "ollama" ? "Ollama" : "LM Studio";
        const context = formatContextLength(model.contextWindow);
        return `  ${provider.padEnd(10)} ${model.id.padEnd(42)} ${context.padStart(8)} ${model.parameters ?? ""}`.trimEnd();
      }),
      "",
      `Total: ${models.length} local model(s)`,
    ].join("\n");
  }

  const api = getApiClient();
  const res = await api.get<{ models: ModelItem[] }>("/models?include_all=true");
  const models = (res.data.models ?? []).map(normalizeModel).filter((model) => Boolean(model.id));
  return formatModelList(models);
}

async function setModelForCommand(modelId: string): Promise<string> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();
    const found = models.find((model) => model.id === modelId || model.name === modelId);
    if (!found) throw new Error(`Local model "${modelId}" was not found. Run /models to see available local models.`);

    useStore.getState().setSelectedModel(found.id);
    saveLocalSetting("selected_model", found.id);
    return `Local model set to: ${found.id}`;
  }

  const api = getApiClient();
  const res = await api.get<{ models: ModelItem[] }>("/models?include_all=true");
  const models = (res.data.models ?? []).map(normalizeModel).filter((model) => Boolean(model.id));
  const found = models.find((model) => model.id === modelId);
  if (!found) throw new Error(`Model "${modelId}" was not found. Run /models to see available models.`);

  useStore.getState().setSelectedModel(modelId);
  return `Model set to: ${modelId}`;
}

async function autoSelectModelForCommand(): Promise<string> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();
    const selected = pickBestLocalModel(models);
    if (!selected) {
      throw new Error("No local models available. Start Ollama or LM Studio and load a model first.");
    }

    useStore.getState().setSelectedModel(selected.id);
    useStore.getState().setAutoModel({
      id: selected.id,
      name: selected.name,
      contextLength: selected.contextWindow,
      tier: "free",
      provider: selected.provider,
    });
    saveLocalSetting("selected_model", selected.id);
    return `Auto-selected local model: ${selected.id}`;
  }

  const api = getApiClient();
  const res = await api.get<ModelItem>("/models/auto");
  const normalized = normalizeModel(res.data);
  useStore.getState().setAutoModel(normalized);
  useStore.getState().setSelectedModel(normalized.id);
  return `Auto-selected model: ${normalized.id}`;
}

/**
 * Backward-compatible utility used by tests and scripts.
 * Fetches the public OpenRouter model catalog directly.
 */
export async function fetchModels(): Promise<Array<{ id: string; name: string; context_length?: number }>> {
  const client = (axios as unknown as { default?: { get?: typeof axios.get }; get?: typeof axios.get });
  const get = client.get ?? client.default?.get;
  if (!get) return [];

  const res = await get<{ data?: Array<{ id: string; name: string; context_length?: number }>; models?: Array<{ id: string; name: string; context_length?: number }> }>(
    "https://openrouter.ai/api/v1/models",
    {
      headers: { Accept: "application/json" },
      timeout: 20_000,
    },
  );

  const payload = res.data as {
    data?: Array<{ id: string; name: string; context_length?: number }>;
    models?: Array<{ id: string; name: string; context_length?: number }>;
  };

  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  return [];
}

export async function cmdListModels(): Promise<void> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();

    console.log("\n── Local Models (Self-Hosted) ────────────────────────────────\n");
    if (models.length === 0) {
      console.log("No local models found.");
      console.log("Start Ollama or LM Studio, then pull/load a model and run this again.");
      console.log("  Ollama:    http://localhost:11434");
      console.log("  LM Studio: http://localhost:1234\n");
      return;
    }

    console.log(
      "  Provider".padEnd(14) +
      "Model".padEnd(42) +
      "Context".padEnd(12) +
      "Params",
    );
    console.log("  " + "─".repeat(82));
    for (const model of models) {
      const provider = model.provider === "ollama" ? "Ollama" : "LM Studio";
      const context = model.contextWindow >= 1000
        ? `${Math.round(model.contextWindow / 1000)}K`
        : `${model.contextWindow}`;
      console.log(
        `  ${provider.padEnd(12)}${model.id.padEnd(42)}${context.padEnd(12)}${model.parameters ?? "?"}`,
      );
    }

    console.log(`\nTotal: ${models.length} local model(s). Use \`pakalon model set <id>\` to select one.\n`);
    return;
  }

  try {
    const api = getApiClient();
    const res = await api.get<{ models: ModelItem[] }>("/models?include_all=true");
    const models = (res.data.models ?? []).map(normalizeModel).filter((model) => Boolean(model.id));

    if (models.length === 0) {
      console.log("No models available. Try again shortly — model cache may be refreshing.");
      return;
    }

    const free = models.filter((m) => m.tier === "free");
    const paid = models.filter((m) => m.tier !== "free");

    const ctx = (n: number) =>
      n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

    console.log("\n── Free Models ────────────────────────────────────────────────");
    for (const m of free) {
      const remaining =
        m.remainingPct !== undefined ? ` [${m.remainingPct}% remaining]` : "";
      console.log(`  ${m.id.padEnd(50)} ${ctx(m.contextLength).padStart(8)}${remaining}`);
    }

    if (paid.length > 0) {
      console.log("\n── Pro Models ─────────────────────────────────────────────────");
      for (const m of paid) {
        const remaining =
          m.remainingPct !== undefined ? ` [${m.remainingPct}% remaining]` : "";
        console.log(`  ${m.id.padEnd(50)} ${ctx(m.contextLength).padStart(8)}${remaining}  [PRO]`);
      }
    }

    console.log(`\nTotal: ${free.length} free, ${paid.length} pro\n`);
  } catch (err) {
    debugLog(`[models] Error listing models: ${String(err)}`);
    console.error("Failed to fetch models:", String(err));
    process.exit(1);
  }
}

export async function cmdSetModel(modelId: string): Promise<void> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();
    const found = models.find((model) => model.id === modelId || model.name === modelId);

    if (!found) {
      console.error(`Local model "${modelId}" not found. Run \`pakalon model list\` to see available local models.`);
      process.exit(1);
    }

    useStore.getState().setSelectedModel(found.id);
    saveLocalSetting("selected_model", found.id);
    console.log(`[OK] Local model set to: ${found.id}`);
    debugLog(`[models] Local model set to ${found.id}`);
    return;
  }

  try {
    const api = getApiClient();
    const res = await api.get<{ models: ModelItem[] }>("/models?include_all=true");
    const models = (res.data.models ?? []).map(normalizeModel).filter((model) => Boolean(model.id));
    const found = models.find((m) => m.id === modelId);

    if (!found) {
      console.error(`Model "${modelId}" not found. Run \`pakalon model list\` to see available models.`);
      process.exit(1);
    }

    useStore.getState().setSelectedModel(modelId);
    console.log(`[OK] Model set to: ${modelId}`);
    debugLog(`[models] Model set to ${modelId}`);
  } catch (err) {
    console.error("Failed to set model:", String(err));
    process.exit(1);
  }
}

export async function cmdAutoModel(): Promise<void> {
  if (isSelfHosted()) {
    const discovered = await discoverAllLocalModels();
    const models = discovered.length > 0 ? discovered : loadLocalModelRegistry();
    const selected = pickBestLocalModel(models);
    if (!selected) {
      console.error("No local models available. Start Ollama or LM Studio and load a model first.");
      process.exit(1);
    }
    useStore.getState().setSelectedModel(selected.id);
    useStore.getState().setAutoModel({
      id: selected.id,
      name: selected.name,
      contextLength: selected.contextWindow,
      tier: "free",
      provider: selected.provider,
    });
    saveLocalSetting("selected_model", selected.id);
    console.log(`[OK] Auto-selected local model: ${selected.id}`);
    return;
  }

  try {
    const api = getApiClient();
    const res = await api.get<{ id?: string; model_id?: string; name: string; context_length?: number; context_window?: number; tier?: string; pricing_tier?: string }>("/models/auto");
    const result = res.data;
    const normalized = normalizeModel(result);
    useStore.getState().setAutoModel(normalized);
    console.log(`[OK] Auto-selected model: ${normalized.id}`);
  } catch (err) {
    console.error("Failed to auto-select model:", String(err));
    process.exit(1);
  }
}

export async function cmdRefreshModels(): Promise<void> {
  if (isSelfHosted()) {
    console.log("Model refresh is not available in self-hosted mode.");
    return;
  }

  try {
    console.log("Refreshing models from OpenRouter...");
    const models = await refreshModelsNow();
    const free = models.filter((m) => m.tier === "free");
    const pro = models.filter((m) => m.tier !== "free");
    console.log(`[OK] Refreshed ${models.length} models (${free.length} free, ${pro.length} pro)`);
    debugLog(`[models] Manual refresh: ${models.length} models (${free.length} free, ${pro.length} pro)`);
  } catch (err) {
    console.error("Failed to refresh models:", String(err));
    process.exit(1);
  }
}

export const modelsCommand: CommandDefinition = {
  name: "models",
  aliases: ["model"],
  description: "List, select, refresh, or auto-select available models",
  usage: "/models [list|auto|refresh|<model-id>]",
  category: "model",
  async execute(_context, args) {
    const action = args[0]?.trim();

    try {
      if (!action || action === "list") {
        return { success: true, message: await listModelsForCommand() };
      }

      if (action === "auto") {
        return { success: true, message: await autoSelectModelForCommand() };
      }

      if (action === "refresh" || action === "reload") {
        if (isSelfHosted()) {
          return { success: true, message: "Model refresh is not available in self-hosted mode." };
        }
        const models = await refreshModelsNow();
        const free = models.filter((model) => model.tier === "free").length;
        const pro = models.length - free;
        return { success: true, message: `Refreshed ${models.length} models (${free} free, ${pro} pro).` };
      }

      return { success: true, message: await setModelForCommand(args.join(" ").trim()) };
    } catch (error) {
      return {
        success: false,
        message: `Model command failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
