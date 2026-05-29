/**
 * ContextBar — prominent context-window progress bar shown under the header.
 *
 * Design: Golden separator line with progress indicator blocks
 * ───────────────────────────────────────────────────────────────
 * context window [████████░░░░░░░░] 45% used • 128k left
 * Model: claude-3-5-sonnet-20241022 • Effort: medium • Session: 12m ago
 */
import React, { useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { useModel, useSession } from "@/store/index.js";
import {
  PAKALON_GOLD,
  TEXT_DIM,
  TEXT_SECONDARY,
  STATUS_WARNING,
  STATUS_ERROR,
} from "@/constants/colors.js";
import { getShellWidth } from "@/utils/shell-layout.js";

interface ContextBarProps {
  projectDir?: string;
  activeFile?: string;
  tokenCount?: number;
  contextLimit?: number;
  /** Remaining context % from API (0-100). Takes precedence over local calculation. */
  remainingPct?: number;
  /** True while the AI is actively streaming a response */
  isStreaming?: boolean;
  /** Credits remaining in the current billing period (undefined = not loaded / free tier) */
  creditsRemaining?: number;
  /** Total credits allocated this period */
  creditsTotal?: number;
  /** Session lines added (shown to the right of the context bar) */
  linesAdded?: number;
  /** Session lines deleted (shown to the right of the context bar) */
  linesDeleted?: number;
  shellWidth?: number;
  /** Current effort level */
  effortLevel?: "low" | "medium" | "high";
  /** Current phase if in agent mode */
  currentPhase?: number;
}

function buildBarSegments(
  usedPct: number,
  width = 20,
): { filled: string; empty: string } {
  const clamped = Math.max(0, Math.min(100, usedPct));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return {
    filled: "█".repeat(filled),
    empty: "░".repeat(empty),
  };
}

/** Format a token count to a compact string: 1234 → "1.2k", 100000 → "100k" */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// Memoize the bar segments calculation to avoid recalculating on every render
const barWidthCache = new Map<number, { filled: string; empty: string }>();

function getBarSegments(
  usedPct: number,
  width: number,
): { filled: string; empty: string } {
  const cacheKey = usedPct * 1000 + width; // Combine into single number key
  if (barWidthCache.has(cacheKey)) {
    return barWidthCache.get(cacheKey)!;
  }
  const result = buildBarSegments(usedPct, width);
  barWidthCache.set(cacheKey, result);
  return result;
}

// Clear cache when terminal width changes significantly
const terminalWidthCache = { lastWidth: 0 };

const ContextBar = React.memo(function ContextBar({
  tokenCount,
  contextLimit,
  remainingPct,
  shellWidth,
  effortLevel,
  currentPhase,
  projectDir,
  isStreaming,
}: ContextBarProps) {
  const { selectedModel, availableModels } = useModel();
  const {
    remainingPct: sessionRemainingPct,
    runtimeTokensUsed,
    sessionStartedAt,
  } = useSession();

  const terminalWidth = process.stdout.columns ?? 120;
  const resolvedShellWidth = shellWidth ?? getShellWidth(terminalWidth);
  const modelInfo = availableModels.find((model) => model.id === selectedModel);
  const modelContextLimit = modelInfo?.contextLength;
  const modelName = modelInfo?.name || selectedModel || "Unknown";
  const effectiveRemainingPct =
    remainingPct ?? sessionRemainingPct ?? undefined;
  const effectiveContextLimit = contextLimit ?? modelContextLimit;
  const estimatedTokenCount =
    tokenCount !== undefined
      ? tokenCount
      : runtimeTokensUsed > 0
        ? runtimeTokensUsed
        : undefined;
  const hasTokenCount =
    estimatedTokenCount !== undefined && estimatedTokenCount !== null;
  const derivedTokenCountFromPct =
    !hasTokenCount &&
    effectiveContextLimit &&
    effectiveRemainingPct !== undefined
      ? Math.round(
          (Math.max(0, Math.min(100, 100 - effectiveRemainingPct)) / 100) *
            effectiveContextLimit,
        )
      : undefined;
  const displayTokenCount = Math.max(
    0,
    Math.round(estimatedTokenCount ?? derivedTokenCountFromPct ?? 0),
  );

  // Calculate session duration
  const sessionDuration = sessionStartedAt
    ? Math.floor((Date.now() - sessionStartedAt) / 60000)
    : 0;
  const sessionDurationText =
    sessionDuration > 0
      ? sessionDuration < 60
        ? `${sessionDuration}m`
        : `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m`
      : "Just started";

  // Get effort indicator
  const effortIndicator =
    effortLevel === "high" ? "***" : effortLevel === "medium" ? "**[o]" : "*[o][o]";
  const effortColor =
    effortLevel === "high"
      ? STATUS_ERROR
      : effortLevel === "medium"
        ? STATUS_WARNING
        : PAKALON_GOLD;

  // Compute used% from the displayed token count (backend/session token source).
  const usedPct: number =
    hasTokenCount && effectiveContextLimit
      ? Math.min(
          100,
          Math.round((displayTokenCount / effectiveContextLimit) * 100),
        )
      : effectiveRemainingPct !== undefined
        ? Math.max(0, Math.min(100, 100 - effectiveRemainingPct))
        : 0;

  // Bar color based on usage - golden at low, warning at medium, error at high
  const barColor =
    usedPct >= 80
      ? STATUS_ERROR
      : usedPct >= 60
        ? STATUS_WARNING
        : PAKALON_GOLD;

  const barWidth = terminalWidth < 60 ? 16 : terminalWidth < 90 ? 22 : 28;
  const bar = buildBarSegments(usedPct, barWidth);
  const tokenLabel = fmtTokens(displayTokenCount);
  const limitLabel = effectiveContextLimit
    ? fmtTokens(effectiveContextLimit)
    : "0";
  const leftLabel = fmtTokens(
    Math.max(0, (effectiveContextLimit ?? 0) - displayTokenCount),
  );
  const contentWidth: number | "100%" =
    shellWidth !== undefined ? "100%" : resolvedShellWidth;
  const containerJustify = "center";

  return (
    <Box width="100%" justifyContent={containerJustify} marginBottom={0}>
      <Box width={contentWidth} justifyContent="center" alignItems="center">
        <Box gap={1} flexWrap="wrap" justifyContent="center" minWidth={0}>
          {/* Model info */}
          <Text color={TEXT_SECONDARY}>Model:</Text>
          <Text color={PAKALON_GOLD}>{modelName.split(" ")[0]}</Text>
          <Text color={TEXT_DIM}>•</Text>

          {/* Context bar */}
          <Text color={TEXT_SECONDARY}>Context</Text>
          <Text color={TEXT_DIM}>[</Text>
          <Text color={barColor}>{bar.filled}</Text>
          <Text color={TEXT_DIM}>{bar.empty}]</Text>
          <Text color={barColor} bold>
            {usedPct}%
          </Text>
          <Text color={TEXT_SECONDARY}>
            <Text color={PAKALON_GOLD}>
              {tokenLabel}/{limitLabel}
            </Text>
          </Text>
          <Text color={TEXT_SECONDARY}>left</Text>
          <Text color={TEXT_DIM}>•</Text>

          {/* Effort level */}
          <Text color={TEXT_SECONDARY}>Effort:</Text>
          <Text color={effortColor}>{effortIndicator}</Text>
          <Text color={TEXT_DIM}>•</Text>

          {/* Session duration */}
          <Text color={TEXT_SECONDARY}>Session:</Text>
          <Text color={TEXT_DIM}>{sessionDurationText}</Text>

          {/* Phase indicator (if in agent mode) */}
          {currentPhase && (
            <>
              <Text color={TEXT_DIM}>•</Text>
              <Text color={TEXT_SECONDARY}>Phase:</Text>
              <Text color={PAKALON_GOLD}>{currentPhase}/6</Text>
            </>
          )}

          {/* Streaming indicator */}
          {isStreaming && (
            <>
              <Text color={TEXT_DIM}>•</Text>
              <Text color={STATUS_WARNING}>* Streaming</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
});

export default ContextBar;
