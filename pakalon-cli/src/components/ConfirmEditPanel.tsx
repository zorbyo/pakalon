import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ConfirmEditPanelProps {
  subAgentName: string;
  changesSummary: string;
  filesChanged: string[];
  mode: 'hil' | 'auto-accept' | 'yolo';
  onConfirm: () => void;
  onMakeChanges: () => void;
  onFeedback?: (message: string) => void;
}

type FileChangeType = 'added' | 'modified' | 'deleted';

interface ParsedFileChange {
  path: string;
  type: FileChangeType;
}

const CHANGE_COLORS: Record<FileChangeType, string> = {
  added: 'green',
  modified: 'yellow',
  deleted: 'red',
};

function parseFileChange(input: string): ParsedFileChange {
  const normalized = input.trim();
  const prefixMatch = normalized.match(/^(added|modified|deleted)[:\s]+(.+)$/i);
  if (prefixMatch) {
    return {
      type: prefixMatch[1]!.toLowerCase() as FileChangeType,
      path: prefixMatch[2]!.trim(),
    };
  }

  if (normalized.startsWith('+')) return { type: 'added', path: normalized.slice(1).trim() };
  if (normalized.startsWith('-')) return { type: 'deleted', path: normalized.slice(1).trim() };

  return { type: 'modified', path: normalized };
}

const ConfirmEditPanel: React.FC<ConfirmEditPanelProps> = ({
  subAgentName,
  changesSummary,
  filesChanged,
  mode,
  onConfirm,
  onMakeChanges,
  onFeedback,
}) => {
  const [countdown, setCountdown] = useState(3);
  const actionTakenRef = useRef(false);

  const parsedFiles = useMemo(() => filesChanged.map(parseFileChange), [filesChanged]);

  const confirmOnce = useCallback(() => {
    if (actionTakenRef.current) return;
    actionTakenRef.current = true;
    onConfirm();
  }, [onConfirm]);

  const makeChangesOnce = useCallback(() => {
    if (actionTakenRef.current) return;
    actionTakenRef.current = true;
    onMakeChanges();
  }, [onMakeChanges]);

  useEffect(() => {
    if (mode === 'yolo') {
      confirmOnce();
      return;
    }

    if (mode !== 'auto-accept') return;

    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer);
          confirmOnce();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [mode, confirmOnce]);

  useInput((input, key) => {
    if (key.return) {
      confirmOnce();
      return;
    }

    if (input === 'm' || input === 'M') {
      makeChangesOnce();
      return;
    }
  });

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="green">Phase 3 Complete</Text>
        <Text> </Text>
        <Text dimColor color="gray">— {subAgentName}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text>{changesSummary}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="gray">Files changed</Text>
        {parsedFiles.length > 0 ? (
          parsedFiles.map((file) => (
            <Box key={`${file.type}:${file.path}`}>
              <Text color={CHANGE_COLORS[file.type]}>[{file.type}]</Text>
              <Text> {file.path}</Text>
            </Box>
          ))
        ) : (
          <Text dimColor>No files reported</Text>
        )}
      </Box>

      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Box borderStyle="single" borderColor="green" paddingX={1}>
          <Text color="green" bold>
            Confirm Edit
          </Text>
        </Box>
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>
            Make Changes
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor color="gray">
          Enter: confirm  M: make changes
        </Text>
      </Box>

      {mode === 'auto-accept' && (
        <Box>
          <Text color="yellow">Auto-confirming in {countdown}s</Text>
        </Box>
      )}

      {mode === 'yolo' && (
        <Box>
          <Text color="green">Auto-confirming now</Text>
        </Box>
      )}

      {onFeedback && mode === 'hil' && (
        <Box marginTop={1}>
          <Text dimColor color="gray">Use the feedback flow to request edits.</Text>
        </Box>
      )}
    </Box>
  );
};

export default ConfirmEditPanel;
