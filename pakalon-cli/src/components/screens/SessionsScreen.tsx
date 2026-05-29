import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { cmdListSessions, type SessionSummary } from "@/commands/session.js";
import { PAKALON_GOLD, TEXT_SECONDARY } from "@/constants/colors.js";

interface SessionsScreenProps {
  onSelect?: (sessionId: string) => void | Promise<void>;
  onBack?: () => void;
  projectDir?: string;
}

const VIEWPORT = 16;

const SessionsScreen: React.FC<SessionsScreenProps> = ({
  onSelect,
  onBack,
  projectDir,
}) => {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        let list = await cmdListSessions(24, projectDir);
        if (!list.length && projectDir) {
          list = await cmdListSessions(24, null);
        }
        if (!cancelled) setSessions(list);
      } catch {
        if (!cancelled) setSessions([]);
      }
      if (!cancelled) setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => {
      const searchable = [
        session.id,
        session.title ?? "",
        session.mode ?? "",
        session.model_id ?? "",
        session.created_at ?? "",
        session.updated_at ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });
  }, [query, sessions]);

  useEffect(() => {
    setSelectedIdx((current) =>
      Math.max(0, Math.min(current, Math.max(filtered.length - 1, 0))),
    );
  }, [filtered.length]);

  useInput((input, key) => {
    if (confirmed) return;

    if (key.upArrow) {
      setSelectedIdx((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((index) => Math.min(filtered.length - 1, index + 1));
      return;
    }
    if (key.return) {
      const session = filtered[selectedIdx];
      if (!session) return;
      setConfirmed(true);
      setStatusMsg(`[OK] Session selected: ${session.id}`);
      void Promise.resolve(onSelect?.(session.id)).catch(() => {
        setConfirmed(false);
        setStatusMsg("Failed to restore session.");
      });
      if (!onSelect) {
        setTimeout(() => exit(), 800);
      }
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      if (onBack) onBack();
      else exit();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      return;
    }
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setQuery((current) => current + input);
    }
  });

  const viewStart = Math.max(
    0,
    Math.min(
      selectedIdx - Math.floor(VIEWPORT / 2),
      filtered.length - VIEWPORT,
    ),
  );
  const viewEnd = Math.min(filtered.length, viewStart + VIEWPORT);
  const visible = filtered.slice(viewStart, viewEnd);

  if (loading) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={PAKALON_GOLD}
        paddingX={1}
      >
        <Text color={PAKALON_GOLD}>Loading sessions...</Text>
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

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PAKALON_GOLD}
      paddingX={1}
      paddingY={0}
    >
      <Box flexDirection="row" marginBottom={0}>
        <Text bold color={PAKALON_GOLD}>
          SESSIONS
        </Text>
        <Text dimColor> {filtered.length} available</Text>
      </Box>

      <Box paddingX={1} marginBottom={0}>
        <Text color={PAKALON_GOLD}>Search: </Text>
        <Text color="white">{query}</Text>
        <Text color={TEXT_SECONDARY}>█</Text>
      </Box>

      <Box flexDirection="column">
        {visible.map((session, index) => {
          const isSelected = viewStart + index === selectedIdx;
          const title = session.title?.trim() || "Untitled session";
          const created = new Date(session.created_at).toLocaleString();
          const updated = new Date(session.updated_at).toLocaleString();
          const model = session.model_id ?? "—";
          return (
            <Box key={session.id} flexDirection="column" marginBottom={0}>
              <Text color={isSelected ? "white" : "gray"}>
                {isSelected ? "-> " : "  "}
                <Text
                  color={isSelected ? PAKALON_GOLD : "white"}
                  bold={isSelected}
                >
                  {title.slice(0, 32).padEnd(32)}
                </Text>
                <Text color={TEXT_SECONDARY}> {session.id.slice(0, 8)}…</Text>
              </Text>
              <Text dimColor={!isSelected}>
                {created} • updated {updated} • {model}
              </Text>
            </Box>
          );
        })}
        {filtered.length === 0 && (
          <Box paddingX={2}>
            <Text dimColor>No sessions found.</Text>
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
        borderColor={PAKALON_GOLD}
        paddingX={1}
        marginTop={0}
      >
        <Text dimColor>↑↓</Text>
        <Text> navigate </Text>
        <Text dimColor>Enter</Text>
        <Text> restore </Text>
        <Text dimColor>type</Text>
        <Text> search </Text>
        <Text dimColor>Esc</Text>
        <Text> back</Text>
      </Box>
    </Box>
  );
};

export default SessionsScreen;
