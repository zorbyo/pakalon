import type { CoreMessage } from "ai";
import type { QuerySource as ToolQuerySource } from "@/tools/tool-types.js";

export type QuerySource =
  | ToolQuerySource
  | "user"
  | "repl"
  | "sdk"
  | "compact"
  | "session_memory"
  | "reactive_compact";

export interface Message {
  type: "user" | "assistant" | "system" | "progress" | "attachment" | "tool_use_summary" | "tombstone";
  uuid: string;
  timestamp: Date | number;
  message?: CoreMessage;
  content?: unknown;
  [key: string]: unknown;
}
