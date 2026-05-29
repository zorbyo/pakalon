/**
 * AgentScreen — agent mode TUI showing step-by-step tool execution progress.
 * Supports both:
 *   1. Normal agent mode (direct AI streaming via Vercel AI SDK)
 *   2. Bridge pipeline mode (SSE events from Python bridge for phases 1–6)
 */
import path from "node:path";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import MessageList from "@/components/ui/MessageList.js";
import InputBar from "@/components/ui/InputBar.js";
import StatusLine from "@/components/ui/StatusLine.js";
import { useAuth, useSession, useModel, useMode, useStreaming, useStore } from "@/store/index.js";
import { handleStream } from "@/ai/stream.js";
import { allTools } from "@/ai/tools.js";
import { loadMcpTools } from "@/mcp/tools.js";
import { cmdPenpotOpen } from "@/commands/penpot.js";
import { trimToContextWindow, buildSystemWithContext } from "@/ai/context.js";
import { runProxyToolLoop } from "@/ai/proxy-tool-runner.js";
import type { tool, ToolSet } from "ai";
import { useEngineStore } from "@/store/slices/engine.slice.js";
import { injectSkillsIntoPrompt } from "@/engine/to-ai-sdk.js";
import type { Command } from "@/types-imported/command.js";
import {
  createSession,
  runPipeline,
  runSinglePhase,
  sendInput as sendPipelineInput,
} from "@/pipeline/session.js";
import { Phase1QASession } from "@/components-cc/Phase1QA/index.js";
import { generateSideAnswer } from "@/ai/side-answer.js";
import { searchMemories } from "@/memory/store.js";
import logger from "@/utils/logger.js";
import type { ModelMessage as CoreMessage } from "ai";
import { DEFAULT_FREE_MODEL_ID } from "@/constants/models.js";
import type { PenpotProjectState } from "@/utils/penpot-state.js";
import { resolvePenpotProjectState } from "@/utils/penpot-state.js";

const AGENT_SYSTEM = `You are Pakalon, an agentic AI coding assistant running in a terminal.
You operate autonomously to complete tasks and you must prefer doing the work over describing shell steps.

Follow a PAUL-style loop for every request:
1. PLAN — inspect the project, identify the smallest concrete next action, and use read/search/LSP tools when needed.
2. APPLY — execute the change with the appropriate tool. Do not answer with "I'll do X" or with suggested shell commands when a tool can perform the task.
3. UNIFY — validate the result (prefer LSP diagnostics or project checks after code changes) and then summarize what was completed.

Available tool families:
- Files: readFile, listDir, globFind, grepSearch, writeFile, editFile, multiEditFiles
- Commands: bash
- LSP: lspDefinition, lspReferences, lspHover, lspCompletion, lspRename, lspDiagnostics, lspSymbols
- Research/support: webFetch, webSearch, todoRead, todoWrite, notebookRead, notebookEdit

When command-line work is requested, use shell-style execution via bash/grep tools (including cd/Set-Location workflows) rather than generating Python scripts as command wrappers.

When the user asks for a concrete file or code change, actually perform it before responding.
Prefer LSP tools whenever symbol-aware inspection or validation would help.
Keep the completion summary concise and focused on the completed work, blockers, and validation.`;

const PHASE_LABELS: Record<number, string> = {
  1: "Phase 1 — Planning & Research",
  2: "Phase 2 — Wireframe Design",
  3: "Phase 3 — Development (5 sub-agents)",
  4: "Phase 4 — Security QA",
  5: "Phase 5 — CI/CD",
  6: "Phase 6 — Documentation",
};

interface AgentScreenProps {
  initialTask?: string;
  projectDir?: string;
  /** When set, runs in bridge pipeline mode (phases 1-6) */
  bridgeMode?: {
    userPrompt: string;
    userId: string;
    userPlan: string;
    isYolo: boolean;
    privacyLevel?: "off" | "metadata" | "full";
    figmaUrl?: string;
    targetUrl?: string;
    startPhase?: number;
    endPhase?: number;
  };
}

const AgentScreen: React.FC<AgentScreenProps> = ({ initialTask, projectDir, bridgeMode }) => {
  const { exit } = useApp();
  const { token } = useAuth();
  const { messages, addMessage, finalizeStreamingMessage, updateMessageById } = useSession();
  const { selectedModel } = useModel();
  const { agentCurrentStep, setAgentStep, setAgentRunning, thinkingEnabled, permissionMode, privacyLevel } = useMode();
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const { isStreaming, appendStreamChunk, setThinkContent, reset: resetStreaming } = useStreaming();
  const clearBridgeMode = useStore((s) => s.clearBridgeMode);
  const sentInitial = useRef(false);
  const stepCount = useRef(0);
  const mcpToolsRef = useRef<ToolSet>({});
  const effectiveProjectDir = projectDir ?? process.cwd();

  // ── HarnessEngine integration ────────────────────────────────────────
  const { engineStatus } = useEngineStore();
  const skillContextRef = useRef("");

  // Load skill context from engine when it becomes ready
  useEffect(() => {
    if (engineStatus !== "ready") return;
    (async () => {
      try {
        const { getGlobalEngine } = await import("@/engine/HarnessEngine.js");
        const engine = await getGlobalEngine();
        const skills = engine.getSkillCommands() as Command[];
        if (skills.length > 0) {
          const skillPrompt = skills
            .filter((s: Command) => s.type === "prompt" && s.name)
            .slice(0, 50) // cap at 50 skills to avoid prompt blowup
            .map((s: Command) => `- /${s.name}: ${s.description ?? s.whenToUse ?? "(no description)"}`)
            .join("\n");
          skillContextRef.current = `\n\n## Loaded Skills (${skills.length} total)\nYou have access to the following slash commands (invoke with /name):\n${skillPrompt}`;
          logger.debug(`[AgentScreen] Loaded ${skills.length} skills from HarnessEngine`);
        }
      } catch (err) {
        logger.warn("[AgentScreen] Failed to load skills from engine", { err: String(err) });
      }
    })();
  }, [engineStatus]);

  // ── End HarnessEngine integration ────────────────────────────────────

  // Load MCP tools on mount
  useEffect(() => {
    loadMcpTools(projectDir)
      .then(({ tools, toolCount }) => {
        mcpToolsRef.current = tools;
        if (toolCount > 0) logger.debug(`[AgentScreen] Loaded ${toolCount} MCP tool(s)`);
      })
      .catch((err) => {
        logger.warn("[AgentScreen] MCP load failed", { err: String(err) });
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Warning: MCP tools could not be loaded: ${String(err)}`,
          createdAt: new Date(),
          isStreaming: false,
        });
      });
  }, [addMessage, projectDir]);

  // Bridge pipeline state
  const [currentPhase, setCurrentPhase] = useState<number | null>(null);
  const [pipelineSessionId, setPipelineSessionId] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{
    message: string;
    question: string;
    choices: Array<{ id: string; label: string }>;
    multiSelect?: boolean;
    allowOther?: boolean;
    questionIndex?: number;
    totalQuestions?: number;
    requestId?: string;
  } | null>(null);
  const [awaitingFreeText, setAwaitingFreeText] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [proxyToolLoopRunning, setProxyToolLoopRunning] = useState(false);
  const [penpotState, setPenpotState] = useState<PenpotProjectState | null>(null);
  const [openingPenpot, setOpeningPenpot] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const agentBusy = isStreaming || proxyToolLoopRunning || pipelineRunning;
  const historyItems = React.useMemo(
    () => messages
      .filter((m) => m.role === "user")
      .map((m) => typeof m.content === "string" ? m.content : "")
      .filter(Boolean)
      .reverse(),
    [messages],
  );

  useEffect(() => {
    if (permissionMode === "plan" || permissionMode === "orchestration") {
      setPermissionMode("normal");
      logger.debug("[AgentScreen] Reset permission mode for agent execution", {
        from: permissionMode,
        to: "normal",
      });
    }
  }, [permissionMode, setPermissionMode]);

  const formatAgentError = useCallback((err: unknown): string => {
    if (err instanceof Error) {
      return err.message || String(err);
    }
    if (err && typeof err === "object") {
      try {
        return JSON.stringify(err, null, 2);
      } catch {
        return String(err);
      }
    }
    return String(err);
  }, []);

  const formatPenpotStateSummary = useCallback((state: PenpotProjectState | null) => {
    if (!state?.fileId) return null;

    const lines = [`[Art] Current Penpot design: ${state.fileUrl ?? state.projectUrl ?? state.baseUrl}`];

    if (state.revision !== null) lines.push(`   revision: ${state.revision}`);
    if (state.status) lines.push(`   status: ${state.status}`);
    if (state.localSvgPath) lines.push(`   svg: ${path.basename(state.localSvgPath)}`);
    if (state.localJsonPath) lines.push(`   json: ${path.basename(state.localJsonPath)}`);

    return lines.join("\n");
  }, []);

  const refreshPenpotState = useCallback(
    async (reason: "mount" | "phase-complete" | "design-updated") => {
      try {
        const nextState = resolvePenpotProjectState(effectiveProjectDir);
        setPenpotState(nextState);
        if (nextState?.fileId) {
          logger.debug(`[AgentScreen] Penpot state refreshed (${reason})`, {
            fileId: nextState.fileId,
            revision: nextState.revision,
            status: nextState.status,
          });
        }
        return nextState;
      } catch (err) {
        logger.debug(`[AgentScreen] Penpot state refresh failed (${reason})`, err);
        return null;
      }
    },
    [effectiveProjectDir],
  );

  // -----------------------------------------------------------------
  // Bridge pipeline mode
  // -----------------------------------------------------------------

  const appendPipelineText = useCallback((content: string) => {
    // Append to the last streaming message or add new one
    const store = useStore.getState();
    const msgs = store.messages ?? [];
    const last = msgs[msgs.length - 1];
    if (last?.isStreaming) {
      store.appendToLastMessage(content);
    } else {
      store.addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        createdAt: new Date(),
        isStreaming: false,
      });
    }
  }, []);

  const openCurrentPenpotDesign = useCallback(
    async (source: "bridge-panel" | "hil-prompt") => {
      if (openingPenpot) return;

      if (!penpotState?.fileId) {
        appendPipelineText("\n[i] No Penpot design is available for this project yet.\n");
        return;
      }

      setOpeningPenpot(true);
      try {
        const result = await cmdPenpotOpen(undefined, effectiveProjectDir);
        appendPipelineText(`\n[Globe] Opened current Penpot design (${source}): ${result.url}\n`);
      } catch (err) {
        appendPipelineText(`\n[X] Unable to open current Penpot design: ${String(err)}\n`);
      } finally {
        setOpeningPenpot(false);
      }
    },
    [appendPipelineText, effectiveProjectDir, openingPenpot, penpotState?.fileId],
  );

  const handlePipelineEvent = useCallback(
    (event: Record<string, unknown>) => {
      const evt = event as Record<string, unknown> & {
        type: string;
        content?: string;
        message?: string;
        question?: string;
        choices?: Array<{ id: string; label: string }>;
        phase?: number;
        files?: string[];
        prompt?: string;
        multi_select?: boolean;
        allow_other?: boolean;
        question_index?: number;
        total_questions?: number;
        _requestId?: string;
      };
      switch (evt.type) {
        case "phase_start":
          setCurrentPhase((evt.phase as number) ?? null);
          setAgentStep(`> ${PHASE_LABELS[(evt.phase as number)] ?? `Phase ${evt.phase}`}…`);
          addMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: `\n[Rocket] ${PHASE_LABELS[(evt.phase as number)] ?? `Phase ${evt.phase}`}\n`,
            createdAt: new Date(),
            isStreaming: false,
          });
          break;

        case "text_delta":
          appendPipelineText((evt.content as string) ?? "");
          break;

        case "tool_call":
          setAgentStep(`[Wrench] ${(evt as any).tool}`);
          break;

        case "tool_result":
          setAgentStep(null);
          break;

        case "choice_request":
        case "approval_request":
          setPendingChoice({
            message: (evt.message as string) ?? "",
            question: (evt.question as string) ?? "",
            choices: (evt.choices as Array<{ id: string; label: string }>) ?? [],
            multiSelect: Boolean(evt.multi_select),
            allowOther: Boolean(evt.allow_other),
            questionIndex: typeof evt.question_index === "number" ? evt.question_index : undefined,
            totalQuestions: typeof evt.total_questions === "number" ? evt.total_questions : undefined,
            requestId: evt._requestId,
          });
          setAgentStep("Waiting for your input...");
          break;

        case "phase_complete":
          setAgentStep(null);
          setCurrentPhase((prev) => (prev !== null ? prev + 1 : null));
          appendPipelineText(
            `\n${PHASE_LABELS[(evt.phase as number)] ?? `Phase ${evt.phase}`} complete.\n` +
              (((evt.files as string[]) ?? []).length > 0
                ? `  Files written: ${((evt.files as string[]) ?? []).length}\n`
                : ""),
          );
          if ((evt.phase as number) >= 2) {
            void (async () => {
              const nextState = await refreshPenpotState("phase-complete");
              const summary = formatPenpotStateSummary(nextState);
              if (summary) {
                appendPipelineText(`\n${summary}\n`);
              }
            })();
          }
          break;

        case "awaiting_input":
          setAwaitingFreeText((evt.prompt as string) ?? "Enter your response:");
          setAgentStep("Awaiting your input...");
          break;

        case "error":
          setAgentStep(null);
          appendPipelineText(`\nError: ${evt.message}\n`);
          break;

        case "stream_end":
          setPipelineRunning(false);
          setAgentRunning(false);
          setAgentStep(null);
          clearBridgeMode();
          break;

        case "design_updated":
          appendPipelineText(
            `\nDesign updated from browser — ${((evt as any).files_updated?.length) ?? 0} file(s) refreshed.\n`
          );
          setAgentStep(null);
          void (async () => {
            const nextState = await refreshPenpotState("design-updated");
            const summary = formatPenpotStateSummary(nextState);
            if (summary) {
              appendPipelineText(`${summary}\n`);
            }
          })();
          break;

        default:
          break;
      }
    },
    [addMessage, appendPipelineText, clearBridgeMode, formatPenpotStateSummary, refreshPenpotState, setAgentRunning, setAgentStep],
  );

  const runPipelinePhase = useCallback(
    async (phase: number, sessionId: string) => {
      if (!bridgeMode) return;
      setCurrentPhase(phase);
      setAgentStep(`> ${PHASE_LABELS[phase] ?? `Phase ${phase}`}…`);

      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `\n[Rocket] ${PHASE_LABELS[phase] ?? `Phase ${phase}`}\n`,
        createdAt: new Date(),
        isStreaming: false,
      });

      abortRef.current = new AbortController();
      await runSinglePhase(
        sessionId,
        phase,
        handlePipelineEvent,
        abortRef.current.signal,
      );
    },
    [bridgeMode, projectDir, addMessage, setAgentStep, handlePipelineEvent],
  );

  // Start native pipeline on mount if bridgeMode is set
  useEffect(() => {
    if (!bridgeMode || sentInitial.current) return;
    sentInitial.current = true;
    setPipelineRunning(true);
    setAgentRunning(true);

    (async () => {
      try {
        const session = createSession({
          projectDir: projectDir ?? process.cwd(),
          userPrompt: bridgeMode.userPrompt,
          userId: bridgeMode.userId,
          userPlan: bridgeMode.userPlan,
          isYolo: bridgeMode.isYolo,
        });
        setPipelineSessionId(session.id);

        const startPhase = Math.max(1, Math.min(6, Number(bridgeMode.startPhase ?? 1)));
        const endPhaseRaw = Number(bridgeMode.endPhase ?? 6);
        const endPhase = Math.max(startPhase, Math.min(6, endPhaseRaw));

        abortRef.current = new AbortController();
        await runPipeline(
          session.id,
          startPhase,
          handlePipelineEvent,
          abortRef.current.signal,
          endPhase,
        );

        setPipelineRunning(false);
        setAgentRunning(false);
        setAgentStep(null);
        clearBridgeMode();
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            startPhase === endPhase
              ? `\n[Party] ${PHASE_LABELS[startPhase] ?? `Phase ${startPhase}`} complete.\n`
              : `\n[Party] Phases ${startPhase}-${endPhase} complete! Your application has been built.\n`,
          createdAt: new Date(),
          isStreaming: false,
        });
      } catch (err) {
        setPipelineRunning(false);
        setAgentRunning(false);
        setAgentStep(null);
        clearBridgeMode();
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `\n[X] Pipeline failed: ${String(err)}\n`,
          createdAt: new Date(),
          isStreaming: false,
        });
        logger.debug("Bridge pipeline error", err);
      }
    })();
  }, [bridgeMode, addMessage, clearBridgeMode, handlePipelineEvent, projectDir, refreshPenpotState, setAgentRunning, setAgentStep, token]);

  // -----------------------------------------------------------------
  // HIL choice submission
  const submitPipelineChoice = useCallback(
    async (value: string | string[]) => {
      if (!pipelineSessionId || !pendingChoice) return;
      setPendingChoice(null);
      setAgentStep(`> Continuing…`);
      try {
        sendPipelineInput(pipelineSessionId, Array.isArray(value) ? JSON.stringify(value) : value);
      } catch (err) {
        logger.debug("sendPipelineInput error", err);
      }
    },
    [pipelineSessionId, pendingChoice, setAgentStep],
  );

  const handleChoiceSelect = useCallback(
    async (item: { value: string; label: string }) => {
      await submitPipelineChoice(item.value);
    },
    [submitPipelineChoice],
  );

  // Memoize choice items to prevent SelectInput from resetting on every render
  const choiceItems = useMemo(() => {
    if (!pendingChoice) return [];
    return pendingChoice.choices.map((c) => ({
      value: c.id,
      label: c.label,
    }));
  }, [pendingChoice]);

  // Handle free-text input for awaiting_input SSE events
  const handleFreeTextSubmit = useCallback(
    async (text: string) => {
      if (!pipelineSessionId || !awaitingFreeText) return;
      setAwaitingFreeText(null);
      setAgentStep("> Continuing…");
      appendPipelineText(`\n[Pen]  You: ${text}\n`);
      try {
        sendPipelineInput(pipelineSessionId, text);
      } catch (err) {
        logger.debug("sendFreeTextInput error", err);
      }
    },
    [pipelineSessionId, awaitingFreeText, setAgentStep, appendPipelineText],
  );

  // -----------------------------------------------------------------
  // Normal agent mode (direct AI streaming)
  // -----------------------------------------------------------------

  const runAnsSideThread = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) {
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Usage: `/ans <question>`\n\nAsk a side-thread question without interrupting the current task.",
        createdAt: new Date(),
        isStreaming: false,
      });
      return;
    }

    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `/ans ${question}`,
      createdAt: new Date(),
      isStreaming: false,
    });

    const answerMessageId = crypto.randomUUID();
    addMessage({
      id: answerMessageId,
      role: "assistant",
      content: `**Side answer**\n\nThinking about: ${question}`,
      createdAt: new Date(),
      isStreaming: false,
    });

    try {
      const localKey = process.env.OPENROUTER_API_KEY;
      const useProxy = !localKey || process.env.PAKALON_USE_PROXY === "1";
      const result = await generateSideAnswer({
        question,
        messages: messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) as CoreMessage[],
        model: selectedModel ?? DEFAULT_FREE_MODEL_ID,
        apiKey: localKey || undefined,
        authToken: useProxy ? (token ?? undefined) : undefined,
        useProxy,
        privacyLevel,
        thinkingEnabled,
        modelEffortConfig: useStore.getState().modelEffortConfig,
      });
      updateMessageById(answerMessageId, {
        content: `**Side answer**\n\n${result.text.trim() || "_No answer returned._"}`,
        isStreaming: false,
      });
    } catch (err) {
      updateMessageById(answerMessageId, {
        content: `**Side answer failed**\n\n${formatAgentError(err)}`,
        isStreaming: false,
      });
    }
  }, [addMessage, formatAgentError, messages, privacyLevel, selectedModel, thinkingEnabled, token, updateMessageById]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (agentBusy) {
        const trimmedBusyText = text.trim();
        if (trimmedBusyText.toLowerCase().startsWith("/ans")) {
          await runAnsSideThread(trimmedBusyText.replace(/^\/ans\b/i, ""));
        }
        return;
      }
      if (text.trim().toLowerCase().startsWith("/ans")) {
        await runAnsSideThread(text.trim().replace(/^\/ans\b/i, ""));
        return;
      }
      if (text.startsWith("/clear")) {
        useStore.getState().clearMessages();
        stepCount.current = 0;
        setAgentStep(null);
        return;
      }

      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: text,
        createdAt: new Date(),
        isStreaming: false,
      };
      addMessage(userMsg);
      setAgentRunning(true);

      stepCount.current++;
      setAgentStep(`Step ${stepCount.current}: Thinking…`);

      const coreMessages: CoreMessage[] = messages
        .filter((m) => m.role !== "system")
        .concat(userMsg)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const trimmed = trimToContextWindow(coreMessages, 80000);

      const localKey = process.env.OPENROUTER_API_KEY;
      const useProxy = !localKey || process.env.PAKALON_USE_PROXY === "1";
      const mergedToolsRaw = { ...allTools, ...mcpToolsRef.current };
      const mergedTools = Object.fromEntries(
        Object.entries(mergedToolsRaw).filter(([, def]) => typeof (def as { execute?: unknown })?.execute === "function"),
      ) as ToolSet;
      const droppedTools = Object.keys(mergedToolsRaw).length - Object.keys(mergedTools).length;
      if (droppedTools > 0) {
        logger.warn("[AgentScreen] Ignoring tools without executable handlers", {
          droppedTools,
          totalTools: Object.keys(mergedToolsRaw).length,
        });
      }

      // Enrich system prompt with relevant memories from in-process store.
      let memoryContext = "";
      try {
        const userId = useStore.getState().userId ?? "anonymous";
        const memResult = searchMemories({
          userId,
          query: text,
          topK: 5,
        });
        if (memResult.entries && memResult.entries.length > 0) {
          memoryContext =
            "\n\n## Relevant Memories\n" +
            memResult.entries
              .map((m) => `- ${m.text}`)
              .join("\n");
        }
      } catch {
        // Memory search unavailable — continue without memory context
      }

      const enrichedSystem = AGENT_SYSTEM + memoryContext + skillContextRef.current;
      const agentSystem = buildSystemWithContext(enrichedSystem, []);

      const toolEnabledAssistantLoop = permissionMode !== "orchestration" && Object.keys(mergedTools).length > 0;

      if (toolEnabledAssistantLoop) {
    setProxyToolLoopRunning(true);
    try {
      const summarizeToolValue = (value: unknown) => {
        const textValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        return textValue.length > 1200 ? `${textValue.slice(0, 1200)}\n...[truncated]` : textValue;
      };

      const result = await runProxyToolLoop({
        model: selectedModel ?? DEFAULT_FREE_MODEL_ID,
        messages: trimmed,
        apiKey: localKey || undefined,
        useProxy,
        authToken: token ?? undefined,
        privacyLevel,
        thinkingEnabled,
        projectDir: effectiveProjectDir,
        system: agentSystem,
        tools: mergedTools,
        onToolCall: (toolName, input, note) => {
          setAgentStep(`Step ${stepCount.current}: ${toolName}`);
          // Lazy import to avoid circular deps
          import("@/ai/tool-display.js").then(({ formatToolCall }) => {
            addMessage({
              id: crypto.randomUUID(),
              role: "tool",
              content: formatToolCall(toolName, input, note),
              createdAt: new Date(),
              isStreaming: false,
            });
          }).catch(() => {
            addMessage({
              id: crypto.randomUUID(),
              role: "tool",
              content: `${note ? `${note}\n` : ""}${toolName} ${JSON.stringify(input)}`,
              createdAt: new Date(),
              isStreaming: false,
            });
          });
        },
        onToolResult: (toolName, value) => {
          import("@/ai/tool-display.js").then(({ formatToolResult }) => {
            const display = formatToolResult(toolName, value);
            if (display) {
              addMessage({
                id: crypto.randomUUID(),
                role: "tool",
                content: display,
                createdAt: new Date(),
                isStreaming: false,
              });
            }
          }).catch(() => {
            addMessage({
              id: crypto.randomUUID(),
              role: "tool",
              content: `${toolName} result\n${summarizeToolValue(value)}`,
              createdAt: new Date(),
              isStreaming: false,
            });
          });
        },
      });

      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.finalText,
        createdAt: new Date(),
        isStreaming: false,
      });
    } catch (err) {
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Agent error: ${formatAgentError(err)}`,
        createdAt: new Date(),
        isStreaming: false,
      });
    } finally {
      setProxyToolLoopRunning(false);
      setAgentRunning(false);
      setAgentStep(null);
    }
    return;
    }

    const streamingId = crypto.randomUUID();
    addMessage({
    id: streamingId,
    role: "assistant",
    content: "",
    createdAt: new Date(),
    isStreaming: true,
    });

    resetStreaming();

      await handleStream({
        model: selectedModel ?? DEFAULT_FREE_MODEL_ID,
        messages: trimmed,
        apiKey: localKey || undefined,
        authToken: useProxy ? (token ?? undefined) : undefined,
        useProxy,
        system: agentSystem,
        thinkingEnabled,
        tools: Object.keys(mergedTools).length > 0 ? mergedTools : undefined,
        onThinkChunk: (chunk) => {
          setThinkContent((prev: string) => prev + chunk);
          setAgentStep(`Step ${stepCount.current}: Reasoning…`);
        },
        onTextChunk: (chunk) => {
          appendStreamChunk(chunk);
          useStore.getState().appendToLastMessage(chunk);
        },
        onFinish: (_text, usage) => {
          finalizeStreamingMessage();
          resetStreaming();
          setAgentRunning(false);
          setAgentStep(null);
          logger.debug("Agent step done", usage);
        },
        onError: (err) => {
          finalizeStreamingMessage();
          resetStreaming();
          setAgentRunning(false);
          setAgentStep(null);
          useStore.getState().updateLastMessage({
            content: `Agent error: ${err.message}`,
            isStreaming: false,
          });
        },
      });
    },
    [agentBusy, effectiveProjectDir, privacyLevel, permissionMode, token, selectedModel, messages, addMessage, finalizeStreamingMessage, appendStreamChunk, setAgentRunning, setThinkContent, resetStreaming, setAgentStep, thinkingEnabled, formatAgentError, runAnsSideThread]
  );

  const handleBridgeSideInput = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase().startsWith("/ans")) {
      await runAnsSideThread(trimmed.replace(/^\/ans\b/i, ""));
      return;
    }
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "The phase pipeline is running. Use `/ans <question>` for side-thread Q&A, or answer the active HIL prompt.",
      createdAt: new Date(),
      isStreaming: false,
    });
  }, [addMessage, runAnsSideThread]);

  useEffect(() => {
    if (!bridgeMode && initialTask && !sentInitial.current) {
      sentInitial.current = true;
      handleSubmit(initialTask);
    }
  }, [initialTask, handleSubmit, bridgeMode]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // Abort bridge stream if running
      abortRef.current?.abort();
      exit();
      return;
    }

    if (
      bridgeMode &&
      !awaitingFreeText &&
      key.ctrl &&
      (input === "o" || input === "O")
    ) {
      void openCurrentPenpotDesign(pendingChoice ? "hil-prompt" : "bridge-panel");
    }
  });

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box paddingX={1} gap={2}>
        <Text bold color="magenta">PAKALON AGENT</Text>
        {projectDir && <Text dimColor>{projectDir}</Text>}
        <Text
          color={
            permissionMode === "orchestration"
              ? "yellow"
              : permissionMode === "auto-accept"
                ? "#ff8c00"
                : permissionMode === "plan"
                  ? "#ff8c00"
                  : "white"
          }
        >
          mode: {permissionMode}
        </Text>
        {/* Phase progress indicator */}
        {currentPhase !== null && (
          <Text color="#ff8c00">
            Phase {currentPhase}/6
          </Text>
        )}
      </Box>

      {/* Current step / spinner */}
      {agentBusy && (
        <Box flexDirection="column" gap={1} paddingX={1}>
          <Box gap={1}>
            <Text color="#ff8c00">*</Text>
            <Text color="#ff8c00">{agentCurrentStep ?? "Agent running…"}</Text>
          </Box>
        </Box>
      )}

      {bridgeMode && penpotState?.fileId && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginX={1}
        >
          <Text color="cyan" bold>Penpot design</Text>
          <Text>{penpotState.fileUrl ?? penpotState.projectUrl ?? penpotState.baseUrl}</Text>
          <Text dimColor>
            file {penpotState.fileId}
            {penpotState.revision !== null ? ` • rev ${penpotState.revision}` : ""}
            {penpotState.status ? ` • ${penpotState.status}` : ""}
          </Text>
          {(penpotState.localSvgPath || penpotState.localJsonPath) && (
            <Text dimColor>
              {penpotState.localSvgPath ? `svg ${path.basename(penpotState.localSvgPath)}` : ""}
              {penpotState.localSvgPath && penpotState.localJsonPath ? " • " : ""}
              {penpotState.localJsonPath ? `json ${path.basename(penpotState.localJsonPath)}` : ""}
            </Text>
          )}
          <Text dimColor>
            {openingPenpot ? "Opening current design…" : "Press Ctrl+O to open the current Penpot design"}
          </Text>
        </Box>
      )}

      {/* Message list */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <MessageList messages={messages} assistantBusy={agentBusy} />
      </Box>

      {/* HIL Choice UI — rendered when a choice_request/approval_request is pending */}
      {pendingChoice && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginX={1}
        >
          <Text bold color="yellow">
            [Wave] {pendingChoice.question}
          </Text>
          <Text dimColor>{pendingChoice.message}</Text>
          {penpotState?.fileId && (
            <Box
              flexDirection="column"
              borderStyle="single"
              borderColor="cyan"
              paddingX={1}
              marginTop={1}
            >
              <Text color="cyan" bold>Current Penpot state</Text>
              <Text>{penpotState.fileUrl ?? penpotState.projectUrl ?? penpotState.baseUrl}</Text>
              <Text dimColor>
                file {penpotState.fileId}
                {penpotState.revision !== null ? ` • rev ${penpotState.revision}` : ""}
                {penpotState.status ? ` • ${penpotState.status}` : ""}
              </Text>
              {(penpotState.localSvgPath || penpotState.localJsonPath) && (
                <Text dimColor>
                  {penpotState.localSvgPath ? `svg ${path.basename(penpotState.localSvgPath)}` : ""}
                  {penpotState.localSvgPath && penpotState.localJsonPath ? " • " : ""}
                  {penpotState.localJsonPath ? `json ${path.basename(penpotState.localJsonPath)}` : ""}
                </Text>
              )}
              <Text dimColor>
                {openingPenpot
                  ? "Opening current design…"
                  : "Press Ctrl+O to open the current Penpot design before you choose"}
              </Text>
            </Box>
          )}
          {pendingChoice.questionIndex !== undefined ? (
            <Phase1QASession
              request={{
                type: "choice_request",
                message: pendingChoice.message,
                question: pendingChoice.question,
                choices: pendingChoice.choices,
                question_index: pendingChoice.questionIndex,
                total_questions: pendingChoice.totalQuestions ?? 1,
                multi_select: pendingChoice.multiSelect,
                allow_other: pendingChoice.allowOther,
                _requestId: pendingChoice.requestId ?? "phase-choice",
              }}
              onSubmit={submitPipelineChoice}
            />
          ) : (
            <>
              <SelectInput
                items={choiceItems}
                onSelect={handleChoiceSelect}
              />
              <Text dimColor>Use ↑↓ arrows, Enter to select</Text>
            </>
          )}
        </Box>
      )}

      {/* Free-text input — shown when awaiting_input event received (e.g. Phase 2 design modification) */}
      {awaitingFreeText && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#ff8c00"
          paddingX={1}
          marginX={1}
        >
          <Text bold color="#ff8c00">[Pen]  {awaitingFreeText}</Text>
          <InputBar onSubmit={handleFreeTextSubmit} isDisabled={false} />
        </Box>
      )}

      {/* Input bar — hidden during pipeline mode (input is only via HIL choices) */}
      {bridgeMode && !awaitingFreeText && (
        <InputBar
          onSubmit={handleBridgeSideInput}
          isDisabled={false}
          mode="agent"
          historyItems={historyItems}
        />
      )}

      {!bridgeMode && (
        <InputBar
          onSubmit={handleSubmit}
          isDisabled={false}
          mode="agent"
          historyItems={historyItems}
        />
      )}
      <StatusLine modelId={selectedModel} />
    </Box>
  );
};

export default AgentScreen;
