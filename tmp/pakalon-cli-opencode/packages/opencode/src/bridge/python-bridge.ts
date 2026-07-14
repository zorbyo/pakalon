import { Log } from "../util/log"
import { Process } from "../util/process"
import path from "path"

const log = Log.create({ service: "python:bridge" })

interface AgentResponse {
  result: string
  artifacts: string[]
}

interface HealthResponse {
  status: string
  agents: string[]
}

export namespace PythonBridge {
  const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://127.0.0.1:7432"

  let bridgeProcess: Process.Child | null = null
  let running = false

  async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${BRIDGE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Python bridge request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`)
    }

    return (await response.json()) as T
  }

  async function waitForHealthy(timeoutMs = 15_000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        await getHealth()
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
    throw new Error("Python bridge failed to become healthy before timeout")
  }

  export function isRunning(): boolean {
    return running && bridgeProcess !== null
  }

  export async function start(): Promise<void> {
    if (isRunning()) {
      log.info("python bridge already running")
      return
    }

    const scriptPath = path.resolve(process.cwd(), "python", "bridge", "server.py")
    log.info("starting python bridge", { scriptPath, url: BRIDGE_URL })

    try {
      bridgeProcess = Process.spawn(["python", scriptPath], {
        stdout: "pipe",
        stderr: "pipe",
      })

      bridgeProcess.stdout?.on("data", (chunk) => {
        log.debug("python bridge stdout", { line: chunk.toString().trim() })
      })
      bridgeProcess.stderr?.on("data", (chunk) => {
        log.warn("python bridge stderr", { line: chunk.toString().trim() })
      })

      bridgeProcess.exited.then((code) => {
        running = false
        bridgeProcess = null
        log.info("python bridge process exited", { code })
      }).catch((error) => {
        running = false
        bridgeProcess = null
        log.error("python bridge process failed", { error })
      })

      running = true
      await waitForHealthy()
      log.info("python bridge started")
    } catch (error) {
      running = false
      bridgeProcess = null
      log.error("failed to start python bridge", { error })
      throw error
    }
  }

  export async function stop(): Promise<void> {
    if (!bridgeProcess) {
      running = false
      return
    }

    log.info("stopping python bridge")
    try {
      bridgeProcess.kill("SIGTERM")
      await Promise.race([
        bridgeProcess.exited,
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ])
    } catch (error) {
      log.warn("failed to stop python bridge gracefully", { error })
    } finally {
      running = false
      bridgeProcess = null
    }
  }

  export async function callAgent(
    phase: number,
    prompt: string,
    context: Record<string, unknown>,
  ): Promise<AgentResponse> {
    log.info("calling python bridge agent", { phase })
    try {
      return await request<AgentResponse>(`/agent/${phase}`, {
        method: "POST",
        body: JSON.stringify({ prompt, context }),
      })
    } catch (error) {
      log.error("python bridge callAgent failed", { phase, error })
      throw error
    }
  }

  export async function getHealth(): Promise<HealthResponse> {
    try {
      return await request<HealthResponse>("/health", { method: "GET" })
    } catch (error) {
      log.error("python bridge health check failed", { error })
      throw error
    }
  }
}
