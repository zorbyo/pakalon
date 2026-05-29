import React from "react";
import { Box, Text } from "ink";

export function Phase1QAProgress({ current, total }: { current: number; total: number }) {
  const safeTotal = Math.max(total, 1);
  const safeCurrent = Math.min(Math.max(current, 0), safeTotal);
  const pct = Math.round((safeCurrent / safeTotal) * 100);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="#ff8c00" bold>
        Phase 1 Q&A · {safeCurrent}/{safeTotal} · {pct}%
      </Text>
      <Text dimColor>{"█".repeat(Math.max(1, Math.round((safeCurrent / safeTotal) * 16))).padEnd(16, "░")}</Text>
    </Box>
  );
}
