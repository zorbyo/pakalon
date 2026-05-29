/**
 * /history command — show per-project session history with prompts, lines, tokens.
 */
import { debugLog } from "@/utils/logger.js";
import { getApiClient } from "@/api/client.js";
import { isSelfHosted } from "@/config/mode.js";
import { listLocalSessions } from "@/db/local.js";
import type { CommandDefinition } from "./types.js";

interface SessionSummary {
  id: string;
  created_at: string;
  model_id: string;
  message_count: number;
  messages_count?: number;
  tokens_used?: number;
  lines_written?: number;
  context_pct_used?: number;
  title?: string;
  project_dir?: string;
  prompt_text?: string;
}

export interface HistoryOptions {
  projectDir?: string;
  jsonSchema?: boolean;
  includePartialMessages?: boolean;
}

export interface HistoryCommandInput extends HistoryOptions {
  limit?: number;
  /** Backward-compatible alias for jsonSchema output + return value */
  json?: boolean;
}

export async function cmdHistory(
  limitOrInput: number | HistoryCommandInput = 20,
  opts: HistoryOptions = {},
): Promise<SessionSummary[] | void> {
  const input = typeof limitOrInput === "number" ? undefined : limitOrInput;
  const limit = typeof limitOrInput === "number" ? limitOrInput : (input?.limit ?? 20);
  const merged: HistoryOptions = {
    ...opts,
    ...(input ? {
      projectDir: input.projectDir,
      jsonSchema: input.jsonSchema,
      includePartialMessages: input.includePartialMessages,
    } : {}),
  };

  const jsonOutput = Boolean(input?.json);
  const { projectDir, jsonSchema = false, includePartialMessages = false } = merged;
  if (isSelfHosted()) {
    const sessions = listLocalSessions(limit, projectDir) as SessionSummary[];
    if (jsonOutput || jsonSchema) {
      if (!jsonOutput) console.log(JSON.stringify(sessions, null, 2));
      return jsonOutput ? sessions : undefined;
    }
    if (!sessions.length) {
      console.log("\nNo local sessions found for this project.\n");
      return;
    }
    console.log(`\n── Local Session History (${sessions.length}) ──────────────\n`);
    for (const session of sessions) {
      const date = new Date(session.created_at).toLocaleString();
      console.log(`  ${session.id.slice(0, 12)}...  ${date}  ${session.model_id ?? "local"}  ${session.prompt_text ?? ""}`);
    }
    console.log();
    return;
  }

  try {
    const api = getApiClient();
    const params: Record<string, unknown> = { limit: 100 };
    if (projectDir) params["project_dir"] = projectDir;
    if (includePartialMessages) params["include_partial"] = "true";
    const res = await api.get<{ sessions: SessionSummary[] }>("/sessions", { params });
    const sessions = res.data.sessions ?? [];

    if (!sessions || sessions.length === 0) {
      console.log("\nNo sessions found for this project.\n");
      return;
    }

    const recent = sessions.slice(0, limit);

    if (jsonSchema || jsonOutput) {
      // Output full JSON array for piping / scripting
      if (!jsonOutput) {
        console.log(JSON.stringify(recent, null, 2));
        return;
      }
      return recent;
    }

    console.log(`\n── Session History (${recent.length} of ${sessions.length}) ──────────────\n`);
    console.log(
      "  ID".padEnd(16) +
      "Date".padEnd(22) +
      "Model".padEnd(32) +
      "Prompts".padEnd(10) +
      "Lines".padEnd(10) +
      "Tokens".padEnd(14) +
      "First Prompt"
    );
    console.log("  " + "─".repeat(110));

    for (const s of recent) {
      const date = new Date(s.created_at).toLocaleString();
      const model = s.model_id
        ? s.model_id.length > 29
          ? `...${s.model_id.slice(-26)}`
          : s.model_id
        : "unknown";
      const prompts = String(s.messages_count ?? s.message_count ?? "—").padEnd(10);
      const lines = String(s.lines_written ?? "—").padEnd(10);
      const tokens = (s.tokens_used ? s.tokens_used.toLocaleString() : "—").padEnd(14);
      const preview = s.prompt_text
        ? s.prompt_text.length > 45
          ? `${s.prompt_text.slice(0, 42)}…`
          : s.prompt_text
        : "";
      console.log(
        `  ${s.id.slice(0, 12)}...  `.padEnd(16) +
        date.padEnd(22) +
        model.padEnd(32) +
        prompts +
        lines +
        tokens +
        preview
      );
    }

    console.log();
    debugLog(`[history] Listed ${recent.length} sessions`);
  } catch (err) {
    debugLog(`[history] Error: ${String(err)}`);
    if (jsonOutput || jsonSchema) {
      return [];
    }
    console.error("Failed to fetch history:", String(err));
    process.exit(1);
  }
}

/** Returns session list for programmatic use in TUI (per-directory filtered) */
export async function cmdHistoryList(limit = 20, projectDir?: string): Promise<SessionSummary[]> {
  if (isSelfHosted()) {
    return listLocalSessions(limit, projectDir) as SessionSummary[];
  }

  try {
    const api = getApiClient();
    const params: Record<string, unknown> = { limit: 100 };
    if (projectDir) params["project_dir"] = projectDir;
    const res = await api.get<{ sessions: SessionSummary[] }>("/sessions", { params });
    const sessions = res.data.sessions ?? [];
    return sessions.slice(0, limit);
  } catch {
    return [];
  }
}

function formatHistorySessions(sessions: SessionSummary[], projectDir?: string): string {
  if (sessions.length === 0) {
    return "No sessions found for this directory.";
  }

  const lines = sessions.map((session, index) => {
    const date = new Date(session.created_at).toLocaleString();
    const model = session.model_id ?? "unknown";
    const prompts = session.messages_count ?? session.message_count ?? 0;
    const tokens = session.tokens_used ? `${session.tokens_used.toLocaleString()} tokens` : "";
    const prompt = session.prompt_text ? ` - ${session.prompt_text.slice(0, 80)}` : "";
    return `${index + 1}. ${session.id.slice(0, 12)}...  ${date}  ${model}  ${prompts} prompt(s)${tokens ? `, ${tokens}` : ""}${prompt}`;
  });

  return [
    `Session history${projectDir ? ` for ${projectDir}` : ""}`,
    "",
    ...lines,
    "",
    "Resume with /resume <session-id>.",
  ].join("\n");
}

export const historyCommand: CommandDefinition = {
  name: "history",
  description: "List recent sessions for this directory",
  usage: "/history [limit]",
  category: "session",
  async execute(context, args) {
    const parsedLimit = Number.parseInt(args[0] ?? "", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    const projectDir = context.cwd ?? process.cwd();
    const sessions = await cmdHistoryList(limit, projectDir);
    return {
      success: true,
      message: formatHistorySessions(sessions, projectDir),
      data: { sessions },
    };
  },
};

