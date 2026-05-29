/**
 * BuildScreen — Full pipeline TUI using native TypeScript pipeline.
 * Replaces Python bridge SSE streaming with in-process EventEmitter.
 * Handles choice_request (Q&A) and approval_request interactive prompts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "@/components/ui/Spinner.js";
import StatusLine from "@/components/ui/StatusLine.js";
import { useAuth, useStore } from "@/store/index.js";
import { createSession, runPipeline, sendInput } from "@/pipeline/session.js";
import { Phase1QASession } from "@/components-cc/Phase1QA/index.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChoiceItem {
  id: string;
  label: string;
}

interface ChoiceRequest {
  type: "choice_request";
  message?: string;
  question_index: number;
  total_questions: number;
  question: string;
  choices: ChoiceItem[];
  multi_select?: boolean;
  allow_other?: boolean;
  _requestId?: string;
  can_end: boolean;
  end_label?: string;
}

interface ApprovalRequest {
  type: "approval_request";
  message: string;
  question: string;
  choices: ChoiceItem[];
}

type InteractiveRequest = ChoiceRequest | ApprovalRequest;

interface PipelineEvent {
  type: string;
  content?: string;
  phase?: number;
  files?: string[];
  message?: string;
  question?: string;
  choices?: ChoiceItem[];
  question_index?: number;
  total_questions?: number;
  multi_select?: boolean;
  allow_other?: boolean;
  _requestId?: string;
  can_end?: boolean;
  end_label?: string;
}

interface BuildScreenProps {
  phase: number;
  projectDir: string;
  userPrompt: string;
  isYolo: boolean;
  figmaUrl?: string;
  targetUrl: string;
  privacyLevel?: "off" | "metadata" | "full";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const BuildScreen: React.FC<BuildScreenProps> = ({
  phase,
  projectDir,
  userPrompt,
  isYolo,
  figmaUrl,
  targetUrl,
  privacyLevel,
}) => {
  const { exit } = useApp();
  const { token } = useAuth();
  const userId = useStore((s) => s.userId);
  const plan = useStore((s) => s.plan);

  const [logs, setLogs] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [interactiveReq, setInteractiveReq] = useState<InteractiveRequest | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef(new AbortController());
  const sessionIdRef = useRef<string | null>(null);

  const addLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-100), line]);
  }, []);

  const sendResponse = useCallback(
    (value: string | string[]) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setInteractiveReq(null);
      setCurrentStep("Continuing...");
      sendInput(sid, Array.isArray(value) ? JSON.stringify(value) : value);
    },
    [],
  );

  // Handle SelectInput item selection
  const handleSelect = useCallback(
    (item: { value: string; label: string }) => {
      sendResponse(item.value);
    },
    [sendResponse],
  );

  // Main pipeline execution effect
  useEffect(() => {
    async function startPipeline() {
      try {
        const session = createSession({
          projectDir,
          userPrompt,
          userId: userId ?? "anonymous",
          userPlan: plan ?? "free",
          isYolo,
        });
        sessionIdRef.current = session.id;
        addLog(`[Rocket] Pipeline started (session: ${session.id.slice(0, 8)}...)`);

        const handleEvent = (evt: Record<string, unknown>) => {
          const pipelineEvent = evt as unknown as PipelineEvent;
          switch (pipelineEvent.type) {
            case "text_delta":
              if (pipelineEvent.content) {
                const line = pipelineEvent.content.replace(/\n$/, "");
                if (line) addLog(line);
                setCurrentStep(line.slice(0, 60));
              }
              break;

            case "choice_request":
              setInteractiveReq({
                type: "choice_request",
                message: (pipelineEvent.message as string) ?? "",
                question_index: typeof pipelineEvent.question_index === "number" ? pipelineEvent.question_index : -1,
                total_questions: typeof pipelineEvent.total_questions === "number" ? pipelineEvent.total_questions : 1,
                question: pipelineEvent.question ?? "",
                choices: (pipelineEvent.choices as ChoiceItem[]) ?? [],
                multi_select: Boolean(pipelineEvent.multi_select),
                allow_other: Boolean(pipelineEvent.allow_other),
                _requestId: pipelineEvent._requestId,
                can_end: (pipelineEvent.can_end as boolean) ?? false,
                end_label: pipelineEvent.end_label as string | undefined,
              });
              setCurrentStep(`Question ${((pipelineEvent.question_index as number) ?? 0) + 1}/${pipelineEvent.total_questions ?? "?"}`);
              break;

            case "approval_request":
              setInteractiveReq({
                type: "approval_request",
                message: (pipelineEvent.message as string) ?? "",
                question: (pipelineEvent.question as string) ?? "Approve?",
                choices: (pipelineEvent.choices as ChoiceItem[]) ?? [
                  { id: "accept", label: "Accept" },
                  { id: "skip", label: "Skip" },
                ],
              });
              setCurrentStep("Awaiting your approval...");
              break;

            case "phase_complete":
              addLog(`[OK] Phase ${pipelineEvent.phase} complete — ${((pipelineEvent.files as string[]) ?? []).length} files`);
              setCurrentStep(`Phase ${pipelineEvent.phase} complete!`);
              break;

            case "stream_end":
              setIsRunning(false);
              setIsDone(true);
              break;

            case "error":
              setError((pipelineEvent.message as string) ?? "Unknown pipeline error");
              addLog(`[X] ${pipelineEvent.message ?? "Error"}`);
              setIsRunning(false);
              break;

            case "keepalive":
              break;

            default:
              logger.debug("Unknown pipeline event", evt);
          }
        };

        await runPipeline(session.id, phase, handleEvent, abortRef.current.signal);
        setIsRunning(false);
        setIsDone(true);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          const msg = err?.message ?? String(err);
          setError(msg);
          addLog(`[X] Error: ${msg}`);
        }
        setIsRunning(false);
      }
    }

    startPipeline();

    return () => {
      abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      abortRef.current.abort();
      exit();
    }
    if (key.escape && isDone) {
      exit();
    }
  });

  // Build SelectInput items from choice / approval request
  const selectItems = useMemo(() => {
    if (!interactiveReq) return [];
    const base = (interactiveReq.choices ?? []).map((c) => ({
      value: c.id,
      label: c.label,
    }));
    if (interactiveReq.type === "choice_request" && interactiveReq.can_end) {
      base.push({
        value: "End phase",
        label: interactiveReq.end_label ?? "End Q&A and proceed",
      });
    }
    return base;
  }, [interactiveReq]);

  const visibleLogs = logs.slice(-20);

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box paddingX={1} gap={2}>
        <Text bold color="magenta">
          PAKALON BUILD
        </Text>
        <Text dimColor>Phase {phase}</Text>
        {projectDir !== "." && <Text dimColor>{projectDir}</Text>}
      </Box>

      {/* Progress indicator */}
      {isRunning && !interactiveReq && (
        <Box gap={1} paddingX={1}>
          <Spinner />
          <Text color="#ff8c00">{currentStep}</Text>
        </Box>
      )}

      {/* Scrolling logs */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">
        {visibleLogs.map((line, i) => (
          <Text key={i} dimColor={i < visibleLogs.length - 3} wrap="truncate">
            {line}
          </Text>
        ))}
      </Box>

      {/* Interactive prompt: choice_request (Q&A) */}
      {interactiveReq && interactiveReq.type === "choice_request" && interactiveReq.question_index >= 0 ? (
        <Phase1QASession
          request={{
            type: "choice_request",
            message: interactiveReq.message ?? interactiveReq.question,
            question: interactiveReq.question,
            choices: interactiveReq.choices,
            question_index: interactiveReq.question_index,
            total_questions: interactiveReq.total_questions,
            multi_select: interactiveReq.multi_select,
            allow_other: interactiveReq.allow_other,
            _requestId: interactiveReq._requestId ?? "phase1",
          }}
          onSubmit={sendResponse}
        />
      ) : interactiveReq && interactiveReq.type === "choice_request" && (
        <Box flexDirection="column" borderStyle="round" borderColor="#ff8c00" paddingX={2} paddingY={1}>
          <Text bold color="#ff8c00">
            Question {interactiveReq.question_index + 1}/{interactiveReq.total_questions}
          </Text>
          <Text bold>{interactiveReq.question}</Text>
          <Box marginTop={1}>
            <SelectInput items={selectItems} onSelect={handleSelect} />
          </Box>
        </Box>
      )}

      {/* Interactive prompt: approval_request */}
      {interactiveReq && interactiveReq.type === "approval_request" && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
          <Text bold color="yellow">
            Design Review
          </Text>
          {interactiveReq.message && <Text dimColor>{interactiveReq.message}</Text>}
          <Text bold>{interactiveReq.question}</Text>
          <Box marginTop={1}>
            <SelectInput items={selectItems} onSelect={handleSelect} />
          </Box>
        </Box>
      )}

      {/* Completion / error state */}
      {isDone && !error && (
        <Box paddingX={1}>
          <Text bold color="#ff8c00">
            Phase {phase} completed successfully. Press Esc or Ctrl-C to exit.
          </Text>
        </Box>
      )}
      {error && (
        <Box paddingX={1}>
          <Text bold color="red">
            {error}
          </Text>
        </Box>
      )}

      <StatusLine />
    </Box>
  );
};

export default BuildScreen;
