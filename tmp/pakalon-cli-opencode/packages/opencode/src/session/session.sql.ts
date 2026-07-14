import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "../snapshot"
import type { PermissionNext } from "../permission/next"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "./schema"
import type { WorkspaceID } from "../control-plane/schema"
import { Timestamps } from "../storage/schema.sql"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

// Execution modes for sessions
export type ExecutionMode = "plan" | "edit" | "auto_accept" | "bypass" | "hil"

// Session history action types
export type SessionHistoryAction = "file_created" | "file_modified" | "file_deleted" | "command_executed" | "phase_started" | "phase_completed"

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionID>().primaryKey(),
    project_id: text()
    .$type<ProjectID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceID>(),
    parent_id: text().$type<SessionID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    // New fields for enhanced session tracking
    last_active_phase: integer().default(0),
    total_token_usage: integer().default(0),
    model_used: text(),
    mode: text().$type<ExecutionMode>().default("hil"),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

// Session history table for tracking file changes
export const SessionHistoryTable = sqliteTable(
  "session_history",
  {
    id: text().primaryKey(), // Will use Identifier.ascending()
    session_id: text()
    .$type<SessionID>()
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
    action: text().$type<SessionHistoryAction>().notNull(),
    file_path: text().notNull(),
    diff: text(), // JSON string for diff content
    metadata: text({ mode: "json" }).$type<{
      oldPath?: string
      size?: number
      linesAdded?: number
      linesRemoved?: number
    }>(),
    ...Timestamps,
  },
  (table) => [
    index("session_history_session_idx").on(table.session_id),
    index("session_history_time_idx").on(table.time_created),
  ],
)

// Token usage tracking table
export const SessionTokenUsageTable = sqliteTable(
  "session_token_usage",
  {
    id: text().primaryKey(),
    session_id: text()
    .$type<SessionID>()
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
    date: text().notNull(), // YYYY-MM-DD format
    model: text().notNull(),
    input_tokens: integer().notNull().default(0),
    output_tokens: integer().notNull().default(0),
    reasoning_tokens: integer().notNull().default(0),
    cache_read_tokens: integer().notNull().default(0),
    cache_write_tokens: integer().notNull().default(0),
    cost: integer().notNull().default(0), // Stored as integer (cents)
    ...Timestamps,
  },
  (table) => [
    index("session_token_usage_session_idx").on(table.session_id),
    index("session_token_usage_date_idx").on(table.date),
    index("session_token_usage_session_date_idx").on(table.session_id, table.date),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})
