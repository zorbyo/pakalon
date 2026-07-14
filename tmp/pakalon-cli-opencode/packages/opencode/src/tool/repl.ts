import z from "zod"
import { spawn, type ChildProcess } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./repl.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Truncate } from "./truncation"

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 30_000 // 30 seconds

export const log = Log.create({ service: "repl-tool" })

type Language = "javascript" | "python" | "typescript"

interface REPLSession {
  process: ChildProcess
  language: Language
  buffer: string
}

// Store REPL sessions per language
const sessions: Map<string, REPLSession> = new Map()

/**
 * Get or create a REPL session for the given language
 */
async function getOrCreateSession(language: Language, sessionID: string, reset: boolean = false): Promise<REPLSession> {
  const key = `${sessionID}-${language}`
  
  if (reset && sessions.has(key)) {
    const existing = sessions.get(key)!
    existing.process.kill()
    sessions.delete(key)
  }
  
  if (sessions.has(key)) {
    return sessions.get(key)!
  }
  
  // Create new REPL process
  let command: string
  let args: string[]
  
  switch (language) {
    case "javascript":
      command = "node"
      args = ["--interactive"]
      break
    case "python":
      command = process.platform === "win32" ? "python" : "python3"
      args = ["-i", "-q"]
      break
    case "typescript":
      command = "npx"
      args = ["ts-node", "--interactive"]
      break
    default:
      throw new Error(`Unsupported language: ${language}`)
  }
  
  const proc = spawn(command, args, {
    cwd: Instance.directory,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: "dumb",
      NO_COLOR: "1",
    },
    windowsHide: true,
  })
  
  const session: REPLSession = {
    process: proc,
    language,
    buffer: "",
  }
  
  proc.stdout?.on("data", (chunk) => {
    session.buffer += chunk.toString()
  })
  
  proc.stderr?.on("data", (chunk) => {
    session.buffer += chunk.toString()
  })
  
  proc.on("exit", () => {
    sessions.delete(key)
  })
  
  sessions.set(key, session)
  
  // Wait for REPL to be ready
  await new Promise((resolve) => setTimeout(resolve, 500))
  session.buffer = "" // Clear startup messages
  
  return session
}

/**
 * Execute code in the REPL and return the output
 */
async function executeInREPL(
  session: REPLSession,
  code: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<string> {
  return new Promise((resolve, reject) => {
    session.buffer = ""
    
    // Add a marker to detect end of output
    const marker = `__PAKALON_REPL_END_${Date.now()}__`
    let markerCode: string
    
    switch (session.language) {
      case "javascript":
      case "typescript":
        markerCode = `\nconsole.log("${marker}")\n`
        break
      case "python":
        markerCode = `\nprint("${marker}")\n`
        break
    }
    
    const fullCode = code + markerCode
    
    const timeoutId = setTimeout(() => {
      resolve(session.buffer + "\n[Timeout: output truncated]")
    }, timeout)
    
    // Check for marker periodically
    const checkInterval = setInterval(() => {
      if (session.buffer.includes(marker)) {
        clearInterval(checkInterval)
        clearTimeout(timeoutId)
        
        // Remove the marker from output
        const output = session.buffer
          .replace(new RegExp(`.*${marker}.*\n?`, "g"), "")
          .trim()
        
        resolve(output)
      }
    }, 100)
    
    // Send code to REPL
    session.process.stdin?.write(fullCode)
  })
}

export const REPLTool = Tool.define("repl", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      language: z
        .enum(["javascript", "python", "typescript"])
        .describe("The programming language to use"),
      code: z
        .string()
        .optional()
        .describe("The code to execute. Required unless reset is true."),
      reset: z
        .boolean()
        .optional()
        .describe("Set to true to reset the REPL state for this language"),
      timeout: z
        .number()
        .optional()
        .describe(`Optional timeout in milliseconds. Default: ${DEFAULT_TIMEOUT}`),
    }),
    async execute(params, ctx) {
      const { language, code, reset, timeout } = params
      
      // Handle reset
      if (reset) {
        const key = `${ctx.sessionID}-${language}`
        if (sessions.has(key)) {
          sessions.get(key)!.process.kill()
          sessions.delete(key)
          log.info("repl reset", { language, sessionID: ctx.sessionID })
        }
        
        if (!code) {
          return {
            title: `Reset ${language} REPL`,
            metadata: {
              language,
              reset: true,
            },
            output: `${language} REPL state has been reset.`,
          }
        }
      }
      
      if (!code) {
        throw new Error("code is required when reset is not true")
      }
      
      try {
        const session = await getOrCreateSession(language, ctx.sessionID, false)
        const output = await executeInREPL(session, code, timeout ?? DEFAULT_TIMEOUT)
        
        // Truncate output if too long
        const truncatedOutput = output.length > MAX_OUTPUT_LENGTH
          ? output.slice(0, MAX_OUTPUT_LENGTH) + "\n\n[Output truncated]"
          : output
        
        log.info("repl execute", {
          language,
          codeLength: code.length,
          outputLength: output.length,
        })
        
        return {
          title: `${language} REPL`,
          metadata: {
            language,
            codeLength: code.length,
            outputLength: output.length,
            truncated: output.length > MAX_OUTPUT_LENGTH,
          },
          output: truncatedOutput,
        }
      } catch (error) {
        log.error("repl error", { language, error: String(error) })
        throw error
      }
    },
  }
})
