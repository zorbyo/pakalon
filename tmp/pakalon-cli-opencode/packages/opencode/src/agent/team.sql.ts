import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const AgentTeamTable = sqliteTable("agent_team", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  color: text()
    .notNull()
    .$default(() => "#6366f1"),
  tools: text().notNull(),
  system_prompt: text().notNull(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now())
    .$onUpdate(() => Date.now()),
})

export const TeamExecutionTable = sqliteTable("team_execution", {
  id: text().primaryKey(),
  team_id: text()
    .notNull()
    .references(() => AgentTeamTable.id, { onDelete: "cascade" }),
  task: text().notNull(),
  status: text({ enum: ["pending", "running", "completed", "failed"] })
    .notNull()
    .$default(() => "pending"),
  result: text(),
  artifacts: text({ mode: "json" }).$type<string[]>(),
  tokens_used: integer(),
  duration_ms: integer(),
  started_at: integer(),
  completed_at: integer(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})
