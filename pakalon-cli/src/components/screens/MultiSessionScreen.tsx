import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { cmdListSessions, type SessionSummary } from "@/commands/session.js";
import { PAKALON_BLUE, PAKALON_GOLD, TEXT_SECONDARY } from "@/constants/colors.js";
import { useStore } from "@/store/index.js";
import BlinkingIndicator from "@/components/BlinkingIndicator.js";
import SessionStatusBar from "@/components/SessionStatusBar.js";

export type MultiSessionStatus = "idle" | "running" | "needs-input" | "completed" | "failed";

interface MultiSessionScreenProps {
  projectDir?: string;
  activeSessionId?: string | null;
  statusBySessionId?: Record<string, MultiSessionStatus>;
  onSelect: (sessionId: string) => Promise<void> | void;
  onCreate: () => Promise<void> | void;
  onBack: () => void;
}

type Row =
  | { kind: "create"; id: "__create__" }
  | { kind: "session"; id: string; session: SessionSummary };

const VIEWPORT = 14;
const SPINNER = ["|", "/", "-", "\\"];

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getStatusLabel(status: MultiSessionStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "needs-input":
      return "needs input";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return "ready";
  }
}

function getStatusColor(status: MultiSessionStatus): string {
  switch (status) {
    case "running":
      return PAKALON_GOLD;
    case "needs-input":
      return "yellowBright";
    case "completed":
      return "green";
    case "failed":
      return "red";
    default:
      return TEXT_SECONDARY;
  }
}

const MultiSessionScreen: React.FC<MultiSessionScreenProps> = ({
  projectDir,
  activeSessionId,
  statusBySessionId = {},
  onSelect,
  onCreate,
  onBack,
}) => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { runningCommands, sessionStartedAt } = useStore((s) => ({
    runningCommands: s.runningCommands,
    sessionStartedAt: s.sessionStartedAt,
  }));

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      let list = await cmdListSessions(50, projectDir);
      if (!list.length && projectDir) {
        list = await cmdListSessions(50, null);
      }
      setSessions(list);
      setStatusMessage(null);
    } catch (err) {
      setSessions([]);
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => (value + 1) % SPINNER.length), 180);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo<Row[]>(
    () => [...sessions.map((session) => ({ kind: "session" as const, id: session.id, session })), { kind: "create" as const, id: "__create__" }],
    [sessions],
  );

  useEffect(() => {
    setSelectedIdx((current) => Math.max(0, Math.min(current, Math.max(rows.length - 1, 0))));
  }, [rows.length]);

  const runCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatusMessage("Creating a new session...");
    try {
      await onCreate();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, onCreate]);

  const runSelect = useCallback(async (sessionId: string) => {
    if (busy) return;
    setBusy(true);
    setStatusMessage(`Opening session ${sessionId.slice(0, 8)}...`);
    try {
      await onSelect(sessionId);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, onSelect]);

  useInput((input, key) => {
    if (busy) return;
    if (key.upArrow) {
      setSelectedIdx((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((index) => Math.min(rows.length - 1, index + 1));
      return;
    }
    if (key.return) {
      const row = rows[selectedIdx];
      if (!row) return;
      if (row.kind === "create") {
        void runCreate();
      } else {
        void runSelect(row.session.id);
      }
      return;
    }
    if (input === "+" || input.toLowerCase() === "n") {
      void runCreate();
      return;
    }
    if (input.toLowerCase() === "r") {
      void loadSessions();
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      onBack();
    }
  });

  const viewStart = Math.max(0, Math.min(selectedIdx - Math.floor(VIEWPORT / 2), rows.length - VIEWPORT));
  const visible = rows.slice(viewStart, viewStart + VIEWPORT);
  const activeSpinner = SPINNER[tick] ?? SPINNER[0];
  const sessionStatusItems = useMemo(
    () =>
      sessions
        .map((session) => {
          const status = statusBySessionId[session.id] ?? "idle";
          const commands = runningCommands.filter((command) => command.sessionId === session.id);
          const startTime = commands.reduce((min, command) => Math.min(min, command.startTime), Number.POSITIVE_INFINITY);
          const inferredElapsed = Number.isFinite(startTime)
            ? Date.now() - startTime
            : session.id === activeSessionId && sessionStartedAt
              ? Date.now() - sessionStartedAt
              : undefined;
          return {
            id: session.id,
            title: (session.title?.trim() || session.prompt_text?.trim() || "Untitled session").slice(0, 24),
            status: status === "needs-input" ? "running" : status,
            needsInput: status === "needs-input",
            elapsed: inferredElapsed,
          };
        })
        .filter((item) => item.status === "running" || item.needsInput),
    [activeSessionId, runningCommands, sessionStartedAt, sessions, statusBySessionId],
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PAKALON_GOLD} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={PAKALON_GOLD}>MULTI-SESSION</Text>
        <Text dimColor> {sessions.length} project session{sessions.length === 1 ? "" : "s"}</Text>
      </Box>

      <Text dimColor>{projectDir ?? process.cwd()}</Text>
      {loading ? (
        <Box marginTop={1}>
          <Text color={PAKALON_GOLD}>{activeSpinner} Loading sessions...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visible.map((row, offset) => {
            const absoluteIndex = viewStart + offset;
            const selected = absoluteIndex === selectedIdx;

            if (row.kind === "create") {
              return (
                <Box key={row.id} gap={1}>
                  <Text color={selected ? PAKALON_BLUE : PAKALON_GOLD} bold={selected}>
                    {selected ? ">" : " "} +
                  </Text>
                  <Text color={selected ? PAKALON_BLUE : "white"} bold={selected}>
                    Create session
                  </Text>
                  <Text dimColor>Enter to start</Text>
                </Box>
              );
            }

            const status = statusBySessionId[row.session.id] ?? "idle";
            const active = row.session.id === activeSessionId;
            const needsInput = status === "needs-input";
            const showNeedsInput = !needsInput || tick % 2 === 0;
            const title = row.session.title?.trim() || row.session.prompt_text?.trim() || "Untitled session";
            const commands = runningCommands.filter((command) => command.sessionId === row.session.id);
            const elapsedStart = commands.reduce((min, command) => Math.min(min, command.startTime), Number.POSITIVE_INFINITY);
            const elapsed = Number.isFinite(elapsedStart)
              ? Date.now() - elapsedStart
              : active && sessionStartedAt
                ? Date.now() - sessionStartedAt
                : undefined;

            return (
              <Box key={row.session.id} flexDirection="column">
                <Box gap={1}>
                  <Text color={selected ? PAKALON_BLUE : TEXT_SECONDARY}>
                    {selected ? ">" : " "}
                  </Text>
                  <Text color={selected ? PAKALON_BLUE : "white"} bold={selected || active}>{title.slice(0, 34).padEnd(34)}</Text>
                  <Text color={TEXT_SECONDARY}>{row.session.id.slice(0, 8)}</Text>
                  <BlinkingIndicator
                    status={needsInput ? "running" : status}
                    variant={needsInput ? "blink" : status === "running" ? "spinner" : "pulse"}
                    elapsed={elapsed}
                    label={getStatusLabel(status)}
                  />
                  {active ? <Text color={PAKALON_GOLD}>active</Text> : null}
                </Box>
                <Text dimColor>
                  updated {formatDate(row.session.updated_at)} · {row.session.model_id ?? "model -"}
                </Text>
              </Box>
            );
          })}

          {sessions.length === 0 && (
            <Box marginTop={1}>
              <Text dimColor>No sessions found for this project yet.</Text>
            </Box>
          )}
        </Box>
      )}

      {rows.length > VIEWPORT && (
        <Text dimColor>
          {viewStart + 1}-{Math.min(viewStart + VIEWPORT, rows.length)} of {rows.length}
        </Text>
      )}

      {statusMessage ? (
        <Box marginTop={1}>
          <Text color={busy ? PAKALON_GOLD : "red"}>{busy ? `${activeSpinner} ` : ""}{statusMessage}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <SessionStatusBar sessions={sessionStatusItems} selectedSessionId={activeSessionId} onCreate={onCreate} />
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={PAKALON_GOLD} paddingX={1}>
        <Text dimColor>up/down</Text>
        <Text> move </Text>
        <Text dimColor>Enter</Text>
        <Text> open </Text>
        <Text dimColor>+</Text>
        <Text> new </Text>
        <Text dimColor>r</Text>
        <Text> refresh </Text>
        <Text dimColor>Esc</Text>
        <Text> back</Text>
      </Box>
    </Box>
  );
};

export default React.memo(MultiSessionScreen);
