import React, { useCallback, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface MakeChangesInputProps {
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}

const MakeChangesInput: React.FC<MakeChangesInputProps> = ({ onSubmit, onCancel }) => {
  const [value, setValue] = useState("");

  const submit = useCallback(() => {
    const next = value.trim();
    if (!next) return;
    onSubmit(next);
  }, [onSubmit, value]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }

    if (key.return) {
      submit();
      return;
    }

    if (key.backspace || input === "\b" || input === "\x7f") {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setValue((current) => current + input);
    }
  });

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">Make Changes</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>Describe the changes you want:</Text>
      </Box>
      <Box>
        <Text color="yellow">&gt; </Text>
        <Text>{value}</Text>
        <Text color="yellow">█</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor color="gray">Enter: submit  Esc: cancel</Text>
      </Box>
    </Box>
  );
};

export default MakeChangesInput;
