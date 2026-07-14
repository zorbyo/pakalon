import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

export const UsageTable = sqliteTable(
  "usage",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    model_id: text().notNull(),
    provider_id: text().notNull(),
    input_tokens: integer().notNull().default(0),
    output_tokens: integer().notNull().default(0),
    cost: real().notNull().default(0),
    time_created: integer().notNull(),
  },
  (table) => [
    index("usage_session_idx").on(table.session_id),
    index("usage_model_idx").on(table.model_id),
    index("usage_time_idx").on(table.time_created),
  ],
)

export const BillingTable = sqliteTable(
  "billing",
  {
    id: text().primaryKey(),
    user_id: text().notNull(),
    period_start: integer().notNull(),
    period_end: integer().notNull(),
    total_cost: real().notNull().default(0),
    status: text().notNull().default("pending"),
    invoice_id: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("billing_user_idx").on(table.user_id),
    index("billing_period_idx").on(table.period_start, table.period_end),
  ],
)

export const TelemetryTable = sqliteTable(
  "telemetry",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    category: text().notNull(),
    data: text({ mode: "json" }),
    time_created: integer().notNull(),
  },
  (table) => [
    index("telemetry_type_idx").on(table.type),
    index("telemetry_category_idx").on(table.category),
    index("telemetry_time_idx").on(table.time_created),
  ],
)
