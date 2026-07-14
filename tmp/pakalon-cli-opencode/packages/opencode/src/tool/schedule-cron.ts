import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./schedule-cron.txt"
import { Log } from "../util/log"

export const log = Log.create({ service: "schedule-cron-tool" })

// Scheduled task interface
interface ScheduledTask {
  id: string
  name: string
  cron: string
  command: string
  enabled: boolean
  createdAt: string
  lastRun?: string
  nextRun?: string
}

// In-memory task storage (in production, this would be persisted)
const scheduledTasks: Map<string, ScheduledTask> = new Map()

/**
 * Parse cron expression and calculate next run time
 */
function parseNextRun(cron: string): Date {
  const parts = cron.split(" ")
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression. Expected 5 fields: minute hour day month weekday")
  }

  const now = new Date()
  const next = new Date(now)

  // Simple implementation - just add 1 hour for now
  // In production, use a proper cron parser like node-cron or cron-parser
  next.setHours(next.getHours() + 1)
  next.setMinutes(0)
  next.setSeconds(0)
  next.setMilliseconds(0)

  return next
}

/**
 * Validate cron expression
 */
function validateCron(cron: string): { valid: boolean; error?: string } {
  const parts = cron.trim().split(/\s+/)

  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Invalid cron expression. Expected 5 fields, got ${parts.length}. Format: minute hour day month weekday`,
    }
  }

  const ranges = [
    { name: "minute", min: 0, max: 59 },
    { name: "hour", min: 0, max: 23 },
    { name: "day", min: 1, max: 31 },
    { name: "month", min: 1, max: 12 },
    { name: "weekday", min: 0, max: 6 },
  ]

  for (let i = 0; i < 5; i++) {
    const part = parts[i]
    const range = ranges[i]

    // Allow wildcards
    if (part === "*") continue

    // Check for step values (*/n)
    if (part.startsWith("*/")) {
      const step = parseInt(part.substring(2), 10)
      if (isNaN(step) || step < 1) {
        return { valid: false, error: `Invalid step value in ${range.name}: ${part}` }
      }
      continue
    }

    // Check for ranges (n-m)
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n, 10))
      if (isNaN(start) || isNaN(end) || start < range.min || end > range.max || start > end) {
        return { valid: false, error: `Invalid range in ${range.name}: ${part}` }
      }
      continue
    }

    // Check for lists (n,m,...)
    if (part.includes(",")) {
      const values = part.split(",").map((n) => parseInt(n, 10))
      if (values.some((v) => isNaN(v) || v < range.min || v > range.max)) {
        return { valid: false, error: `Invalid list value in ${range.name}: ${part}` }
      }
      continue
    }

    // Check single value
    const value = parseInt(part, 10)
    if (isNaN(value) || value < range.min || value > range.max) {
      return { valid: false, error: `Invalid ${range.name} value: ${part}. Expected ${range.min}-${range.max}` }
    }
  }

  return { valid: true }
}

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

/**
 * Get all scheduled tasks
 */
export function getAllScheduledTasks(): ScheduledTask[] {
  return Array.from(scheduledTasks.values())
}

/**
 * Get scheduled task by name
 */
export function getScheduledTask(name: string): ScheduledTask | undefined {
  for (const task of scheduledTasks.values()) {
    if (task.name === name) {
      return task
    }
  }
  return undefined
}

export const ScheduleCronTool = Tool.define("schedule_cron", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      cron: z
        .string()
        .optional()
        .describe("Cron expression (e.g., '0 * * * *' for every hour)"),
      command: z
        .string()
        .optional()
        .describe("The command to execute"),
      name: z
        .string()
        .describe("A name for this scheduled task"),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the schedule is active (default: true)"),
    }),
    async execute(params, ctx) {
      const { cron, command, name, enabled = true } = params

      // Check if updating existing task
      const existingTask = getScheduledTask(name)

      if (existingTask) {
        // Update existing task
        if (enabled === false) {
          existingTask.enabled = false
          log.info("schedule disabled", { name, id: existingTask.id })

          return {
            title: "Schedule Disabled",
            metadata: {
              id: existingTask.id,
              name,
              enabled: false,
            },
            output: `Disabled scheduled task "${name}"`,
          }
        }

        if (cron) {
          const validation = validateCron(cron)
          if (!validation.valid) {
            throw new Error(validation.error)
          }
          existingTask.cron = cron
          existingTask.nextRun = parseNextRun(cron).toISOString()
        }

        if (command) {
          existingTask.command = command
        }

        existingTask.enabled = enabled

        log.info("schedule updated", { name, id: existingTask.id })

        return {
          title: "Schedule Updated",
          metadata: {
            id: existingTask.id,
            name,
            cron: existingTask.cron,
            command: existingTask.command,
            enabled: existingTask.enabled,
            nextRun: existingTask.nextRun,
          },
          output: `Updated scheduled task "${name}". Next run: ${existingTask.nextRun}`,
        }
      }

      // Create new task
      if (!cron || !command) {
        throw new Error("Both 'cron' and 'command' are required when creating a new scheduled task")
      }

      const validation = validateCron(cron)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      const id = generateTaskId()
      const nextRun = parseNextRun(cron)

      const task: ScheduledTask = {
        id,
        name,
        cron,
        command,
        enabled,
        createdAt: new Date().toISOString(),
        nextRun: nextRun.toISOString(),
      }

      scheduledTasks.set(id, task)

      log.info("schedule created", { name, id, cron, command })

      return {
        title: "Schedule Created",
        metadata: {
          id,
          name,
          cron,
          command,
          enabled,
          nextRun: nextRun.toISOString(),
        },
        output: `Created scheduled task "${name}" (${cron}). Next run: ${nextRun.toISOString()}`,
      }
    },
  }
})
