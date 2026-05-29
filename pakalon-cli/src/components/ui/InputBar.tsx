/**
 * InputBar — user text input with slash-command detection and @agent autocomplete.
 *
 * Design: Golden separator line with prompt input
 * ───────────────────────────────────────────────────────────────
 * › <input message or /help>
 * ───────────────────────────────────────────────────────────────
 *
 * Keyboard shortcuts:
 *   Shift+Tab  → cycle visible interaction mode
 *   Ctrl+O     → toggle verbose panel (T164)
 *   Enter      → submit
 *
 * @ Autocomplete (T-CLI-10 / T-CLI-P9): When input contains "@", shows a filterable
 * list of configured agents with their name, description, and model.
 * Selecting one inserts @agentname into the message.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useStore } from "@/store/index.js";
import type { PermissionMode } from "@/store/slices/mode.slice.js";
import { readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";
// T-MCP-07: MCP resource mentions
import { getMcpResources, getMcpPromptCommands } from "@/mcp/manager.js";
import {
  getSlashCommandSuggestions,
  type SlashCommandSuggestion,
} from "@/commands/slash-registry.js";
import { PAKALON_GOLD, PAKALON_BLUE, TEXT_SECONDARY } from "@/constants/colors.js";
import { getShellWidth, makeHorizontalRule } from "@/utils/shell-layout.js";

// T-CLI-P9: Rich agent suggestion items including description and color
interface AgentSuggestion {
  name: string; // "@agent-name"
  description: string;
  color: string;
}

let _agentSuggestions: AgentSuggestion[] | null = null;

function getAgentSuggestions(): AgentSuggestion[] {
  if (_agentSuggestions) return _agentSuggestions;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAllAgents } = require("@/commands/agents.js") as {
      getAllAgents: () => Array<{
        name: string;
        description?: string;
        color?: string;
      }>;
    };
    _agentSuggestions = getAllAgents().map((a) => ({
      name: `@${a.name.toLowerCase().replace(/\s+/g, "-")}`,
      description: a.description ?? "",
      color: a.color ?? "orange",
    }));
  } catch {
    _agentSuggestions = [];
  }
  return _agentSuggestions;
}

/** Legacy helper kept for compatibility */
function getAgentNames(): string[] {
  return getAgentSuggestions().map((s) => s.name);
}

// T-CLI-09: Enumerate source files from cwd for @file autocomplete
const FILE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".env",
]);
const MAX_FILES = 200; // limit scan depth
let _fileSuggestions: string[] | null = null;
let _fileScanDir: string | null = null;

function scanFiles(
  dir: string,
  base: string,
  results: string[],
  depth = 0,
): void {
  if (depth > 4 || results.length >= MAX_FILES) return;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (
        entry.startsWith(".") ||
        entry === "node_modules" ||
        entry === "__pycache__" ||
        entry === "dist" ||
        entry === "build"
      )
        continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(`${relative(base, full).replace(/\\/g, "/")}/`);
          scanFiles(full, base, results, depth + 1);
        } else if (FILE_EXTS.has(extname(entry).toLowerCase())) {
          results.push(relative(base, full).replace(/\\/g, "/"));
        }
      } catch {
        /* skip unreadable */
      }
      if (results.length >= MAX_FILES) return;
    }
  } catch {
    /* skip unreadable dir */
  }
}

// T-MCP-07: Cached MCP resource list — refreshed once per session
interface McpResourceItem {
  server: string;
  uri: string;
  name: string;
  description?: string;
}
let _mcpResourceCache: McpResourceItem[] | null = null;
let _mcpResourceFetchPending = false;

function getMcpResourceSuggestions(): McpResourceItem[] {
  return _mcpResourceCache ?? [];
}

async function ensureMcpResourceCache(): Promise<void> {
  if (_mcpResourceCache !== null || _mcpResourceFetchPending) return;
  _mcpResourceFetchPending = true;
  try {
    const results = await getMcpResources();
    _mcpResourceCache = [];
    for (const { server, resources } of results) {
      for (const r of resources as Array<{
        uri: string;
        name?: string;
        description?: string;
      }>) {
        _mcpResourceCache.push({
          server,
          uri: r.uri ?? "",
          name: r.name ?? r.uri ?? "",
          description: r.description,
        });
      }
    }
  } catch {
    _mcpResourceCache = [];
  } finally {
    _mcpResourceFetchPending = false;
  }
}

function getFileSuggestions(cwd: string): string[] {
  if (_fileSuggestions && _fileScanDir === cwd) return _fileSuggestions;
  const results: string[] = [];
  scanFiles(cwd, cwd, results);
  _fileSuggestions = results.sort();
  _fileScanDir = cwd;
  return _fileSuggestions;
}

interface InputBarProps {
  onSubmit: (value: string) => void;
  isDisabled?: boolean | undefined;
  /** Overrides the displayed mode label (e.g. "agent"). Falls back to permissionMode from store. */
  mode?: string | undefined;
  /** T-CLI-80: Vim mode — enables normal/insert/visual key handling */
  vimMode?: boolean | undefined;
  /** T-CLI-09: project directory for @file autocomplete */
  projectDir?: string | undefined;
  /** T-CLI-57: Prior user messages for ghost-text prompt suggestions */
  historyItems?: string[] | undefined;
  /** Accent color mode inherited from chat mode */
  colorMode?: "orange" | "blue" | "red" | "green" | undefined;
  /** Callback when ESC is pressed twice to stop AI agent */
  onStop?: () => void;
  /** Slash prefixes that may still submit while the assistant is busy. */
  enabledWhileDisabledPrefixes?: string[];
  /** Replace the current prompt content from an external selection flow. */
  seedValue?: string | undefined;
  shellWidth?: number;
}

function getDynamicSlashSuggestions(query: string): SlashCommandSuggestion[] {
  const suggestions = new Map<string, SlashCommandSuggestion>();

  for (const suggestion of getSlashCommandSuggestions(query)) {
    suggestions.set(suggestion.insertValue.trimEnd(), suggestion);
  }

  try {
    for (const prompt of getMcpPromptCommands()) {
      const normalizedPrompt = prompt.trimEnd();
      if (query && !normalizedPrompt.slice(1).toLowerCase().includes(query)) {
        continue;
      }
      if (!suggestions.has(normalizedPrompt)) {
        suggestions.set(normalizedPrompt, {
          label: normalizedPrompt,
          insertValue: prompt,
          description: "Run an MCP prompt",
        });
      }
    }
  } catch {
    /* ignore */
  }

  return [...suggestions.values()];
}

const PERMISSION_MODE_COLORS: Record<PermissionMode, string> = {
  plan: "dynamic",
  "auto-accept": "dynamic",
  orchestration: "dynamic",
  normal: "dynamic",
};

// T-CLI-P9: Rich dropdown item — includes description for agent suggestions
interface RichSelectItem {
  label: string;
  value: string;
  // Extra metadata for rendering
  description?: string;
  agentColor?: string;
}

function sameRichItems(a: RichSelectItem[], b: RichSelectItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      !!other &&
      item.label === other.label &&
      item.value === other.value &&
      item.description === other.description &&
      item.agentColor === other.agentColor
    );
  });
}

const CURSOR_MARKER = "\uE000";

interface WrappedInputRow {
  text: string;
  beforeCursor: string;
  afterCursor: string;
  hasCursor: boolean;
}

function wrapInputRows(value: string, cursor: number, width: number): WrappedInputRow[] {
  const safeWidth = Math.max(8, width);
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const text = `${value.slice(0, safeCursor)}${CURSOR_MARKER}${value.slice(safeCursor)}`;
  const rows: string[] = [""];
  let column = 0;

  for (const char of text) {
    if (char === "\r") continue;
    if (char === "\n") {
      rows.push("");
      column = 0;
      continue;
    }
    if (column >= safeWidth) {
      // Smart word-wrap: avoid breaking words in the middle of a line
      if (char !== " ") {
        const currentRow = rows[rows.length - 1];
        const lastSpace = currentRow.lastIndexOf(" ");
        if (lastSpace >= 0 && lastSpace < currentRow.length - 1) {
          // Move the incomplete word fragment to the next line
          const overflow = currentRow.slice(lastSpace + 1);
          rows[rows.length - 1] = currentRow.slice(0, lastSpace);
          rows.push(overflow);
          column = overflow.length;
        } else {
          // No word boundary found — single long word, wrap as-is
          rows.push("");
          column = 0;
        }
      } else {
        // Character is a space at the wrap point — skip it to avoid leading whitespace on new line
        rows.push("");
        column = 0;
        continue;
      }
    }
    rows[rows.length - 1] += char;
    column += 1;
  }

  return rows.map((row) => {
    const markerIndex = row.indexOf(CURSOR_MARKER);
    if (markerIndex === -1) {
      return { text: row, beforeCursor: "", afterCursor: "", hasCursor: false };
    }
    return {
      text: row.replace(CURSOR_MARKER, ""),
      beforeCursor: row.slice(0, markerIndex),
      afterCursor: row.slice(markerIndex + CURSOR_MARKER.length),
      hasCursor: true,
    };
  });
}

const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  isDisabled,
  mode,
  vimMode,
  projectDir,
  historyItems,
  colorMode = "orange",
  onStop,
  enabledWhileDisabledPrefixes = [],
  seedValue,
  shellWidth,
}) => {
  const [value, setValue] = useState("");
  const valueRef = useRef("");
  const cursorPosRef = useRef(0);
  const historyCursorRef = useRef(-1);
  const historyDraftRef = useRef("");
  const [atItems, setAtItems] = useState<RichSelectItem[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  // T-CLI-80: Vim mode state — "normal" waits for commands, "insert" allows typing
  const [vimEditMode, setVimEditMode] = useState<
    "normal" | "insert" | "visual"
  >("insert");
  const [cursorPos, setCursorPos] = useState(0);
  // dd pending state (kept for compat; superseded by pendingMotionRef)
  const pendingDRef = useRef(false);
  const suppressNextSubmitRef = useRef(false);
  const suppressSuggestionsRef = useRef(false);
  const pendingSuggestionSubmitRef = useRef(false);
  const skipPendingClearOnNextChangeRef = useRef(false);
  // ESC twice detection for stopping AI agent
  const lastEscTimeRef = useRef<number>(0);
  const ESC_DOUBLE_PRESS_THRESHOLD = 500; // milliseconds
  // T-CLI-80: Extended vim state
  const undoStackRef = useRef<string[]>([]); // undo history (max 50)
  const yankRef = useRef<string>(""); // yank/delete register
  const pendingMotionRef = useRef<string>(""); // accumulated multi-key sequence
  const visualAnchorRef = useRef<number>(0); // visual mode selection anchor
  const slashItems = React.useMemo(() => {
    if (suppressSuggestionsRef.current) return [] as SlashCommandSuggestion[];
    if (!value.startsWith("/")) return [] as SlashCommandSuggestion[];
    const query = value.slice(1).trim().toLowerCase();
    return getDynamicSlashSuggestions(query);
  }, [value]);

  const resolvedShellWidth = shellWidth ?? getShellWidth(process.stdout.columns ?? 80);
  const terminalRows = process.stdout.rows ?? 40;
  const compactTerminal = terminalRows < 24 || (process.stdout.columns ?? 80) < 88;
  const suggestionVisibleLimit = compactTerminal ? 14 : 50;
  const slashPreviewItems = slashItems.slice(0, suggestionVisibleLimit);
  const contentWidth: number | "100%" = shellWidth !== undefined ? "100%" : resolvedShellWidth;
  const containerJustify = shellWidth !== undefined ? "flex-start" : "center";

  const visibleSuggestions = React.useMemo<RichSelectItem[]>(() => {
    if (atItems.length > 0) return atItems;
    return slashPreviewItems.map((item) => ({
      label: item.label,
      value: item.insertValue,
      description: item.description,
      agentColor: "white", // All items white, selected item will be orange
    }));
  }, [atItems, slashPreviewItems]);

  // T-CLI-57: Ghost text — prefer slash command completion, otherwise use prompt history.
  const ghostSuggestion = React.useMemo(() => {
    if (value.startsWith("/")) {
      const bestMatch = slashItems[0];
      if (!bestMatch) return "";
      const target = bestMatch.insertValue;
      return target.toLowerCase().startsWith(value.toLowerCase())
        ? target.slice(value.length)
        : "";
    }

    if (!historyItems || value.length < 2) return "";
    const lv = value.toLowerCase();
    const match = historyItems.find(
      (h) => h.toLowerCase().startsWith(lv) && h.length > value.length,
    );
    return match ? match.slice(value.length) : "";
  }, [value, historyItems, slashItems]);
  const promptHistory = React.useMemo(
    () => (historyItems ?? []).map((item) => item.trim()).filter(Boolean),
    [historyItems],
  );

  const setInputState = useCallback((nextValue: string, nextCursor = nextValue.length) => {
    valueRef.current = nextValue;
    cursorPosRef.current = Math.max(0, Math.min(nextCursor, nextValue.length));
    setValue(nextValue);
    setCursorPos(cursorPosRef.current);
  }, []);

  const setCursorState = useCallback((nextCursor: number) => {
    const safeCursor = Math.max(0, Math.min(nextCursor, valueRef.current.length));
    cursorPosRef.current = safeCursor;
    setCursorPos(safeCursor);
  }, []);

  const resetHistoryNavigation = React.useCallback(() => {
    historyCursorRef.current = -1;
    historyDraftRef.current = "";
  }, []);

  const navigatePromptHistory = React.useCallback(
    (direction: "up" | "down") => {
      if (promptHistory.length === 0) return;

      if (direction === "up") {
        if (historyCursorRef.current === -1) {
          historyDraftRef.current = valueRef.current;
        }
        const nextCursor = Math.min(
          historyCursorRef.current + 1,
          promptHistory.length - 1,
        );
        const nextValue = promptHistory[nextCursor] ?? "";
        historyCursorRef.current = nextCursor;
        pendingSuggestionSubmitRef.current = false;
        suppressSuggestionsRef.current = true;
        setAtItems([]);
        setInputState(nextValue, nextValue.length);
        return;
      }

      if (historyCursorRef.current === -1) return;

      const nextCursor = historyCursorRef.current - 1;
      historyCursorRef.current = nextCursor;
      pendingSuggestionSubmitRef.current = false;
      suppressSuggestionsRef.current = true;
      setAtItems([]);

      if (nextCursor === -1) {
        const restoredValue = historyDraftRef.current;
        setInputState(restoredValue, restoredValue.length);
        return;
      }

      const nextValue = promptHistory[nextCursor] ?? "";
      setInputState(nextValue, nextValue.length);
    },
    [promptHistory, setInputState],
  );
  const permissionMode = useStore((s) => s.permissionMode);
  const toggleVerbose = useStore((s) => s.toggleVerbose);
  const inputActive = !isDisabled || enabledWhileDisabledPrefixes.length > 0;
  const accentColor = colorMode === "blue"
    ? PAKALON_BLUE
    : colorMode === "red"
      ? "#EF4444"
      : colorMode === "green"
        ? "#22C55E"
        : PAKALON_GOLD;

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

  const getLineBounds = useCallback((text: string, cursor: number) => {
    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const lineStart = Math.max(0, text.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1);
    const nextBreak = text.indexOf("\n", safeCursor);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    return { lineStart, lineEnd };
  }, []);

  const insertAtCursor = useCallback((inserted: string) => {
    if (!inserted) return;
    const current = valueRef.current;
    const currentCursor = cursorPosRef.current;
    const nextValue = current.slice(0, currentCursor) + inserted + current.slice(currentCursor);
    setInputState(nextValue, currentCursor + inserted.length);
    suppressSuggestionsRef.current = false;
    resetHistoryNavigation();
  }, [resetHistoryNavigation, setInputState]);

  const collapseMentionAtCursor = useCallback((currentValue: string, currentCursor: number) => {
    const beforeCursor = currentValue.slice(0, currentCursor);
    const afterCursor = currentValue.slice(currentCursor);

    const trailingSpaceMatch = beforeCursor.match(/(^|\s)(@[^@\s]+)\s$/);
    if (trailingSpaceMatch) {
      const token = trailingSpaceMatch[2] ?? "";
      const removeStart = beforeCursor.length - token.length - 1;
      return {
        value: `${beforeCursor.slice(0, Math.max(0, removeStart))}${afterCursor}`.replace(/\s{2,}/g, " "),
        cursor: Math.max(0, removeStart),
      };
    }

    const directMatch = beforeCursor.match(/(^|\s)(@[^@\s]+)$/);
    if (directMatch) {
      const token = directMatch[2] ?? "";
      const removeStart = beforeCursor.length - token.length;
      const leadingWhitespace = directMatch[1] ? 1 : 0;
      return {
        value: `${beforeCursor.slice(0, Math.max(0, removeStart - leadingWhitespace))}${afterCursor}`.replace(/\s{2,}/g, " "),
        cursor: Math.max(0, removeStart - leadingWhitespace),
      };
    }

    const slashMatch = beforeCursor.match(/^\/[^\s]+\s$/) ?? beforeCursor.match(/^\/[^\s]+$/);
    if (slashMatch) {
      return {
        value: afterCursor.replace(/^\s+/, ""),
        cursor: 0,
      };
    }

    return null;
  }, []);

  useEffect(() => {
    if (typeof seedValue !== "string") return;
    setAtItems([]);
    setInputState(seedValue, seedValue.length);
    pendingSuggestionSubmitRef.current = false;
    suppressSuggestionsRef.current = false;
  }, [seedValue, setInputState]);

  // Stabilize suggestion index reset — only reset when the suggestion list content changes,
  // not on every keystroke. This prevents the dropdown from jumping back to top while typing.
  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [slashItems.length, atItems.length]);

  useEffect(() => {
    if (!pendingSuggestionSubmitRef.current) return;
    if (skipPendingClearOnNextChangeRef.current) {
      skipPendingClearOnNextChangeRef.current = false;
      return;
    }
    pendingSuggestionSubmitRef.current = false;
  }, [value]);

  const applySuggestion = (item: RichSelectItem) => {
    resetHistoryNavigation();
    if (atItems.length > 0) {
      pendingSuggestionSubmitRef.current = false;
      handleAtSelect(item);
      return;
    }

    setInputState(item.value, item.value.length);
  };

  const submitCurrentValue = React.useCallback(
    (nextValue?: string) => {
      const finalValue = (nextValue ?? valueRef.current).trim();
      const finalValueLower = finalValue.toLowerCase();
      const allowedWhileDisabled = enabledWhileDisabledPrefixes.some((prefix) =>
        finalValueLower.startsWith(prefix.toLowerCase()),
      );
      if (!finalValue || (isDisabled && !allowedWhileDisabled)) return;
      setAtItems([]);
      resetHistoryNavigation();
      onSubmit(finalValue);
      setInputState("", 0);
      if (vimMode) setVimEditMode("normal");
    },
    [enabledWhileDisabledPrefixes, isDisabled, onSubmit, resetHistoryNavigation, setInputState, vimMode],
  );

  // Sync cursorPos with value when value changes externally (e.g., suggestion selected)
  // Move cursor to end when value is replaced entirely, not during navigation
  // (Removed useEffect that caused flickering)

  // Keep insert mode active by default so typed characters are always visible.
  useEffect(() => {
    if (vimMode) {
      // Keep typing visible by default when Vim mode is enabled.
      setVimEditMode("insert");
    } else {
      setVimEditMode("insert");
    }
  }, [vimMode]);

  // Update @mention suggestions whenever the value changes
  // T-CLI-10 / T-CLI-P9: detect @mention at ANY position; show files/folders
  // T-CLI-09: also show file completions when fragment looks like a path
  // T-MCP-07: also show MCP @server:resource completions
  useEffect(() => {
    if (suppressSuggestionsRef.current) {
      if (atItems.length) setAtItems([]);
      return;
    }
    const lastAtIdx = value.lastIndexOf("@");
    if (lastAtIdx === -1) {
      if (atItems.length) setAtItems([]);
      return;
    }
    // Fragment from the last @ onward (e.g. "@but" or just "@")
    const fragment = value.slice(lastAtIdx).toLowerCase();
    // If there's a space after @, the mention is already complete — hide dropdown
    if (fragment.length > 1 && fragment.includes(" ")) {
      if (atItems.length) setAtItems([]);
      return;
    }
    const query = fragment.slice(1); // strip leading @

    // T-MCP-07: "server:resource" pattern — show MCP resource completions
    // Detect if query looks like "@server:..." or "@server:/..."
    const colonIdx = query.indexOf(":");
    if (colonIdx !== -1) {
      const serverPrefix = query.slice(0, colonIdx);
      const resourcePrefix = query.slice(colonIdx + 1).toLowerCase();
      const resources = getMcpResourceSuggestions();
      const resourceItems = resources
        .filter(
          (r) =>
            (serverPrefix === "" ||
              r.server.toLowerCase().startsWith(serverPrefix)) &&
            (resourcePrefix === "" ||
              r.uri.toLowerCase().includes(resourcePrefix) ||
              r.name.toLowerCase().includes(resourcePrefix)),
        )
        .slice(0, 8)
        .map((r) => ({
          label: `@${r.server}:${r.uri}${r.description ? `  ${r.description.slice(0, 35)}` : ""}`,
          value: `@${r.server}:${r.uri}`,
          description: r.description,
          agentColor: "magenta" as string,
        }));
      setAtItems((prev) =>
        sameRichItems(prev, resourceItems) ? prev : resourceItems,
      );
      // Eagerly warm the cache for next time
      void ensureMcpResourceCache();
      return;
    }

    // If user just typed "@" (no colon yet), pre-fetch MCP resources in background
    void ensureMcpResourceCache();

    // Show FILES/FOLDERS by default when @ is typed (not agents)
    const cwd = projectDir ?? process.cwd();
    const files = getFileSuggestions(cwd);

    // Filter files based on query
    const fileItems = files
      .filter((f) => !query || f.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 15)
      .map((f) => ({
        label: f.endsWith("/") ? `${f}  folder` : `${f}  file`,
        value: `@${f}`,
        description: undefined,
        agentColor: f.endsWith("/") ? "cyan" : "white",
      }));

    // T-MCP-07: Also show MCP server prefixes as hints when @ is typed without a colon
    const mcpServers = getMcpResourceSuggestions()
      .reduce((acc, r) => {
        if (!acc.includes(r.server)) acc.push(r.server);
        return acc;
      }, [] as string[])
      .filter((s) => query === "" || s.toLowerCase().startsWith(query))
      .slice(0, 3)
      .map((s) => ({
        label: `@${s}:  MCP resource`,
        value: `@${s}:`,
        description: "MCP resource reference",
        agentColor: "magenta" as string,
      }));

    const combined = [...fileItems, ...mcpServers].slice(0, 15);
    setAtItems((prev) => (sameRichItems(prev, combined) ? prev : combined));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shift+Tab → cycle permission mode; T164: Ctrl+O → verbose
  useInput(
    (_input, key) => {
      if (isDisabled) return;
      const insertModeActive = !vimMode || vimEditMode === "insert";

      if (visibleSuggestions.length > 0) {
        if (key.downArrow) {
          setSelectedSuggestionIndex(
            (current) => (current + 1) % visibleSuggestions.length,
          );
          return;
        }
        if (key.upArrow) {
          setSelectedSuggestionIndex(
            (current) =>
              (current - 1 + visibleSuggestions.length) %
              visibleSuggestions.length,
          );
          return;
        }
        if (_input === " ") {
          const selectedSuggestion =
            visibleSuggestions[selectedSuggestionIndex]!;
          applySuggestion(selectedSuggestion);
          pendingSuggestionSubmitRef.current = false;
          return;
        }
        if (key.return) {
          handleSubmit(valueRef.current);
          return;
        }
      }

      if (insertModeActive) {
        const currentValue = valueRef.current;
        const currentCursor = cursorPosRef.current;
        const { lineStart, lineEnd } = getLineBounds(currentValue, currentCursor);

        if (key.leftArrow) {
          setCursorState(currentCursor - 1);
          return;
        }
        if (key.rightArrow) {
          if (ghostSuggestion && atItems.length === 0 && currentCursor === currentValue.length) {
            insertAtCursor(ghostSuggestion);
            return;
          }
          setCursorState(currentCursor + 1);
          return;
        }
if (key.home) {
  // CLI-4: Go to the start of the current line (sentence start for single-line input)
  setCursorState(0);
  return;
}
if (key.end) {
  // CLI-4: Go to the end of the current line (sentence end for single-line input)
  setCursorState(currentValue.length);
  return;
}
        const isBackspaceInput =
          _input === "\x7f" ||
          _input === "\b" ||
          _input === "\x08" ||
          (key.ctrl && (_input === "h" || _input === "H"));
        const isBackspace =
          key.backspace ||
          isBackspaceInput ||
          (key.delete && _input !== "\x1b[3~");
        const isForwardDelete = _input === "\x1b[3~";

        if (isBackspace) {
          if (currentCursor === 0) return;
          const collapsedMention = collapseMentionAtCursor(currentValue, currentCursor);
          if (collapsedMention) {
            setAtItems([]);
            setInputState(collapsedMention.value, collapsedMention.cursor);
            return;
          }
          const nextValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          setInputState(nextValue, currentCursor - 1);
          return;
        }
        if (isForwardDelete) {
          if (currentCursor >= currentValue.length) return;
          const nextValue = currentValue.slice(0, currentCursor) + currentValue.slice(currentCursor + 1);
          setInputState(nextValue, currentCursor);
          return;
        }
        if (key.return) {
          handleSubmit(currentValue);
          return;
        }
        if (
          _input &&
          _input !== "\x7f" &&
          _input !== "\b" &&
          _input !== "\x1b[3~" &&
          !key.ctrl &&
          !key.meta &&
          !key.tab &&
          !key.escape &&
          !key.backspace &&
          !key.delete &&
          !key.upArrow &&
          !key.downArrow &&
          !key.leftArrow &&
          !key.rightArrow &&
          !key.home &&
          !key.end
        ) {
          insertAtCursor(_input);
          return;
        }
      }

      if (
        insertModeActive &&
        atItems.length === 0 &&
        slashItems.length === 0
      ) {
        if (
          !key.upArrow && !key.downArrow && !key.leftArrow &&
          !key.rightArrow && !key.return && !key.escape &&
          !key.ctrl && !key.meta && !key.backspace && !key.delete &&
          !key.home && !key.end && !key.tab
        ) {
          return;
        }
        if (key.upArrow) {
          navigatePromptHistory("up");
          return;
        }
        if (key.downArrow) {
          navigatePromptHistory("down");
          return;
        }
      }

      // T-CLI-80: Vim normal mode — full key handling: motions, text objects, undo, yank, paste
      if (vimMode && vimEditMode === "normal") {
        // --- helpers (close over current value / cursorPos) ---
        const pushUndo = () => {
          undoStackRef.current.push(value);
          if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        };
        const wEnd = (p = cursorPos): number => {
          let i = p;
          while (i < value.length && value[i] !== " ") i++;
          while (i < value.length && value[i] === " ") i++;
          return i;
        };
        const wBack = (p = cursorPos): number => {
          let i = p - 1;
          while (i > 0 && value[i] === " ") i--;
          while (i > 0 && value[i - 1] !== " ") i--;
          return Math.max(0, i);
        };
        const eEnd = (p = cursorPos): number => {
          let i = p + 1;
          while (i < value.length && value[i] === " ") i++;
          while (i < value.length - 1 && value[i + 1] !== " ") i++;
          return Math.min(i, Math.max(0, value.length - 1));
        };
        const innerWord = (): [number, number] => {
          let s = cursorPos,
            e = cursorPos;
          while (s > 0 && value[s - 1] !== " ") s--;
          while (e < value.length && value[e] !== " ") e++;
          return [s, e];
        };
        const aroundWord = (): [number, number] => {
          let [s, e] = innerWord();
          while (s > 0 && value[s - 1] === " ") s--;
          while (e < value.length && value[e] === " ") e++;
          return [s, e];
        };
        const innerObj = (
          delim: string,
          around: boolean,
        ): [number, number] | null => {
          const pairs: Record<string, [string, string]> = {
            "(": ["(", ")"],
            ")": ["(", ")"],
            "[": ["[", "]"],
            "]": ["[", "]"],
            "{": ["{", "}"],
            "}": ["{", "}"],
            "<": ["<", ">"],
            ">": ["<", ">"],
          };
          if (['"', "'", "`"].includes(delim)) {
            const left = value.lastIndexOf(delim, cursorPos - 1);
            const right = value.indexOf(delim, cursorPos);
            if (left === -1 || right === -1 || left === right) return null;
            return around ? [left, right] : [left + 1, right - 1];
          }
          const pair = pairs[delim];
          if (!pair) return null;
          let depth = 0,
            start = -1;
          for (let i = cursorPos; i >= 0; i--) {
            if (value[i] === pair[1]) depth++;
            else if (value[i] === pair[0]) {
              if (depth === 0) {
                start = i;
                break;
              }
              depth--;
            }
          }
          if (start === -1) return null;
          depth = 0;
          let end = -1;
          for (let i = start + 1; i < value.length; i++) {
            if (value[i] === pair[0]) depth++;
            else if (value[i] === pair[1]) {
              if (depth === 0) {
                end = i;
                break;
              }
              depth--;
            }
          }
          if (end === -1) return null;
          return around ? [start, end] : [start + 1, end - 1];
        };

        // Up/down arrows for history navigation (even in normal mode)
        if (key.upArrow) {
          navigatePromptHistory("up");
          return;
        }
        if (key.downArrow) {
          navigatePromptHistory("down");
          return;
        }

        // --- resolve pending multi-key sequence ---
        const pending = pendingMotionRef.current;
        if (pending) {
          pendingMotionRef.current = "";
          // r<char> — replace
          if (pending === "r") {
            if (_input && _input.length === 1) {
              pushUndo();
              setValue(
                value.slice(0, cursorPos) + _input + value.slice(cursorPos + 1),
              );
            }
            return;
          }
          // f/F/t/T<char> — find / till
          if (pending === "f") {
            const idx = value.indexOf(_input, cursorPos + 1);
            if (idx !== -1) setCursorPos(idx);
            return;
          }
          if (pending === "F") {
            const idx = value.lastIndexOf(_input, cursorPos - 1);
            if (idx !== -1) setCursorPos(idx);
            return;
          }
          if (pending === "t") {
            const idx = value.indexOf(_input, cursorPos + 1);
            if (idx !== -1) setCursorPos(Math.max(0, idx - 1));
            return;
          }
          if (pending === "T") {
            const idx = value.lastIndexOf(_input, cursorPos - 1);
            if (idx !== -1) setCursorPos(idx + 1);
            return;
          }
          // g<key>
          if (pending === "g") {
            if (_input === "g") {
              setCursorPos(0);
              return;
            }
            if (_input === "e") {
              let i = cursorPos - 1;
              while (i > 0 && value[i] === " ") i--;
              while (i > 0 && value[i - 1] !== " ") i--;
              setCursorPos(Math.max(0, i));
            }
            return;
          }
          // d<motion>
          if (pending === "d") {
            if (_input === "d") {
              pushUndo();
              yankRef.current = value;
              setValue("");
              setCursorPos(0);
              return;
            }
            if (_input === "w") {
              const e = wEnd();
              pushUndo();
              yankRef.current = value.slice(cursorPos, e);
              const nv = value.slice(0, cursorPos) + value.slice(e);
              setValue(nv);
              setCursorPos(Math.min(cursorPos, Math.max(0, nv.length - 1)));
              return;
            }
            if (_input === "b") {
              const s = wBack();
              pushUndo();
              yankRef.current = value.slice(s, cursorPos);
              const nv = value.slice(0, s) + value.slice(cursorPos);
              setValue(nv);
              setCursorPos(Math.max(0, s));
              return;
            }
            if (_input === "e") {
              const e = eEnd() + 1;
              pushUndo();
              yankRef.current = value.slice(cursorPos, e);
              const nv = value.slice(0, cursorPos) + value.slice(e);
              setValue(nv);
              setCursorPos(Math.min(cursorPos, Math.max(0, nv.length - 1)));
              return;
            }
            if (_input === "$") {
              pushUndo();
              yankRef.current = value.slice(cursorPos);
              setValue(value.slice(0, cursorPos));
              setCursorPos(Math.max(0, cursorPos - 1));
              return;
            }
            if (_input === "0") {
              pushUndo();
              yankRef.current = value.slice(0, cursorPos);
              setValue(value.slice(cursorPos));
              setCursorPos(0);
              return;
            }
            if (_input === "i") {
              pendingMotionRef.current = "di";
              return;
            }
            if (_input === "a") {
              pendingMotionRef.current = "da";
              return;
            }
            return;
          }
          // c<motion>
          if (pending === "c") {
            if (_input === "c") {
              pushUndo();
              yankRef.current = value;
              setValue("");
              setCursorPos(0);
              setVimEditMode("insert");
              return;
            }
            if (_input === "w") {
              const e = wEnd();
              pushUndo();
              yankRef.current = value.slice(cursorPos, e);
              const nv = value.slice(0, cursorPos) + value.slice(e);
              setValue(nv);
              setCursorPos(cursorPos);
              setVimEditMode("insert");
              return;
            }
            if (_input === "b") {
              const s = wBack();
              pushUndo();
              yankRef.current = value.slice(s, cursorPos);
              const nv = value.slice(0, s) + value.slice(cursorPos);
              setValue(nv);
              setCursorPos(s);
              setVimEditMode("insert");
              return;
            }
            if (_input === "e") {
              const e = eEnd() + 1;
              pushUndo();
              yankRef.current = value.slice(cursorPos, e);
              const nv = value.slice(0, cursorPos) + value.slice(e);
              setValue(nv);
              setCursorPos(cursorPos);
              setVimEditMode("insert");
              return;
            }
            if (_input === "$") {
              pushUndo();
              yankRef.current = value.slice(cursorPos);
              setValue(value.slice(0, cursorPos));
              setVimEditMode("insert");
              return;
            }
            if (_input === "0") {
              pushUndo();
              yankRef.current = value.slice(0, cursorPos);
              setValue(value.slice(cursorPos));
              setCursorPos(0);
              setVimEditMode("insert");
              return;
            }
            if (_input === "i") {
              pendingMotionRef.current = "ci";
              return;
            }
            if (_input === "a") {
              pendingMotionRef.current = "ca";
              return;
            }
            return;
          }
          // y<motion>
          if (pending === "y") {
            if (_input === "y") {
              yankRef.current = value;
              return;
            }
            if (_input === "w") {
              yankRef.current = value.slice(cursorPos, wEnd());
              return;
            }
            if (_input === "b") {
              yankRef.current = value.slice(wBack(), cursorPos);
              return;
            }
            if (_input === "e") {
              yankRef.current = value.slice(cursorPos, eEnd() + 1);
              return;
            }
            if (_input === "$") {
              yankRef.current = value.slice(cursorPos);
              return;
            }
            if (_input === "i") {
              pendingMotionRef.current = "yi";
              return;
            }
            if (_input === "a") {
              pendingMotionRef.current = "ya";
              return;
            }
            return;
          }
          // di/ci/yi/da/ca/ya + delimiter
          if (
            pending.length === 2 &&
            ["di", "ci", "yi", "da", "ca", "ya"].includes(pending)
          ) {
            const op = pending[0] as "d" | "c" | "y";
            const around = pending[1] === "a";
            let range: [number, number] | null = null;
            if (_input === "w") {
              const [s, e] = around ? aroundWord() : innerWord();
              range = [s, e];
            } else {
              range = innerObj(_input, around);
            }
            if (range) {
              const [rs, re] = range;
              if (op !== "y") {
                pushUndo();
              }
              yankRef.current = value.slice(rs, re + 1);
              if (op !== "y") {
                const nv = value.slice(0, rs) + value.slice(re + 1);
                setValue(nv);
                setCursorPos(Math.min(rs, Math.max(0, nv.length - 1)));
                if (op === "c") setVimEditMode("insert");
              }
            }
            return;
          }
          return;
        }

        // --- single-key commands ---
        if (key.escape) return;
        if (_input === "i") {
          setVimEditMode("insert");
          return;
        }
        if (_input === "a") {
          setVimEditMode("insert");
          setCursorPos(Math.min(cursorPos + 1, value.length));
          return;
        }
        if (_input === "A") {
          setVimEditMode("insert");
          setCursorPos(value.length);
          return;
        }
        if (_input === "I") {
          setVimEditMode("insert");
          setCursorPos(0);
          return;
        }
        // motions
        if (_input === "h" || key.leftArrow) {
          setCursorPos((p) => Math.max(0, p - 1));
          return;
        }
        if (_input === "l" || key.rightArrow) {
          setCursorPos((p) =>
            Math.min(value.length > 0 ? value.length - 1 : 0, p + 1),
          );
          return;
        }
if (key.home) {
  // CLI-4: Go to start of input line (sentence start)
  setCursorState(0);
  return;
}
if (key.end) {
  // CLI-4: Go to end of input line (sentence end)
  setCursorState(value.length > 0 ? value.length - 1 : 0);
  return;
}
        if (_input === "0") {
          setCursorPos(0);
          return;
        }
        if (_input === "$") {
          setCursorPos(Math.max(0, value.length - 1));
          return;
        }
        if (_input === "w") {
          let p = cursorPos;
          while (p < value.length && value[p] !== " ") p++;
          while (p < value.length && value[p] === " ") p++;
          setCursorPos(Math.min(p, Math.max(0, value.length - 1)));
          return;
        }
        if (_input === "b") {
          let p = cursorPos - 1;
          while (p > 0 && value[p] === " ") p--;
          while (p > 0 && value[p - 1] !== " ") p--;
          setCursorPos(Math.max(0, p));
          return;
        }
        if (_input === "e") {
          setCursorPos(eEnd());
          return;
        }
        // delete / change / yank
        if (_input === "x") {
          pushUndo();
          yankRef.current = value[cursorPos] ?? "";
          const nv = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
          setValue(nv);
          setCursorPos(Math.min(cursorPos, Math.max(0, nv.length - 1)));
          return;
        }
        if (_input === "X") {
          if (cursorPos === 0) return;
          pushUndo();
          yankRef.current = value[cursorPos - 1] ?? "";
          const nv = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          setValue(nv);
          setCursorPos(Math.max(0, cursorPos - 1));
          return;
        }
        if (_input === "D") {
          pushUndo();
          yankRef.current = value.slice(cursorPos);
          setValue(value.slice(0, cursorPos));
          setCursorPos(Math.max(0, cursorPos - 1));
          return;
        }
        if (_input === "C") {
          pushUndo();
          yankRef.current = value.slice(cursorPos);
          setValue(value.slice(0, cursorPos));
          setVimEditMode("insert");
          return;
        }
        if (_input === "s") {
          pushUndo();
          yankRef.current = value[cursorPos] ?? "";
          const nv = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
          setValue(nv);
          setVimEditMode("insert");
          return;
        }
        if (_input === "S") {
          pushUndo();
          yankRef.current = value;
          setValue("");
          setCursorPos(0);
          setVimEditMode("insert");
          return;
        }
        // undo
        if (_input === "u") {
          if (undoStackRef.current.length > 0) {
            const prev = undoStackRef.current.pop()!;
            setValue(prev);
            setCursorPos(Math.min(cursorPos, Math.max(0, prev.length - 1)));
          }
          return;
        }
        // paste
        if (_input === "p") {
          if (yankRef.current) {
            pushUndo();
            const nv =
              value.slice(0, cursorPos + 1) +
              yankRef.current +
              value.slice(cursorPos + 1);
            setValue(nv);
            setCursorPos(cursorPos + yankRef.current.length);
          }
          return;
        }
        if (_input === "P") {
          if (yankRef.current) {
            pushUndo();
            const nv =
              value.slice(0, cursorPos) +
              yankRef.current +
              value.slice(cursorPos);
            setValue(nv);
            setCursorPos(cursorPos + yankRef.current.length - 1);
          }
          return;
        }
        // tilde — toggle case
        if (_input === "~") {
          if (cursorPos < value.length) {
            pushUndo();
            const ch = value[cursorPos]!;
            const toggled =
              ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
            setValue(
              value.slice(0, cursorPos) + toggled + value.slice(cursorPos + 1),
            );
            setCursorPos(Math.min(cursorPos + 1, value.length - 1));
          }
          return;
        }
        // multi-key prefix
        if (_input === "r") {
          pendingMotionRef.current = "r";
          return;
        }
        if (_input === "f") {
          pendingMotionRef.current = "f";
          return;
        }
        if (_input === "F") {
          pendingMotionRef.current = "F";
          return;
        }
        if (_input === "t") {
          pendingMotionRef.current = "t";
          return;
        }
        if (_input === "T") {
          pendingMotionRef.current = "T";
          return;
        }
        if (_input === "g") {
          pendingMotionRef.current = "g";
          return;
        }
        if (_input === "d") {
          pendingMotionRef.current = "d";
          return;
        }
        if (_input === "c") {
          pendingMotionRef.current = "c";
          return;
        }
        if (_input === "y") {
          pendingMotionRef.current = "y";
          return;
        }
        // visual mode
        if (_input === "v") {
          visualAnchorRef.current = cursorPos;
          setVimEditMode("visual");
          return;
        }
        // submit
        if (key.return) {
          if (value.trim()) handleVimSubmit();
          return;
        }
        return; // ignore unhandled
      }

      // T-CLI-80: Visual mode — hjkl moves cursor, d/y/c operate on selection
      if (vimMode && vimEditMode === "visual") {
        const anchor = visualAnchorRef.current;
        const selStart = Math.min(anchor, cursorPos);
        const selEnd = Math.max(anchor, cursorPos);
        if (key.escape) {
          setVimEditMode("normal");
          return;
        }
        if (_input === "h" || key.leftArrow) {
          setCursorPos((p) => Math.max(0, p - 1));
          return;
        }
        if (_input === "l" || key.rightArrow) {
          setCursorPos((p) =>
            Math.min(value.length > 0 ? value.length - 1 : 0, p + 1),
          );
          return;
        }
        if (_input === "w") {
          let p = cursorPos;
          while (p < value.length && value[p] !== " ") p++;
          while (p < value.length && value[p] === " ") p++;
          setCursorPos(Math.min(p, Math.max(0, value.length - 1)));
          return;
        }
        if (_input === "b") {
          let p = cursorPos - 1;
          while (p > 0 && value[p] === " ") p--;
          while (p > 0 && value[p - 1] !== " ") p--;
          setCursorPos(Math.max(0, p));
          return;
        }
        if (key.home) {
          const { lineStart } = getLineBounds(value, cursorPos);
          setCursorState(lineStart);
          return;
        }
        if (key.end) {
          const { lineEnd } = getLineBounds(value, cursorPos);
          setCursorState(lineEnd);
          return;
        }
        if (_input === "0") {
          setCursorPos(0);
          return;
        }
        if (_input === "$") {
          setCursorPos(Math.max(0, value.length - 1));
          return;
        }
        if (_input === "d" || key.delete) {
          undoStackRef.current.push(value);
          yankRef.current = value.slice(selStart, selEnd + 1);
          const nv = value.slice(0, selStart) + value.slice(selEnd + 1);
          setValue(nv);
          setCursorPos(Math.min(selStart, Math.max(0, nv.length - 1)));
          setVimEditMode("normal");
          return;
        }
        if (_input === "y") {
          yankRef.current = value.slice(selStart, selEnd + 1);
          setCursorPos(selStart);
          setVimEditMode("normal");
          return;
        }
        if (_input === "c") {
          undoStackRef.current.push(value);
          yankRef.current = value.slice(selStart, selEnd + 1);
          const nv = value.slice(0, selStart) + value.slice(selEnd + 1);
          setValue(nv);
          setCursorPos(selStart);
          setVimEditMode("insert");
          return;
        }
        if (_input === "~") {
          undoStackRef.current.push(value);
          const sel = value
            .slice(selStart, selEnd + 1)
            .split("")
            .map((c) =>
              c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
            )
            .join("");
          setValue(value.slice(0, selStart) + sel + value.slice(selEnd + 1));
          setCursorPos(selStart);
          setVimEditMode("normal");
          return;
        }
        return;
      }

      // T-CLI-80: Vim insert mode — Esc returns to normal, or double-ESC to stop AI
      if (vimMode && vimEditMode === "insert") {
        if (key.escape) {
          const now = Date.now();
          const timeSinceLastEsc = now - lastEscTimeRef.current;
          lastEscTimeRef.current = now;

          // Double ESC detected - stop AI agent if callback provided
          if (timeSinceLastEsc < ESC_DOUBLE_PRESS_THRESHOLD && onStop) {
            onStop();
            return;
          }

          setVimEditMode("normal");
          setCursorPos(Math.max(0, value.length - 1));
          return;
        }
        // All other keys are handled by the insert-mode editor above
      }

      // Non-vim mode: ESC twice to stop AI agent
      if (!vimMode && key.escape) {
        const now = Date.now();
        const timeSinceLastEsc = now - lastEscTimeRef.current;
        lastEscTimeRef.current = now;

        // Double ESC detected - stop AI agent if callback provided
        if (timeSinceLastEsc < ESC_DOUBLE_PRESS_THRESHOLD && onStop) {
          onStop();
          return;
        }
      }

      // Shift+Tab is handled at ChatScreen level to avoid double-cycling.
      if (key.ctrl && _input === "o") {
        toggleVerbose();
      }
    },
    { isActive: inputActive },
  );

  const handleVimSubmit = () => {
    pendingSuggestionSubmitRef.current = false;
    submitCurrentValue();
  };

  const handleSubmit = (val: string) => {
    if (suppressNextSubmitRef.current) {
      suppressNextSubmitRef.current = false;
      return;
    }

    if (visibleSuggestions.length > 0) {
      const selectedSuggestion =
        visibleSuggestions[selectedSuggestionIndex] ?? visibleSuggestions[0];
      if (!selectedSuggestion) return;

      // Second Enter after selection submits the current message.
      if (pendingSuggestionSubmitRef.current) {
        pendingSuggestionSubmitRef.current = false;
        submitCurrentValue(valueRef.current);
        return;
      }

      // @-mentions: first Enter selects, second Enter submits.
      if (atItems.length > 0) {
        applySuggestion(selectedSuggestion);
        pendingSuggestionSubmitRef.current = true;
        skipPendingClearOnNextChangeRef.current = true;
        return;
      }

      // Slash commands: one match submits directly, otherwise two-step Enter.
      if (visibleSuggestions.length === 1) {
        pendingSuggestionSubmitRef.current = false;
        submitCurrentValue(selectedSuggestion.value);
        return;
      }

      applySuggestion(selectedSuggestion);
      pendingSuggestionSubmitRef.current = true;
      skipPendingClearOnNextChangeRef.current = true;
      return;
    }

    pendingSuggestionSubmitRef.current = false;
    submitCurrentValue(val);
  };

  const handleAtSelect = (item: { label: string; value: string }) => {
    // Replace only the @fragment (from the last @ to end) with selected agent name + space
    const currentValue = valueRef.current;
    resetHistoryNavigation();
    const lastAtIdx = currentValue.lastIndexOf("@");
    let newValue: string;
    if (lastAtIdx !== -1) {
      const before = currentValue.slice(0, lastAtIdx);
      newValue = `${before}${item.value} `;
    } else {
      newValue = `${item.value} `;
    }
    setAtItems([]);
    setInputState(newValue, newValue.length);
  };

  const horizontalRule = makeHorizontalRule(resolvedShellWidth);

  const renderEditableInput = () => {
    const placeholderText = isDisabled ? "Generating response..." : "Enter your message here";
    const showPlaceholder = value.length === 0;
    const inputWidth = Math.max(8, resolvedShellWidth - 2);
    const rows = wrapInputRows(value, cursorPos, inputWidth);

    return (
      <Box flexDirection="column" width={inputWidth}>
        {rows.map((row, index) => {
          if (!row.hasCursor) {
            return <Text key={index}>{row.text || " "}</Text>;
          }
          return (
            <Box key={index} gap={0} width={inputWidth}>
              <Text>{row.beforeCursor}</Text>
              <Text color={PAKALON_BLUE}>█</Text>
              {showPlaceholder && row.afterCursor.length === 0 ? (
                <Text dimColor>{placeholderText}</Text>
              ) : (
                <Text>{row.afterCursor}</Text>
              )}
            </Box>
          );
        })}
      </Box>
    );
  };

  // T-CLI-80: In vim normal mode, render cursor as highlighted character
  const renderVimNormalInput = () => {
    const before = value.slice(0, cursorPos);
    const cursorChar = value[cursorPos] ?? " ";
    const after = value.slice(cursorPos + 1);
    return (
      <Box gap={0}>
        <Text>{before}</Text>
        <Text backgroundColor="gray" color="white">
          {cursorChar}
        </Text>
        <Text>{after}</Text>
        {!value && (
          <Text dimColor backgroundColor="gray" color="white">
            {" "}
          </Text>
        )}
      </Box>
    );
  };

  // T-CLI-80: In vim visual mode, render selection as highlighted range
  const renderVimVisualInput = () => {
    const anchor = visualAnchorRef.current;
    const selStart = Math.min(anchor, cursorPos);
    const selEnd = Math.max(anchor, cursorPos);
    const before = value.slice(0, selStart);
    const selected = value.slice(selStart, selEnd + 1) || " ";
    const after = value.slice(selEnd + 1);
    return (
      <Box gap={0}>
        <Text>{before}</Text>
        <Text backgroundColor="gray" color="white">
          {selected}
        </Text>
        <Text>{after}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* T-CLI-P9: @mention autocomplete dropdown — shows name + description */}
      {atItems.length > 0 && (
        <Box width="100%" justifyContent={containerJustify}>
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={accentColor}
            paddingX={1}
            width={contentWidth}
          >
            <Text dimColor>
              Suggestions — ↑/↓ move, Space selects, Enter selects (press Enter
              again to send)
            </Text>
            {atItems.map((item, index) => (
              <Box key={item.value} gap={1}>
                <Text
                  color={
                    index === selectedSuggestionIndex
                      ? accentColor
                      : (item.agentColor ?? "cyan")
                  }
                  bold={index === selectedSuggestionIndex}
                >
                  {index === selectedSuggestionIndex ? "->" : " "} {item.value}
                </Text>
                {item.description ? (
                  <Text
                    color={
                      index === selectedSuggestionIndex
                        ? accentColor
                        : undefined
                    }
                    dimColor={index !== selectedSuggestionIndex}
                  >
                    {item.description.slice(0, 50)}
                  </Text>
                ) : null}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {slashItems.length > 0 && (
        <Box width="100%" justifyContent={containerJustify}>
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={accentColor}
            paddingX={1}
            width={contentWidth}
          >
            <Text dimColor>
              Commands ({selectedSuggestionIndex + 1}/{slashItems.length}) — ↑/↓ move, Space/Enter selects
            </Text>
            {slashPreviewItems.map((item, index) => {
              const isSelected = index === selectedSuggestionIndex;
              return (
                <Box key={item.label} gap={1}>
                  <Text
                    color={isSelected ? accentColor : "white"}
                    bold={isSelected}
                  >
                    {isSelected ? "-> " : "  "}{item.label}
                  </Text>
                  <Text
                    color={isSelected ? accentColor : undefined}
                    dimColor={!isSelected}
                  >
                    {item.description}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      <Box width="100%" justifyContent={containerJustify}>
        <Box flexDirection="column" width={contentWidth}>
          <Text color={accentColor}>{horizontalRule}</Text>
          <Box paddingX={1}>
            {vimMode && vimEditMode === "normal" ? (
              // T-CLI-80: Normal mode — custom cursor rendering
              renderVimNormalInput()
            ) : vimMode && vimEditMode === "visual" ? (
              // T-CLI-80: Visual mode — selection highlighting
              renderVimVisualInput()
            ) : (
              renderEditableInput()
            )}
          </Box>
          {/* T-CLI-57: Ghost text suggestion — shown as dimmed suffix (Right arrow accepts) */}
          {!isDisabled && atItems.length === 0 && !compactTerminal && (
            <Box paddingX={1} minHeight={1}>
              {ghostSuggestion ? (
                <Text color={TEXT_SECONDARY}>
                  <Text color={accentColor}>{ghostSuggestion}</Text>
                  <Text color={TEXT_SECONDARY}> → accepts</Text>
                </Text>
              ) : (
                <Text color={TEXT_SECONDARY}> </Text>
              )}
            </Box>
          )}
          <Text color={accentColor}>{horizontalRule}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(InputBar);
