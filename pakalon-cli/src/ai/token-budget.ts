import type { ModelMessage as CoreMessage, ToolSet } from "ai";
import { estimateMessagesTokens, trimToContextWindow } from "@/ai/context.js";
import { getBudgetContinuationMessage } from "@/ai/budget-continuation.js";
import type { PermissionMode } from "@/store/slices/mode.slice.js";
import { isSelfHosted } from "@/config/mode.js";
import { microcompactMessages } from "@/ai/microcompact.js";
import { snipCompactIfNeeded } from "@/ai/snip.js";
import { collapseSearchReadSequences } from "@/ai/context-collapse.js";
import { trySessionMemoryCompaction } from "@/ai/session-memory-compact.js";

export interface BudgetTracker {
  continuationCount: number;
  lastDeltaTokens: number;
  lastGlobalTurnTokens: number;
  startedAt: number;
  lastContinuationAt?: number;
  diminishingReturnsDetected?: boolean;
}

export interface TokenBudgetLimits {
  turnBudget?: number | null;
  taskBudget?: { total: number; remaining?: number } | null;
  maxTurns?: number | null;
}

export interface TokenEfficientMessageOptions {
  projectDir?: string;
  keepTail?: number;
}

export type TokenBudgetDecision =
  | {
      action: "continue";
      nudgeMessage: string;
      continuationCount: number;
      pct: number;
      turnTokens: number;
      budget: number;
    }
  | {
      action: "stop";
      completionEvent: {
        continuationCount: number;
        pct: number;
        turnTokens: number;
        budget: number;
        diminishingReturns: boolean;
        durationMs: number;
      } | null;
    };

const SIMPLE_CONTEXT_BUDGET = 8_000;
const TOOL_CONTEXT_BUDGET = 32_000;
const MIN_CONTEXT_BUDGET = 2_000;
const COMPLETION_THRESHOLD = 0.9;
const DIMINISHING_THRESHOLD = 500;

const TOOL_ACTION_RE =
  /\b(add|append|change|update|modify|edit|fix|remove|delete|rename|create|write|insert|replace|implement|refactor|patch|inspect|read|open|list|show|find|search|run|execute|test|build|install|debug|commit|diff|grep|scan)\b/i;

const PROJECT_ARTIFACT_RE =
  /\b(app|application|cli|file|files|folder|directory|project|repo|repository|workspace|codebase|source|component|module|function|class|test|tests|package|config|tsconfig|readme|bug|issue|problem|error|stack|command|terminal|context|progress|cursor|screen|ui)\b/i;

const MENTIONED_ARTIFACT_RE = /(?:^|\s)@[A-Za-z0-9_.\-\/\\]+(?:\.[A-Za-z0-9]+)?/;
const PATH_RE = /(?:^|\s)(?:[A-Za-z0-9_.-]+[/\\][^\s]+|[A-Za-z]:[\\/][^\s]+)/;
const FILE_NAME_RE =
  /(?:^|\s)[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml|sh|env|css|html|txt)(?:\s|$)/i;

const WEB_RE = /\b(web|url|http|https|browser|fetch|search online|internet)\b/i;
const MEDIA_RE = /\b(image|photo|picture|video|audio|screenshot|media)\b/i;
const MEMORY_RE = /\b(memory|remember|recall|notes|knowledge)\b/i;
const TEAM_RE = /\b(agent|team|orchestrate|parallel)\b/i;
const NOTEBOOK_RE = /\b(notebook|jupyter|ipynb)\b/i;
const MCP_RE = /\b(mcp|resource|resources|server|servers)\b/i;

const BASE_TOOL_NAMES = [
  "readFile",
  "listDir",
  "globFind",
  "grepSearch",
  "view",
  "rg",
  "editFile",
  "multiEditFiles",
  "writeFile",
  process.platform === "win32" ? "powershell" : "bash",
  "bash",
];

const TASK_TOOL_NAMES = [
  "lspDiagnostics",
  "lspSymbols",
  "secureExec",
  "justbash",
  "just-bash",
  "toolSearch",
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "application",
  "are",
  "because",
  "been",
  "before",
  "being",
  "can",
  "could",
  "from",
  "have",
  "into",
  "make",
  "more",
  "only",
  "please",
  "should",
  "that",
  "the",
  "this",
  "with",
  "would",
  "your",
]);

function getPromptKeywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 20);
}

function toolDescription(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "";
  const description = (tool as { description?: unknown }).description;
  return typeof description === "string" ? description.toLowerCase() : "";
}

function addTool(
  selected: Map<string, ToolSet[string]>,
  tools: ToolSet,
  name: string,
): void {
  const tool = tools[name];
  if (tool) selected.set(name, tool);
}

export function shouldUseToolLoopForPrompt(
  prompt: string,
  permissionMode: PermissionMode,
  availableToolCount: number,
): boolean {
  if (permissionMode === "orchestration" || availableToolCount === 0) return false;
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (MENTIONED_ARTIFACT_RE.test(trimmed)) return true;
  if ((PATH_RE.test(trimmed) || FILE_NAME_RE.test(trimmed)) && TOOL_ACTION_RE.test(trimmed)) return true;
  return TOOL_ACTION_RE.test(trimmed) && PROJECT_ARTIFACT_RE.test(trimmed);
}

export function selectTokenEfficientTools(
  tools: ToolSet,
  prompt: string,
  maxTools = 14,
): ToolSet {
  const selected = new Map<string, ToolSet[string]>();
  for (const name of BASE_TOOL_NAMES) {
    addTool(selected, tools, name);
  }

  const lowerPrompt = prompt.toLowerCase();
  if (TOOL_ACTION_RE.test(prompt)) {
    for (const name of TASK_TOOL_NAMES) addTool(selected, tools, name);
  }
  if (WEB_RE.test(prompt)) {
    addTool(selected, tools, "webFetch");
    addTool(selected, tools, "webSearch");
  }
  if (MEDIA_RE.test(prompt)) {
    addTool(selected, tools, "imageAnalysis");
    addTool(selected, tools, "videoAnalysis");
    addTool(selected, tools, "generateImage");
    addTool(selected, tools, "generateVideo");
  }
  if (MEMORY_RE.test(prompt)) {
    addTool(selected, tools, "memorySearch");
    addTool(selected, tools, "memoryStore");
  }
  if (TEAM_RE.test(prompt)) {
    addTool(selected, tools, "orchestrate");
    addTool(selected, tools, "agent");
    addTool(selected, tools, "task");
    addTool(selected, tools, "taskList");
    addTool(selected, tools, "teamCreate");
    addTool(selected, tools, "sendMessage");
  }
  if (NOTEBOOK_RE.test(prompt)) {
    addTool(selected, tools, "notebookRead");
    addTool(selected, tools, "notebookEdit");
  }
  if (MCP_RE.test(prompt)) {
    addTool(selected, tools, "mcpAuth");
    addTool(selected, tools, "mcpResources");
    addTool(selected, tools, "mcpResourceSearch");
  }

  const keywords = getPromptKeywords(prompt);
  for (const [name, tool] of Object.entries(tools)) {
    if (selected.size >= maxTools) break;
    const haystack = `${name.toLowerCase()} ${toolDescription(tool)}`;
    if (keywords.some((keyword) => haystack.includes(keyword) || lowerPrompt.includes(name.toLowerCase()))) {
      selected.set(name, tool);
    }
  }

  return Object.fromEntries([...selected.entries()].slice(0, maxTools)) as ToolSet;
}

export function buildTokenEfficientMessages(
  messages: CoreMessage[],
  contextLimit: number,
  useTools: boolean,
  options: TokenEfficientMessageOptions = {},
): CoreMessage[] {
  const hardLimit = Math.max(MIN_CONTEXT_BUDGET, contextLimit - 2_000);
  const targetBudget = Math.min(hardLimit, useTools ? TOOL_CONTEXT_BUDGET : SIMPLE_CONTEXT_BUDGET);
  const keepTail = options.keepTail ?? (useTools ? 8 : 6);
  const microcompacted = microcompactMessages(messages, {
    keepLatestToolResults: useTools ? 12 : 6,
  }).messages;
  const collapsed = collapseSearchReadSequences(microcompacted, {
    minSequenceLength: useTools ? 3 : 2,
    maxInlineChars: useTools ? 1_200 : 800,
  }).messages;
  const snipped = snipCompactIfNeeded(collapsed, {
    maxTokens: targetBudget,
    keepLatestGroups: useTools ? 4 : 3,
  }).messages;
  const memoryFallback = trySessionMemoryCompaction(snipped, {
    maxTokens: targetBudget,
    projectDir: options.projectDir,
    keepTail,
  });
  return trimToContextWindow(memoryFallback.messages, targetBudget, keepTail);
}

export function estimateRequestContextTokens(messages: CoreMessage[], system: string): number {
  return estimateMessagesTokens(messages) + Math.ceil(system.length / 4);
}

export function createBudgetTracker(): BudgetTracker {
  return {
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
    diminishingReturnsDetected: false,
  };
}

function resolveBudget(limits: TokenBudgetLimits, globalTurnTokens: number): number | null {
  if (limits.turnBudget && limits.turnBudget > 0) return limits.turnBudget;
  if (limits.taskBudget?.total && limits.taskBudget.total > 0) return limits.taskBudget.total;
  return globalTurnTokens > 0 ? globalTurnTokens : null;
}

export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  limits: TokenBudgetLimits,
  globalTurnTokens: number,
  turnCount = 0,
): TokenBudgetDecision {
  if (isSelfHosted()) {
    return { action: "stop", completionEvent: null };
  }

  const budget = resolveBudget(limits, globalTurnTokens);
  if (agentId || budget === null) return { action: "stop", completionEvent: null };
  if (limits.maxTurns !== null && limits.maxTurns !== undefined && limits.maxTurns > 0 && turnCount >= limits.maxTurns) {
    return {
      action: "stop",
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct: Math.round((globalTurnTokens / budget) * 100),
        turnTokens: globalTurnTokens,
        budget,
        diminishingReturns: false,
        durationMs: Date.now() - tracker.startedAt,
      },
    };
  }

  const turnTokens = globalTurnTokens;
  const pct = Math.round((turnTokens / budget) * 100);
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens;
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD;

  if (isDiminishing) {
    tracker.diminishingReturnsDetected = true;
    return {
      action: "stop",
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct,
        turnTokens,
        budget,
        diminishingReturns: true,
        durationMs: Date.now() - tracker.startedAt,
      },
    };
  }

  if (turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount += 1;
    tracker.lastDeltaTokens = deltaSinceLastCheck;
    tracker.lastGlobalTurnTokens = globalTurnTokens;
    tracker.lastContinuationAt = Date.now();
    return {
      action: "continue",
      nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget),
      continuationCount: tracker.continuationCount,
      pct,
      turnTokens,
      budget,
    };
  }

  if (tracker.continuationCount > 0) {
    return {
      action: "stop",
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct,
        turnTokens,
        budget,
        diminishingReturns: false,
        durationMs: Date.now() - tracker.startedAt,
      },
    };
  }

  return { action: "stop", completionEvent: null };
}
