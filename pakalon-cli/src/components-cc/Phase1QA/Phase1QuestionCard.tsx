import React from "react";
import { Box, Text } from "ink";
import type { Phase1QAChoice, Phase1QARequest } from "./Phase1QAProvider.js";

export function Phase1QuestionCard({
  request,
  selectedIds,
  cursor,
  otherText,
}: {
  request: Phase1QARequest;
  selectedIds: string[];
  cursor: number;
  otherText: string;
}) {
  const multi = Boolean(request.multi_select);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#ff8c00" paddingX={2} paddingY={1}>
      <Text bold color="#ff8c00">
        {request.message}
      </Text>
      <Text bold>{request.question}</Text>
      <Box marginTop={1} flexDirection="column">
        {request.choices.map((choice: Phase1QAChoice, index: number) => {
          const active = index === cursor;
          const checked = selectedIds.includes(choice.id);
          const marker = multi ? (checked ? "[X]" : "[ ]") : active ? ">" : " ";
          return (
            <Box key={choice.id}>
              <Text color={active ? "#ff8c00" : undefined}>{marker} </Text>
              <Text color={active ? "#ff8c00" : undefined} bold={active || checked}>
                {choice.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      {request.allow_other && otherText && (
        <Box marginTop={1}>
          <Text dimColor>Other: {otherText}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {multi ? "↑↓ move · Space toggle · Enter submit" : "↑↓ move · Enter submit"}
        </Text>
      </Box>
    </Box>
  );
}
