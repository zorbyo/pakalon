import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./sleep.txt"
import { Log } from "../util/log"

export const log = Log.create({ service: "sleep-tool" })

const MAX_SLEEP_MS = 5 * 60 * 1000 // 5 minutes max
const MIN_SLEEP_MS = 100 // 100ms minimum

export const SleepTool = Tool.define("sleep", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      duration_ms: z
        .number()
        .min(MIN_SLEEP_MS)
        .max(MAX_SLEEP_MS)
        .describe(`Duration to sleep in milliseconds (${MIN_SLEEP_MS}-${MAX_SLEEP_MS})`),
    }),
    async execute(params, ctx) {
      const { duration_ms } = params
      
      // Validate duration
      if (duration_ms < MIN_SLEEP_MS) {
        throw new Error(`Sleep duration must be at least ${MIN_SLEEP_MS}ms`)
      }
      
      if (duration_ms > MAX_SLEEP_MS) {
        throw new Error(`Sleep duration cannot exceed ${MAX_SLEEP_MS}ms (${MAX_SLEEP_MS / 60000} minutes)`)
      }
      
      log.info("sleep start", { duration_ms })
      
      const startTime = Date.now()
      let interrupted = false
      
      // Create a promise that resolves after the duration or when aborted
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve()
        }, duration_ms)
        
        // Handle abort
        const abortHandler = () => {
          interrupted = true
          clearTimeout(timeout)
          resolve()
        }
        
        if (ctx.abort.aborted) {
          interrupted = true
          clearTimeout(timeout)
          resolve()
          return
        }
        
        ctx.abort.addEventListener("abort", abortHandler, { once: true })
      })
      
      const actualDuration = Date.now() - startTime
      
      log.info("sleep end", { 
        duration_ms, 
        actualDuration, 
        interrupted 
      })
      
      if (interrupted) {
        return {
          title: "Sleep Interrupted",
          metadata: {
            requested_ms: duration_ms,
            actual_ms: actualDuration,
            interrupted: true,
          },
          output: `Sleep interrupted after ${actualDuration}ms (requested ${duration_ms}ms)`,
        }
      }
      
      return {
        title: "Sleep Complete",
        metadata: {
          requested_ms: duration_ms,
          actual_ms: actualDuration,
          interrupted: false,
        },
        output: `Slept for ${actualDuration}ms`,
      }
    },
  }
})
