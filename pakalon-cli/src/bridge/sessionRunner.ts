/**
 * Session spawning for bridge sessions.
 *
 * Handles spawning child CLI processes as bridge sessions,
 * managing their lifecycle, and tracking activities.
 */

import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, type WriteStream } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { createInterface } from "readline";
import type {
  SessionActivity,
  SessionDoneStatus,
  SessionHandle,
  SessionSpawner,
  SessionSpawnOpts,
} from "./types.js";

const MAX_ACTIVITIES = 10;
const MAX_STDERR_LINES = 10;

/**
 * Sanitize a session ID for use in file names.
 */
export function safeFilenameId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export type PermissionRequest = {
  type: "control_request";
  request_id: string;
  request: {
    subtype: "can_use_tool";
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id: string;
  };
};

type SessionSpawnerDeps = {
  execPath: string;
  scriptArgs: string[];
  env: NodeJS.ProcessEnv;
  verbose: boolean;
  sandbox: boolean;
  debugFile?: string;
  permissionMode?: string;
  onDebug: (msg: string) => void;
  onActivity?: (sessionId: string, activity: SessionActivity) => void;
  onPermissionRequest?: (
    sessionId: string,
    request: PermissionRequest,
    accessToken: string
  ) => void;
};

const TOOL_VERBS: Record<string, string> = {
  Read: "Reading",
  Write: "Writing",
  Edit: "Editing",
  MultiEdit: "Editing",
  Bash: "Running",
  Glob: "Searching",
  Grep: "Searching",
  WebFetch: "Fetching",
  WebSearch: "Searching",
  Task: "Running task",
};

function toolSummary(name: string, input: Record<string, unknown>): string {
  const verb = TOOL_VERBS[name] ?? name;
  const target =
    (input.file_path as string) ??
    (input.filePath as string) ??
    (input.pattern as string) ??
    (input.command as string | undefined)?.slice(0, 60) ??
    (input.url as string) ??
    (input.query as string) ??
    "";
  if (target) {
    return `${verb} ${target}`;
  }
  return verb;
}

function jsonParseSafe(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractActivities(
  line: string,
  sessionId: string,
  onDebug: (msg: string) => void
): SessionActivity[] {
  const parsed = jsonParseSafe(line);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const msg = parsed as Record<string, unknown>;
  const activities: SessionActivity[] = [];
  const now = Date.now();

  switch (msg.type) {
    case "assistant": {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) break;
      const content = message.content;
      if (!Array.isArray(content)) break;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;

        if (b.type === "tool_use") {
          const name = (b.name as string) ?? "Tool";
          const input = (b.input as Record<string, unknown>) ?? {};
          const summary = toolSummary(name, input);
          activities.push({ type: "tool_start", summary, timestamp: now });
        } else if (b.type === "text") {
          const text = (b.text as string) ?? "";
          if (text.length > 0) {
            activities.push({
              type: "text",
              summary: text.slice(0, 80),
              timestamp: now,
            });
          }
        }
      }
      break;
    }
    case "result": {
      const subtype = msg.subtype as string | undefined;
      if (subtype === "success") {
        activities.push({
          type: "result",
          summary: "Session completed",
          timestamp: now,
        });
      } else if (subtype) {
        const errors = msg.errors as string[] | undefined;
        const errorSummary = errors?.[0] ?? `Error: ${subtype}`;
        activities.push({ type: "error", summary: errorSummary, timestamp: now });
      }
      break;
    }
  }

  return activities;
}

function extractUserMessageText(
  msg: Record<string, unknown>
): string | undefined {
  if (
    msg.parent_tool_use_id != null ||
    msg.isSynthetic ||
    msg.isReplay
  ) {
    return undefined;
  }

  const message = msg.message as Record<string, unknown> | undefined;
  const content = message?.content;
  let text: string | undefined;

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text"
      ) {
        text = (block as Record<string, unknown>).text as string | undefined;
        break;
      }
    }
  }

  text = text?.trim();
  return text ? text : undefined;
}

export function createSessionSpawner(deps: SessionSpawnerDeps): SessionSpawner {
  return {
    spawn(opts: SessionSpawnOpts, dir: string): SessionHandle {
      const safeId = safeFilenameId(opts.sessionId);

      let debugFile: string | undefined;
      if (deps.debugFile) {
        const ext = deps.debugFile.lastIndexOf(".");
        if (ext > 0) {
          debugFile = `${deps.debugFile.slice(0, ext)}-${safeId}${deps.debugFile.slice(ext)}`;
        } else {
          debugFile = `${deps.debugFile}-${safeId}`;
        }
      } else if (deps.verbose) {
        debugFile = join(tmpdir(), "pakalon", `bridge-session-${safeId}.log`);
      }

      let transcriptStream: WriteStream | null = null;
      let transcriptPath: string | undefined;
      if (deps.debugFile) {
        transcriptPath = join(
          dirname(deps.debugFile),
          `bridge-transcript-${safeId}.jsonl`
        );
        transcriptStream = createWriteStream(transcriptPath, { flags: "a" });
      }

      const args = [
        ...deps.scriptArgs,
        "--print",
        "--sdk-url",
        opts.sdkUrl,
        "--session-id",
        opts.sessionId,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--replay-user-messages",
        ...(deps.verbose ? ["--verbose"] : []),
        ...(debugFile ? ["--debug-file", debugFile] : []),
        ...(deps.permissionMode
          ? ["--permission-mode", deps.permissionMode]
          : []),
      ];

      const env: NodeJS.ProcessEnv = {
        ...deps.env,
        CLAUDE_CODE_OAUTH_TOKEN: undefined,
        CLAUDE_CODE_ENVIRONMENT_KIND: "bridge",
        ...(deps.sandbox && { CLAUDE_CODE_FORCE_SANDBOX: "1" }),
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.accessToken,
        CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2: "1",
        ...(opts.useCcrV2 && {
          CLAUDE_CODE_USE_CCR_V2: "1",
          CLAUDE_CODE_WORKER_EPOCH: String(opts.workerEpoch),
        }),
      };

      const child: ChildProcess = spawn(deps.execPath, args, {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
        env,
        windowsHide: true,
      });

      const activities: SessionActivity[] = [];
      let currentActivity: SessionActivity | null = null;
      const lastStderr: string[] = [];
      let sigkillSent = false;
      let firstUserMessageSeen = false;

      if (child.stderr) {
        const stderrRl = createInterface({ input: child.stderr });
        stderrRl.on("line", (line) => {
          if (deps.verbose) {
            process.stderr.write(line + "\n");
          }
          if (lastStderr.length >= MAX_STDERR_LINES) {
            lastStderr.shift();
          }
          lastStderr.push(line);
        });
      }

      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on("line", (line) => {
          if (transcriptStream) {
            transcriptStream.write(line + "\n");
          }

          const extracted = extractActivities(line, opts.sessionId, deps.onDebug);
          for (const activity of extracted) {
            if (activities.length >= MAX_ACTIVITIES) {
              activities.shift();
            }
            activities.push(activity);
            currentActivity = activity;
            deps.onActivity?.(opts.sessionId, activity);
          }

          const parsed = jsonParseSafe(line);
          if (parsed && typeof parsed === "object") {
            const msg = parsed as Record<string, unknown>;

            if (msg.type === "control_request") {
              const request = msg.request as Record<string, unknown> | undefined;
              if (
                request?.subtype === "can_use_tool" &&
                deps.onPermissionRequest
              ) {
                deps.onPermissionRequest(
                  opts.sessionId,
                  parsed as PermissionRequest,
                  opts.accessToken
                );
              }
            } else if (
              msg.type === "user" &&
              !firstUserMessageSeen &&
              opts.onFirstUserMessage
            ) {
              const text = extractUserMessageText(msg);
              if (text) {
                firstUserMessageSeen = true;
                opts.onFirstUserMessage(text);
              }
            }
          }
        });
      }

      const done = new Promise<SessionDoneStatus>((resolve) => {
        child.on("close", (code, signal) => {
          if (transcriptStream) {
            transcriptStream.end();
            transcriptStream = null;
          }

          if (signal === "SIGTERM" || signal === "SIGINT") {
            resolve("interrupted");
          } else if (code === 0) {
            resolve("completed");
          } else {
            resolve("failed");
          }
        });

        child.on("error", () => {
          resolve("failed");
        });
      });

      const handle: SessionHandle = {
        sessionId: opts.sessionId,
        done,
        activities,
        accessToken: opts.accessToken,
        lastStderr,
        get currentActivity(): SessionActivity | null {
          return currentActivity;
        },
        kill(): void {
          if (!child.killed) {
            if (process.platform === "win32") {
              child.kill();
            } else {
              child.kill("SIGTERM");
            }
          }
        },
        forceKill(): void {
          if (!sigkillSent && child.pid) {
            sigkillSent = true;
            if (process.platform === "win32") {
              child.kill();
            } else {
              child.kill("SIGKILL");
            }
          }
        },
        writeStdin(data: string): void {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write(data);
          }
        },
        updateAccessToken(token: string): void {
          handle.accessToken = token;
          handle.writeStdin(
            JSON.stringify({
              type: "update_environment_variables",
              variables: { CLAUDE_CODE_SESSION_ACCESS_TOKEN: token },
            }) + "\n"
          );
        },
      };

      return handle;
    },
  };
}

export type { SessionSpawner, SessionSpawnOpts, SessionActivity };