import React, { useCallback, useRef, useState } from 'react';
import type { Key } from 'ink';
import { Box, Text, color, useInput, useTheme } from '../ink.js';
import { showTokenAllocationPrompt } from '../ai/token-allocation.js';

type TokenAllocationMode = 'new_project' | 'existing_project' | 'custom';

type TokenAllocationResult = {
  percentage: number;
  mode: TokenAllocationMode;
};

type Props = {
  onComplete: (result: TokenAllocationResult | null) => void;
};

const BUFFER_PERCENTAGE = 10;
const CUSTOM_MIN = 10;
const CUSTOM_MAX = 95;
const HIGH_PERCENTAGE = 65;
const MEDIUM_PERCENTAGE = 35;
const BAR_WIDTH = 40;

const CLAMP = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function getPresetResult(mode: 'high' | 'medium'): TokenAllocationResult {
  if (mode === 'high') {
    return { percentage: HIGH_PERCENTAGE, mode: 'new_project' };
  }
  return { percentage: MEDIUM_PERCENTAGE, mode: 'existing_project' };
}

function formatCustomValue(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return MEDIUM_PERCENTAGE;
  }
  return CLAMP(parsed, CUSTOM_MIN, CUSTOM_MAX);
}

function renderBar(percentage: number): string {
  const filled = Math.round((CLAMP(percentage, 0, 100) / 100) * BAR_WIDTH);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

function createSummary(percentage: number): string {
  const free = Math.max(0, 100 - percentage - BUFFER_PERCENTAGE);
  return `Available: ${percentage}% | Buffer: ${BUFFER_PERCENTAGE}% | Free: ${free}%`;
}

export function TokenAllocationPrompt({ onComplete }: Props): React.ReactNode {
  const prompt = showTokenAllocationPrompt();
  const [theme] = useTheme();
  const accent = color('success', theme);
  const danger = color('warning', theme);

  const [cursor, setCursor] = useState(0);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customValue, setCustomValue] = useState(String(MEDIUM_PERCENTAGE));
  const [isDone, setIsDone] = useState(false);
  const settledRef = useRef(false);

  const finish = useCallback((result: TokenAllocationResult | null) => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    setIsDone(true);
    onComplete(result);
  }, [onComplete]);

  const selectedChoice = cursor === 0 ? 'high' : cursor === 1 ? 'medium' : 'custom';
  const selectedPercentage = selectedChoice === 'high'
    ? HIGH_PERCENTAGE
    : selectedChoice === 'medium'
      ? MEDIUM_PERCENTAGE
      : formatCustomValue(customValue);

  const handleConfirm = useCallback(() => {
    if (selectedChoice === 'custom') {
      if (isEditingCustom) {
        finish({ percentage: formatCustomValue(customValue), mode: 'custom' });
        return;
      }

      setIsEditingCustom(true);
      if (customValue.length === 0) {
        setCustomValue(String(MEDIUM_PERCENTAGE));
      }
      return;
    }

    finish(getPresetResult(selectedChoice));
  }, [customValue, finish, isEditingCustom, selectedChoice]);

  const handleCancel = useCallback(() => {
    finish(null);
  }, [finish]);

  useInput((input: string, key: Key) => {
    if (settledRef.current) {
      return;
    }

    if (key.escape) {
      handleCancel();
      return;
    }

    if (isEditingCustom) {
      if (key.return) {
        finish({ percentage: formatCustomValue(customValue), mode: 'custom' });
        return;
      }

      if (input === '\x7f' || input === '\b') {
        setCustomValue((current) => current.slice(0, -1));
        return;
      }

      if (/^\d$/.test(input)) {
        setCustomValue((current) => {
          const next = `${current}${input}`.replace(/^0+/, '');
          const parsed = Number.parseInt(next, 10);

          if (Number.isNaN(parsed)) {
            return input;
          }

          if (parsed > CUSTOM_MAX) {
            return current;
          }

          return next;
        });
      }

      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor((current) => (current === 0 ? 2 : current - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setCursor((current) => (current + 1) % 3);
      return;
    }

    if (key.return || input === ' ') {
      handleConfirm();
      return;
    }

    if (selectedChoice === 'custom' && /^\d$/.test(input)) {
      setIsEditingCustom(true);
      setCustomValue(input === '0' ? '' : input);
    }
  });

  if (isDone || settledRef.current) {
    return null;
  }

  const question = 'How much context window would you like to allocate?';
  const bar = renderBar(selectedPercentage);
  const summary = createSummary(selectedPercentage);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>
          {accent('Token allocation')}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text wrap="wrap">{question}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={cursor === 0 ? 'green' : undefined}>{cursor === 0 ? '(*) ' : '( ) '}</Text>
          <Text bold={cursor === 0}>{prompt.choices[0]?.label ?? `High (${HIGH_PERCENTAGE}%) - For new projects`}</Text>
        </Box>
        <Box>
          <Text color={cursor === 1 ? 'green' : undefined}>{cursor === 1 ? '(*) ' : '( ) '}</Text>
          <Text bold={cursor === 1}>{prompt.choices[1]?.label ?? `Medium (${MEDIUM_PERCENTAGE}%) - For existing projects`}</Text>
        </Box>
        <Box>
          <Text color={cursor === 2 ? 'green' : undefined}>{cursor === 2 ? '(*) ' : '( ) '}</Text>
          <Text bold={cursor === 2}>{prompt.choices[2]?.label ?? 'Custom (enter percentage)'}</Text>
        </Box>
      </Box>

      {cursor === 2 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>{prompt.choices[2]?.description ?? 'Free input'}</Text>
          <Box marginTop={1}>
            <Text color={selectedChoice === 'custom' ? 'green' : undefined}>Percentage: </Text>
            {isEditingCustom ? (
              <Box>
                <Text>{customValue}</Text>
                <Text color="green">█</Text>
              </Box>
            ) : (
              <Text bold>{selectedPercentage}%</Text>
            )}
            <Text dimColor> (10-95)</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text>{`[${bar}] ${selectedPercentage}%`}</Text>
        <Text dimColor>{`[ ${summary} ]`}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{`Buffer: ${BUFFER_PERCENTAGE}% kept in reserve`}</Text>
      </Box>

      <Box>
        <Text>
          {danger('↑/↓ select  Enter confirm  Esc cancel')}
        </Text>
      </Box>

      {cursor === 2 && !isEditingCustom ? (
        <Box marginTop={1}>
          <Text dimColor>Type a number to start custom entry.</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export default TokenAllocationPrompt;
