/**
 * ModelsScreen.tsx — Full interactive TUI for /models command.
 * Ink SelectInput-based browsable model list with sorting, plan badges,
 * and effort level selection after model choice.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { getApiClient } from "@/api/client.js";
import { useStore } from "@/store/index.js";
import { debugLog } from "@/utils/logger.js";
import { getSupportedEffortProvider } from "@/utils/model-effort.js";
import type { ModelEffortConfig } from "@/store/slices/mode.slice.js";
import type { ModelInfo } from "@/store/slices/model.slice.js";
import { isSelfHosted } from "@/config/mode.js";

interface ModelItem {
  id?: string;
  model_id?: string;
  name: string;
  context_length?: number;
  context_window?: number;
  tier?: "free" | "paid" | string;
  pricing_tier?: "free" | "pro" | string;
  remaining_pct?: number;
  provider?: string;
  supported_parameters?: string[];
  supportedParameters?: string[];
  reasoning?: boolean;
  supportsReasoning?: boolean;
}

function normalizeModel(model: ModelItem): ModelItem {
  return {
    ...model,
    id: model.id ?? model.model_id ?? "",
    context_length: model.context_length ?? model.context_window ?? 0,
    tier: model.tier ?? (model.pricing_tier === "free" ? "free" : "paid"),
    supportedParameters:
      model.supportedParameters ?? model.supported_parameters,
  };
}

function fromStoreModel(model: ModelInfo): ModelItem {
  return {
    id: model.id,
    model_id: model.id,
    name: model.name,
    context_length: model.contextLength,
    tier: model.tier,
    provider: model.provider,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    supportsReasoning: model.supportsReasoning,
  };
}

type SortKey = "name" | "tier";

function tierBadge(tier: string): string {
  if (isSelfHosted()) return "[LOCAL]";
  return tier === "free" ? "[FREE]" : "[PRO]";
}

interface EffortOption {
  label: string;
  value: string;
  config: ModelEffortConfig;
}

function getEffortProviderForModel(
  model: ModelItem,
): "openai" | "anthropic" | "gemini" | null {
  return getSupportedEffortProvider({
    id: model.id ?? model.model_id ?? "",
    provider: model.provider,
    supportedParameters:
      model.supportedParameters ?? model.supported_parameters,
    reasoning: model.reasoning,
    supportsReasoning: model.supportsReasoning,
  });
}

function getEffortOptionsForModel(model: ModelItem): EffortOption[] {
  switch (getEffortProviderForModel(model)) {
    case "openai":
      return [
        {
          label: "Low",
          value: "low",
          config: { provider: "openai", effort: "low" },
        },
        {
          label: "Medium",
          value: "medium",
          config: { provider: "openai", effort: "medium" },
        },
        {
          label: "High",
          value: "high",
          config: { provider: "openai", effort: "high" },
        },
        {
          label: "Extra High",
          value: "extra-high",
          config: { provider: "openai", effort: "extra-high" },
        },
      ];
    case "gemini":
      return [
        {
          label: "Low",
          value: "low",
          config: { provider: "gemini", effort: "low" },
        },
        {
          label: "Medium",
          value: "medium",
          config: { provider: "gemini", effort: "medium" },
        },
        {
          label: "High",
          value: "high",
          config: { provider: "gemini", effort: "high" },
        },
      ];
    case "anthropic":
      return [
        {
          label: "Thinking",
          value: "thinking",
          config: { provider: "anthropic", mode: "thinking" },
        },
        {
          label: "Default",
          value: "default",
          config: { provider: "anthropic", mode: "default" },
        },
      ];
    default:
      return [];
  }
}

interface ModelRowProps {
  model: ModelItem;
  isSelected: boolean;
  index: number;
}

const ModelRow: React.FC<ModelRowProps> = ({ model, isSelected }) => {
  const prefix = isSelected ? "-> " : "  ";
  const badge = tierBadge(model.tier ?? "paid");
  const badgeColor = model.tier === "free" ? "green" : "yellow";

  return (
    <Box flexDirection="row">
      <Text color={isSelected ? "white" : "gray"}>{prefix}</Text>
      <Text color={isSelected ? "white" : "white"} bold={isSelected}>
        {model.name.padEnd(42)}
      </Text>
      <Text color={isSelected ? badgeColor : "gray"}>{badge}</Text>
    </Box>
  );
};

interface ModelsScreenProps {
  onSelect?: (modelId: string) => void;
  onBack?: () => void;
}

const ModelsScreen: React.FC<ModelsScreenProps> = ({ onSelect, onBack }) => {
  const { exit } = useApp();
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const selectedModel = useStore((s) => s.selectedModel);
  const setModelEffortConfig = useStore((s) => s.setModelEffortConfig);
  const refreshModels = useStore((s) => s.refreshModels);
  const storeModels = useStore((s) => s.availableModels);
  const userPlan = useStore((s) => s.plan);
  const selfHostedMode = isSelfHosted();

  const [models, setModels] = useState<ModelItem[]>([]);
  const [filtered, setFiltered] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showEffortPicker, setShowEffortPicker] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [effortOptions, setEffortOptions] = useState<EffortOption[]>([]);
  const [effortIdx, setEffortIdx] = useState(0);
  const [totalModels, setTotalModels] = useState(0);

  useEffect(() => {
    if (storeModels.length === 0) return;
    setModels(storeModels.map(fromStoreModel));
  }, [storeModels]);

  useEffect(() => {
    let cancelled = false;
    const api = getApiClient();
    const loadModels = async () => {
      try {
        await refreshModels(process.env.PAKALON_API_URL, undefined, true);
        const refreshed = useStore.getState().availableModels;
        if (!cancelled && (refreshed.length > 0 || selfHostedMode)) {
          setModels(refreshed.map(fromStoreModel));
          return;
        }
      } catch {
        debugLog("ModelsScreen: store refresh failed, trying direct fetch");
      }

      try {
        const initial = await api.get<{ models: ModelItem[] }>(
          "/models?include_all=true",
        );
        const list = (initial.data.models ?? [])
          .map(normalizeModel)
          .filter((model) => Boolean(model.id));

        if (cancelled) return;
        setModels(list);
        return;
      } catch {
        debugLog(
          "ModelsScreen: backend fetch failed, trying OpenRouter directly",
        );
      }

      try {
        const axiosMod = await import("axios");
        const res = await axiosMod.default.get<{
          data?: Array<{
            id: string;
            name: string;
            context_length?: number;
            supported_parameters?: string[];
          }>;
        }>("https://openrouter.ai/api/v1/models", {
          headers: { Accept: "application/json" },
          timeout: 20_000,
        });
        const rawModels = res.data?.data ?? [];
        const list = rawModels
          .map(
            (m): ModelItem => ({
              id: m.id,
              name: m.name || m.id,
              context_length: m.context_length ?? 0,
              tier: m.id.includes(":free") ? "free" : "paid",
              supportedParameters: m.supported_parameters,
            }),
          )
          .filter((m) => Boolean(m.id));
        if (cancelled) return;
        setModels(list);
      } catch (err2) {
        if (!cancelled) {
          debugLog("ModelsScreen all fetches failed", err2);
          setError(String((err2 as { message?: string })?.message ?? err2));
        }
      }
    };

    loadModels().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshModels]);

  useEffect(() => {
    let list = [...models];

    const totalBeforeFilter = list.length;
    setTotalModels(totalBeforeFilter);
    if (!selfHostedMode && userPlan !== "pro" && userPlan !== "enterprise") {
      list = list.filter(
        (m) => m.tier === "free" || (m.id ?? "").includes(":free"),
      );
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.id ?? "").toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      if (a.id === "auto") return -1;
      if (b.id === "auto") return 1;
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "tier") {
        if (a.tier === b.tier) return a.name.localeCompare(b.name);
        return a.tier === "free" ? -1 : 1;
      }
      return 0;
    });

    setFiltered(list);

    const currentIndex = list.findIndex((model) => model.id === selectedModel);
    setSelectedIdx(currentIndex >= 0 ? currentIndex : 0);
  }, [models, query, selectedModel, selfHostedMode, sortKey, userPlan]);

  const handleModelSelect = useCallback(() => {
    const model = filtered[selectedIdx];
    if (!model || !model.id) return;

    const options = getEffortOptionsForModel(model);
    if (options.length === 0) {
      setSelectedModel(model.id);
      setModelEffortConfig(null);
      setStatusMsg(`[OK] Model set to: ${model.name}`);
      setConfirmed(true);
      if (onSelect) {
        onSelect(model.id);
      } else {
        setTimeout(() => exit(), 800);
      }
      return;
    }
    setPendingModelId(model.id);
    setEffortOptions(options);
    setEffortIdx(0);
    setShowEffortPicker(true);
  }, [
    exit,
    filtered,
    onSelect,
    selectedIdx,
    setModelEffortConfig,
    setSelectedModel,
  ]);

  const handleEffortConfirm = useCallback(() => {
    if (!pendingModelId) return;

    setSelectedModel(pendingModelId);
    const option = effortOptions[effortIdx];
    if (option) {
      setModelEffortConfig(option.config);
    }

    const modelName =
      filtered.find((m) => m.id === pendingModelId)?.name ?? pendingModelId;
    const effortLabel = option?.label ?? "default";
    setStatusMsg(`[OK] Model set to: ${modelName} (${effortLabel})`);
    setConfirmed(true);

    if (onSelect) {
      onSelect(pendingModelId);
    } else {
      setTimeout(() => exit(), 800);
    }
  }, [
    pendingModelId,
    effortOptions,
    effortIdx,
    setSelectedModel,
    setModelEffortConfig,
    filtered,
    onSelect,
    exit,
  ]);

  useInput((input, key) => {
    if (confirmed) return;

    if (showEffortPicker) {
      if (key.upArrow) {
        setEffortIdx((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setEffortIdx((i) => Math.min(effortOptions.length - 1, i + 1));
      } else if (key.return) {
        handleEffortConfirm();
      } else if (key.escape) {
        setShowEffortPicker(false);
        setPendingModelId(null);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (key.return) {
      handleModelSelect();
    } else if (key.escape || (key.ctrl && input === "c")) {
      if (onBack) onBack();
      else exit();
    } else if (input === "s") {
      setSortKey((k) => {
        const keys: SortKey[] = ["name", "tier"];
        return keys[(keys.indexOf(k) + 1) % keys.length]!;
      });
    } else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
    }
  });

  const VIEWPORT = 20;
  const viewStart = Math.max(
    0,
    Math.min(
      selectedIdx - Math.floor(VIEWPORT / 2),
      filtered.length - VIEWPORT,
    ),
  );
  const viewEnd = Math.min(filtered.length, viewStart + VIEWPORT);
  const visibleModels = filtered.slice(viewStart, viewEnd);

  if (loading) {
    return (
      <Box flexDirection="column">
        <Text color="white">⟳ Loading models...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">[X] Failed to load models: {error}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  if (confirmed && statusMsg) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="white" bold>
          {statusMsg}
        </Text>
      </Box>
    );
  }

  if (showEffortPicker && pendingModelId) {
    const modelName =
      filtered.find((m) => m.id === pendingModelId)?.name ?? pendingModelId;
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="white"
        paddingX={1}
        paddingY={0}
      >
        <Box flexDirection="row" marginBottom={0}>
          <Text bold color="white">
            EFFORT LEVEL
          </Text>
          <Text dimColor> for {modelName}</Text>
        </Box>
        <Box flexDirection="column">
          {effortOptions.map((option, i) => (
            <Box key={option.value} flexDirection="row">
              <Text color={i === effortIdx ? "white" : "gray"}>
                {i === effortIdx ? "-> " : "  "}
              </Text>
              <Text
                color={i === effortIdx ? "white" : "white"}
                bold={i === effortIdx}
              >
                {option.label}
              </Text>
            </Box>
          ))}
        </Box>
        <Box
          flexDirection="row"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginTop={0}
        >
          <Text dimColor>↑↓</Text>
          <Text> navigate </Text>
          <Text dimColor>Enter</Text>
          <Text> select </Text>
          <Text dimColor>Esc</Text>
          <Text> back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="white"
      paddingX={1}
      paddingY={0}
    >
      <Box flexDirection="row" marginBottom={0}>
        <Text bold color="white">
          MODELS
        </Text>
        <Text dimColor> Plan: </Text>
        <Text color={selfHostedMode ? "green" : userPlan === "pro" || userPlan === "enterprise" ? "yellow" : "green"} bold>
          {selfHostedMode
            ? "Self-hosted"
            : userPlan === "enterprise"
              ? "Enterprise"
              : userPlan === "pro"
                ? "Pro"
                : "Free"}
        </Text>
        <Text dimColor> • </Text>
        <Text dimColor>
          {filtered.length} of {totalModels} available
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>
          Sort: <Text color="white">{sortKey}</Text>
        </Text>
      </Box>

      <Box paddingX={1} marginBottom={0}>
        <Text dimColor>Search: </Text>
        <Text color="white">{query}</Text>
        <Text color="white">█</Text>
      </Box>

      <Box flexDirection="column">
        {visibleModels.map((model, i) => (
          <ModelRow
            key={model.id}
            model={model}
            isSelected={viewStart + i === selectedIdx}
            index={viewStart + i}
          />
        ))}
        {filtered.length === 0 && (
          <Box paddingX={2}>
            <Text dimColor>No models match your search.</Text>
          </Box>
        )}
      </Box>

      {filtered.length > VIEWPORT && (
        <Box paddingX={1}>
          <Text dimColor>
            {viewStart + 1}–{viewEnd} of {filtered.length}
          </Text>
        </Box>
      )}

      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginTop={0}
      >
        <Text dimColor>↑↓</Text>
        <Text> navigate </Text>
        <Text dimColor>Enter</Text>
        <Text> select </Text>
        <Text dimColor>s</Text>
        <Text> sort </Text>
        <Text dimColor>type</Text>
        <Text> search </Text>
        <Text dimColor>Esc</Text>
        <Text> back</Text>
      </Box>
    </Box>
  );
};

export default ModelsScreen;
