import React, { useMemo } from "react";
import { Box, Text } from "ink";
import BlinkingIndicator, { type BlinkingIndicatorStatus } from "@/components/BlinkingIndicator.js";

export interface SessionStatusBarItem {
  id: string;
  title: string;
  status: BlinkingIndicatorStatus;
  needsInput?: boolean;
  elapsed?: number | string;
}

export interface SessionStatusBarProps {
  sessions: SessionStatusBarItem[];
  selectedSessionId?: string | null;
  onCreate?: () => void;
}

const SessionStatusBar: React.FC<SessionStatusBarProps> = ({ sessions, selectedSessionId, onCreate }) => {
  const visible = useMemo(() => sessions.slice(0, 5), [sessions]);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {visible.map((session) => (
          <Box key={session.id} marginRight={2}>
            <BlinkingIndicator
              label={session.title}
              status={session.status}
              variant={session.needsInput ? "blink" : session.status === "running" ? "spinner" : "pulse"}
              elapsed={session.elapsed}
            />
            {selectedSessionId === session.id ? <Text color="cyan"> *</Text> : null}
          </Box>
        ))}
      </Box>
      <Box>
        <Text color="yellow">+</Text>
        <Text>{" create"}</Text>
        {onCreate ? <Text dimColor>{" (enter)"}</Text> : null}
      </Box>
    </Box>
  );
};

export default React.memo(SessionStatusBar);
