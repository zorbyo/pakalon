/**
 * Overwrite Confirmation Dialog - HIL Permission Prompt
 * 
 * Prompts the user for confirmation when attempting to re-initialize
 * a project that already has a .pakalon folder structure.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface OverwriteConfirmationResult {
  confirmed: boolean;
  overwrite: boolean;
  useExisting: boolean;
  cancel: boolean;
}

export interface OverwriteConfirmationDialogProps {
  projectPath: string;
  existingFiles: string[];
  onConfirm: (result: OverwriteConfirmationResult) => void;
  onCancel?: () => void;
}

const OverwriteConfirmationDialog: React.FC<OverwriteConfirmationDialogProps> = ({
  projectPath,
  existingFiles,
  onConfirm,
  onCancel,
}) => {
  const [cursor, setCursor] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const choices = [
    {
      id: "overwrite",
      label: "Overwrite existing files",
      description: "Delete current .pakalon folder and start fresh",
      color: "red",
    },
    {
      id: "use_existing",
      label: "Use existing structure",
      description: "Continue with the existing .pakalon folder contents",
      color: "green",
    },
    {
      id: "cancel",
      label: "Cancel operation",
      description: "Don't initialize, return to chat",
      color: "gray",
    },
  ];

  const handleInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
      if (confirmed) return;

      if (key.escape) {
        onCancel?.();
        return;
      }

      if (key.upArrow || input === "k") {
        setCursor((prev) => (prev - 1 + choices.length) % choices.length);
        return;
      }

      if (key.downArrow || input === "j") {
        setCursor((prev) => (prev + 1) % choices.length);
        return;
      }

      if (key.return || input === " ") {
        setConfirmed(true);
        const selected = choices[cursor] ?? choices[0]!;

        if (selected.id === "overwrite") {
          onConfirm({ confirmed: true, overwrite: true, useExisting: false, cancel: false });
        } else if (selected.id === "use_existing") {
          onConfirm({ confirmed: true, overwrite: false, useExisting: true, cancel: false });
        } else {
          onConfirm({ confirmed: true, overwrite: false, useExisting: false, cancel: true });
          onCancel?.();
        }
      }

      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        setConfirmed(true);
        const selected = choices[num - 1] ?? choices[0]!;

        if (selected.id === "overwrite") {
          onConfirm({ confirmed: true, overwrite: true, useExisting: false, cancel: false });
        } else if (selected.id === "use_existing") {
          onConfirm({ confirmed: true, overwrite: false, useExisting: true, cancel: false });
        } else {
          onConfirm({ confirmed: true, overwrite: false, useExisting: false, cancel: true });
          onCancel?.();
        }
      }
    },
    [confirmed, choices, cursor, onConfirm, onCancel]
  );

  useInput(handleInput);

  if (confirmed) {
    const selected = choices[cursor] ?? choices[0]!;
    return (
      <Box flexDirection="column" marginY={1}>
        <Box borderStyle="single" borderColor={selected.color} paddingX={2} paddingY={1}>
          <Text bold color={selected.color}>
            [OK] {selected.label}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="#ff8c00">
      <Box paddingX={1} paddingY={0}>
        <Text bold color="#ff8c00">
          Warning: Project Already Initialized
        </Text>
      </Box>

      <Box paddingX={1} marginY={1}>
        <Text>
          The project at <Text bold>{projectPath}</Text> already has a .pakalon folder.
        </Text>
      </Box>

      <Box paddingX={1} marginY={1}>
        <Text dimColor color="gray">
          Existing files ({existingFiles.length}):
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={2}>
        {existingFiles.slice(0, 5).map((file) => (
          <Text key={file} dimColor color="gray">
            • {file}
          </Text>
        ))}
        {existingFiles.length > 5 && (
          <Text dimColor color="gray">
            ... and {existingFiles.length - 5} more
          </Text>
        )}
      </Box>

      <Box paddingX={1} marginY={1}>
        <Text>What would you like to do?</Text>
      </Box>

      <Box flexDirection="column" paddingX={2}>
        {choices.map((choice, index) => {
          const isActive = index === cursor;
          return (
            <Box key={choice.id} marginBottom={1}>
              <Text color={isActive ? choice.color : undefined} bold={isActive}>
                {isActive ? "> " : "  "}
                {index + 1}. {choice.label}
              </Text>
              {choice.description && (
                <Text dimColor color="gray">
                  {" "}- {choice.description}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor color="gray">
          ↑/↓ navigate  Enter/Num select  Esc cancel
        </Text>
      </Box>
    </Box>
  );
};

export default OverwriteConfirmationDialog;

export async function promptOverwriteConfirmation(
  projectPath: string,
  existingFiles: string[]
): Promise<OverwriteConfirmationResult> {
  return new Promise((resolve) => {
    resolve({ confirmed: false, overwrite: false, useExisting: false, cancel: true });
  });
}
