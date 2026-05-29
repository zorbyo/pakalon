/**
 * TokenAllocationPanel — UI for user-defined context budget allocation.
 * 
 * Allows users to set:
 * - Buffer percentage (default 10%)
 * - Phase-specific allocations
 * - Auto-compaction threshold
 * 
 * This addresses the MISSING requirement for user-defined token percentage UI.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface TokenAllocationConfig {
  bufferPercent: number;
  phase1Percent: number;
  phase2Percent: number;
  phase3Percent: number;
  phase4Percent: number;
  phase5Percent: number;
  phase6Percent: number;
  autoCompactThreshold: number;
}

export interface TokenAllocationPanelProps {
  currentConfig: TokenAllocationConfig;
  contextWindowSize: number;
  onSave: (config: TokenAllocationConfig) => void;
  onCancel: () => void;
}

const DEFAULT_CONFIG: TokenAllocationConfig = {
  bufferPercent: 10,
  phase1Percent: 10,
  phase2Percent: 15,
  phase3Percent: 40,
  phase4Percent: 15,
  phase5Percent: 5,
  phase6Percent: 5,
  autoCompactThreshold: 85,
};

const PHASE_NAMES = ['', 'Planning', 'Wireframes', 'Development', 'Security', 'Deployment', 'Documentation'];

type EditField = keyof TokenAllocationConfig | null;

const TokenAllocationPanel: React.FC<TokenAllocationPanelProps> = ({
  currentConfig,
  contextWindowSize,
  onSave,
  onCancel,
}) => {
  const [config, setConfig] = useState<TokenAllocationConfig>(currentConfig);
  const [editingField, setEditingField] = useState<EditField>(null);
  const [inputBuffer, setInputBuffer] = useState("");
  const [cursor, setCursor] = useState(0);

  const fields: Array<{ key: keyof TokenAllocationConfig; label: string; suffix?: string }> = [
    { key: "bufferPercent", label: "Buffer %", suffix: "%" },
    { key: "phase1Percent", label: "Phase 1 (Planning)", suffix: "%" },
    { key: "phase2Percent", label: "Phase 2 (Wireframes)", suffix: "%" },
    { key: "phase3Percent", label: "Phase 3 (Development)", suffix: "%" },
    { key: "phase4Percent", label: "Phase 4 (Security)", suffix: "%" },
    { key: "phase5Percent", label: "Phase 5 (Deployment)", suffix: "%" },
    { key: "phase6Percent", label: "Phase 6 (Docs)", suffix: "%" },
    { key: "autoCompactThreshold", label: "Auto-compact at", suffix: "%" },
  ];

  const totalPercent = config.phase1Percent + config.phase2Percent + config.phase3Percent +
    config.phase4Percent + config.phase5Percent + config.phase6Percent + config.bufferPercent;

  const handleInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
      if (editingField !== null) {
        if (key.escape) {
          setEditingField(null);
          setInputBuffer("");
          return;
        }
        if (key.return) {
          const num = parseInt(inputBuffer, 10);
          if (!isNaN(num) && num >= 0 && num <= 100) {
            setConfig(prev => ({ ...prev, [editingField]: num }));
          }
          setEditingField(null);
          setInputBuffer("");
          return;
        }
        if (input === "\x7f" || input === "\b") {
          setInputBuffer(prev => prev.slice(0, -1));
          return;
        }
        if (/^\d$/.test(input)) {
          setInputBuffer(prev => prev + input);
        }
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.upArrow || input === "k") {
        setCursor(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || input === "j") {
        setCursor(prev => Math.min(fields.length - 1, prev + 1));
      } else if (key.return || input === " ") {
        const field = fields[cursor];
        if (field) {
          setEditingField(field.key);
          setInputBuffer(String(config[field.key]));
        }
      }
    },
    [editingField, inputBuffer, config, fields, cursor, onCancel]
  );

  useInput(handleInput);

  const handleSave = useCallback(() => {
    if (totalPercent !== 100) {
      return;
    }
    onSave(config);
  }, [config, totalPercent, onSave]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="#ff8c00">
      <Box marginBottom={1}>
        <Text bold color="#ff8c00">Context Budget Allocation</Text>
      </Box>

      <Text dimColor color="gray" marginBottom={1}>
        Use ↑/↓ to navigate, Enter to edit, Esc to cancel
      </Text>

      {fields.map((field, index) => {
        const isSelected = index === cursor;
        const isEditing = editingField === field.key;
        const value = config[field.key];
        const suffix = field.suffix ?? "";

        return (
          <Box key={field.key} flexDirection="row" marginBottom={0}>
            <Text color={isSelected ? "#ff8c00" : undefined}>
              {isSelected ? "> " : "  "}
            </Text>
            <Text color={isSelected ? "#ff8c00" : undefined} width={25}>
              {field.label}
            </Text>
            {isEditing ? (
              <Box>
                <Text color="green">&gt; </Text>
                <Text>{inputBuffer}</Text>
                <Text color="green">█</Text>
              </Box>
            ) : (
              <Text bold>{value}{suffix}</Text>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Total allocation: {totalPercent}% {totalPercent !== 100 ? "(must equal 100%)" : "[OK]"}</Text>
        <Text dimColor>Context window: {contextWindowSize.toLocaleString()} tokens</Text>
        {Object.entries(config).map(([key, value]) => {
          if (key === "autoCompactThreshold" || key === "bufferPercent") return null;
          if (!key.endsWith("Percent")) return null;
          const tokens = Math.floor(contextWindowSize * (value / 100));
          return (
            <Text key={key} dimColor>
              {PHASE_NAMES[parseInt(key.replace("Percent", ""))] ?? key}: {tokens.toLocaleString()} tokens
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="row" gap={2}>
        <Text dimColor>Enter: save </Text>
        <Text dimColor>Esc: cancel</Text>
      </Box>

      {totalPercent === 100 && (
        <Box marginTop={1}>
          <Text color="green" bold onPress={handleSave}>
            [OK] Press Enter to save
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default TokenAllocationPanel;

export function getDefaultAllocationConfig(): TokenAllocationConfig {
  return { ...DEFAULT_CONFIG };
}

export function validateAllocationConfig(config: TokenAllocationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (config.bufferPercent < 0 || config.bufferPercent > 50) {
    errors.push("Buffer must be between 0% and 50%");
  }
  
  const total = config.phase1Percent + config.phase2Percent + config.phase3Percent +
    config.phase4Percent + config.phase5Percent + config.phase6Percent + config.bufferPercent;
  
  if (total !== 100) {
    errors.push(`Percentages must sum to 100% (currently ${total}%)`);
  }
  
  if (config.autoCompactThreshold < 50 || config.autoCompactThreshold > 99) {
    errors.push("Auto-compact threshold must be between 50% and 99%");
  }
  
  return { valid: errors.length === 0, errors };
}