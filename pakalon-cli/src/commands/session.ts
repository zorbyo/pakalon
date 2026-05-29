/**
 * Session management commands.
 */
import { getApiClient } from "@/api/client.js";
import { useStore } from "@/store/index.js";
import { isSelfHosted } from "@/config/mode.js";
import {
  appendLocalSessionMessage,
  createLocalSession,
  forkLocalSession,
  listLocalSessions,
  loadLocalSessionMessages,
  resolveLatestLocalSessionId,
} from "@/db/local.js";
import type { CommandDefinition } from "./types.js";

export interface SessionSummary {
  id: string;
  title: string | null;
  mode: string;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  prompt_text?: string | null;
  message_count?: number;
  messages_count?: number;
}

export async function cmdListSessions(limit = 10, cwd?: string | null): Promise<SessionSummary[]> {
  if (isSelfHosted()) {
    return listLocalSessions(limit, cwd) as SessionSummary[];
  }

  const client = getApiClient();
  const projectDir = cwd === null ? undefined : (cwd ?? process.cwd());
  const res = await client.get<{ sessions: SessionSummary[] }>("/sessions", {
    params: projectDir ? { limit, project_dir: projectDir } : { limit },
  });
  return res.data.sessions ?? [];
}

export async function cmdCreateSession(title?: string, mode = "chat", cwd?: string): Promise<SessionSummary> {
  if (isSelfHosted()) {
    const { selectedModel } = useStore.getState();
    const session = createLocalSession(title, mode, cwd ?? process.cwd(), selectedModel);
    useStore.getState().setSessionId(session.id);
    return session as SessionSummary;
  }

  const client = getApiClient();
  const { selectedModel } = useStore.getState();
  const projectDir = cwd ?? process.cwd();
  const res = await client.post<SessionSummary>("/sessions", {
    title,
    mode,
    model_id: selectedModel,
    project_dir: projectDir,
  });
  useStore.getState().setSessionId(res.data.id);
  return res.data;
}

export async function cmdClearLocalSession(): Promise<void> {
  useStore.getState().clearSession();
}

/**
 * Resume a previous session by loading its messages from the backend.
 * If sessionId is omitted, the most recent session is used.
 */
export async function cmdResumeSession(sessionId?: string, cwd?: string | null): Promise<string | null> {
  if (isSelfHosted()) {
    const targetId = sessionId ?? resolveLatestLocalSessionId(cwd ?? process.cwd());
    if (!targetId) return null;

    const messages = loadLocalSessionMessages(targetId);
    const store = useStore.getState();
    store.clearSession();
    store.setSessionId(targetId);
    for (const message of messages) {
      store.addMessage({
        id: message.id,
        role: message.role as "user" | "assistant" | "system" | "tool",
        content: message.content,
        createdAt: new Date(message.created_at),
        isStreaming: false,
      });
    }
    return targetId;
  }

  const client = getApiClient();
  const projectDir = cwd === null ? undefined : (cwd ?? process.cwd());

  // Resolve target session id
  let targetId = sessionId;
  if (!targetId) {
    const res = await client.get<{ sessions: SessionSummary[] }>("/sessions", {
      params: projectDir ? { limit: 1, project_dir: projectDir } : { limit: 1 },
    });
    let sessions = res.data.sessions ?? [];
    if (!sessions.length && projectDir) {
      const fallback = await client.get<{ sessions: SessionSummary[] }>("/sessions", {
        params: { limit: 1 },
      });
      sessions = fallback.data.sessions ?? [];
    }
    if (!sessions.length) return null;
    targetId = sessions[0]!.id;
  }

  // Load messages
  const msgsRes = await client.get<{ messages: Array<{ id: string; role: string; content: string; created_at: string }> }>(
    `/sessions/${targetId}/messages`
  );
  const msgs = msgsRes.data.messages ?? [];

  // Hydrate store
  const store = useStore.getState();
  store.clearSession();
  store.setSessionId(targetId);
  for (const m of msgs) {
    store.addMessage({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: new Date(m.created_at),
      isStreaming: false,
    });
  }

  return targetId;
}

/**
 * Fork the most recent session — creates a new session pre-populated with
 * all messages from the source session so conversations can diverge cleanly.
 */
export async function cmdForkSession(sourceSessionId?: string, cwd?: string): Promise<string | null> {
  if (isSelfHosted()) {
    const store = useStore.getState();
    const srcId = sourceSessionId ?? store.sessionId ?? resolveLatestLocalSessionId(cwd ?? process.cwd());
    if (!srcId) return null;
    const newId = forkLocalSession(srcId, cwd ?? process.cwd(), store.selectedModel);
    store.clearSession();
    store.setSessionId(newId);
    for (const message of loadLocalSessionMessages(newId)) {
      store.addMessage({
        id: message.id,
        role: message.role as "user" | "assistant" | "system" | "tool",
        content: message.content,
        createdAt: new Date(message.created_at),
        isStreaming: false,
      });
    }
    return newId;
  }

  const client = getApiClient();
  const projectDir = cwd ?? process.cwd();

  // Resolve source session
  let srcId = sourceSessionId ?? useStore.getState().sessionId ?? undefined;
  if (!srcId) {
    const res = await client.get<{ sessions: Array<SessionSummary> }>("/sessions", {
      params: { limit: 1, project_dir: projectDir },
    });
    const sessions = res.data.sessions ?? [];
    if (!sessions.length) return null;
    srcId = sessions[0]!.id;
  }

  // Load source messages
  const msgsRes = await client.get<{ messages: Array<{ id: string; role: string; content: string; created_at: string }> }>(
    `/sessions/${srcId}/messages`
  );
  const msgs = msgsRes.data.messages ?? [];

  // Create a new (forked) session
  const { selectedModel } = useStore.getState();
  const forkRes = await client.post<SessionSummary>("/sessions", {
    title: `Fork of ${srcId.slice(0, 8)}…`,
    mode: "chat",
    model_id: selectedModel,
    project_dir: projectDir,
  });
  const newId = forkRes.data.id;
  useStore.getState().setSessionId(newId);

  // Copy messages into the fork
  const store = useStore.getState();
  store.clearSession();
  store.setSessionId(newId);
  for (const m of msgs) {
    store.addMessage({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: new Date(m.created_at),
      isStreaming: false,
    });
    // Persist in backend too
    await client.post(`/sessions/${newId}/messages`, { role: m.role, content: m.content }).catch(() => {});
  }

  return newId;
}

/**
 * Replay stored user-only messages from the most recent session.
 * Useful for re-running a conversation with a different model / settings.
 */
export async function cmdReplayUserMessages(cwd?: string): Promise<string[]> {
  if (isSelfHosted()) {
    const sessionId = resolveLatestLocalSessionId(cwd ?? process.cwd());
    if (!sessionId) return [];
    return loadLocalSessionMessages(sessionId)
      .filter((message) => message.role === "user")
      .map((message) => message.content);
  }

  const client = getApiClient();
  const projectDir = cwd ?? process.cwd();

  const res = await client.get<{ sessions: Array<SessionSummary> }>("/sessions", {
    params: { limit: 1, project_dir: projectDir },
  });
  const sessions = res.data.sessions ?? [];
  if (!sessions.length) return [];

  const msgsRes = await client.get<{ messages: Array<{ role: string; content: string }> }>(
    `/sessions/${sessions[0]!.id}/messages`
  );
  return (msgsRes.data.messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content);
}

/**
 * --continue flag: resume the most recent session from the backend.
 * Alias for cmdResumeSession() with no session ID argument.
 */
export async function cmdContinue(cwd?: string): Promise<string | null> {
  return cmdResumeSession(undefined, cwd);
}

export function cmdAppendSessionMessageLocal(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  model?: string | null,
): void {
  appendLocalSessionMessage(sessionId, role, content, model);
}

function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return "No sessions found for this directory.";
  }

  const lines = sessions.map((session, index) => {
    const date = new Date(session.updated_at ?? session.created_at).toLocaleString();
    const model = session.model_id ?? "unknown";
    const count = session.messages_count ?? session.message_count ?? 0;
    const title = session.title ? ` - ${session.title}` : "";
    return `${index + 1}. ${session.id.slice(0, 12)}...  ${date}  ${model}  ${count} message(s)${title}`;
  });

  return ["Sessions", "", ...lines, "", "Use /resume <session-id> to resume a session."].join("\n");
}

export const newSessionCommand: CommandDefinition = {
  name: "new",
  description: "Start a new chat session",
  usage: "/new [title]",
  category: "session",
  async execute(context, args) {
    const title = args.join(" ").trim() || undefined;
    const session = await cmdCreateSession(title, "chat", context.cwd ?? process.cwd());
    return {
      success: true,
      message: `New session started: ${session.id}`,
      data: { session },
    };
  },
};

export const resumeCommand: CommandDefinition = {
  name: "resume",
  description: "Resume a previous session",
  usage: "/resume [session-id]",
  category: "session",
  async execute(context, args) {
    const sessionId = args.join(" ").trim() || undefined;
    const resumed = await cmdResumeSession(sessionId, context.cwd ?? process.cwd());
    if (!resumed) {
      return {
        success: false,
        message: sessionId ? `Session not found: ${sessionId}` : "No previous session found.",
      };
    }
    return {
      success: true,
      message: `Session resumed: ${resumed}`,
      data: { sessionId: resumed },
    };
  },
};

export const sessionCommand: CommandDefinition = {
  name: "session",
  aliases: ["sessions"],
  description: "List, create, or resume sessions",
  usage: "/session [list|new|resume <id>]",
  category: "session",
  async execute(context, args) {
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "new" || subcommand === "create") {
      return newSessionCommand.execute(context, args.slice(1));
    }
    if (subcommand === "resume") {
      return resumeCommand.execute(context, args.slice(1));
    }

    const sessions = await cmdListSessions(20, context.cwd ?? process.cwd());
    return {
      success: true,
      message: formatSessionList(sessions),
      data: { sessions },
    };
  },
};
