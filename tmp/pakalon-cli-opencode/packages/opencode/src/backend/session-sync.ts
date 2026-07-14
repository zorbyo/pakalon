import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { isBackendEnabled } from "./types"
import { SessionsBackend } from "./sessions"
import { MachineId } from "@/telemetry/machine-id"

const log = Log.create({ service: "backend:session-sync" })
const mapFile = path.join(Global.Path.state, "backend-session-map.json")

type MapStore = {
  sessions: Record<string, string>
}

let cache: MapStore | undefined
let readPromise: Promise<MapStore> | undefined
let writeQueue = Promise.resolve()

async function load(): Promise<MapStore> {
  if (cache) return cache
  if (readPromise) return readPromise

  readPromise = Filesystem.readJson<MapStore>(mapFile)
    .then((data) => {
      cache = {
        sessions: data?.sessions ?? {},
      }
      return cache
    })
    .catch(() => {
      cache = { sessions: {} }
      return cache
    })
    .finally(() => {
      readPromise = undefined
    })

  return readPromise
}

function persist(store: MapStore) {
  writeQueue = writeQueue
    .then(() => Filesystem.writeJson(mapFile, store, 0o600))
    .catch((error) => {
      log.warn("failed to persist backend session map", { error })
    })
}

async function put(localSessionID: string, backendSessionID: string) {
  const store = await load()
  if (store.sessions[localSessionID] === backendSessionID) return
  store.sessions[localSessionID] = backendSessionID
  persist(store)
}

export namespace BackendSessionSync {
  export async function getBackendSessionID(localSessionID: string): Promise<string | undefined> {
    const store = await load()
    return store.sessions[localSessionID]
  }

  export async function ensureSession(input: {
    localSessionID: string
    title?: string
    modelID?: string
    mode?: string
    createdAt?: number
  }): Promise<string | undefined> {
    if (!isBackendEnabled()) return undefined

    const existing = await getBackendSessionID(input.localSessionID)
    if (existing) return existing

    try {
      const machineID = await MachineId.get().catch(() => undefined)
      const created = await SessionsBackend.createSession({
        title: input.title,
        model_id: input.modelID,
        mode: input.mode,
        machine_id: machineID,
        created_at: input.createdAt ? new Date(input.createdAt).toISOString() : undefined,
      })
      await put(input.localSessionID, created.id)
      return created.id
    } catch (error) {
      log.warn("failed to create backend session", {
        localSessionID: input.localSessionID,
        error,
      })
      return undefined
    }
  }

  export async function mirrorMessage(input: {
    localSessionID: string
    role: "user" | "assistant" | "system"
    content: string
    tokensUsed?: number
    inputTokens?: number
    outputTokens?: number
    title?: string
    modelID?: string
    mode?: string
    createdAt?: number
  }): Promise<void> {
    if (!isBackendEnabled()) return
    if (!input.content.trim()) return

    const backendSessionID = await ensureSession({
      localSessionID: input.localSessionID,
      title: input.title,
      modelID: input.modelID,
      mode: input.mode,
      createdAt: input.createdAt,
    })
    if (!backendSessionID) return

    try {
      await SessionsBackend.addMessage(backendSessionID, {
        role: input.role,
        content: input.content,
        tokens_used: Math.max(0, input.tokensUsed ?? 0),
        input_tokens: Math.max(0, input.inputTokens ?? 0),
        output_tokens: Math.max(0, input.outputTokens ?? 0),
        created_at: input.createdAt ? new Date(input.createdAt).toISOString() : undefined,
      })
    } catch (error) {
      log.warn("failed to mirror backend message", {
        localSessionID: input.localSessionID,
        backendSessionID,
        role: input.role,
        error,
      })
    }
  }

  export async function mirrorUsage(input: {
    localSessionID: string
    usage: {
      tokens_used: number
      input_tokens?: number
      output_tokens?: number
      lines_written: number
      model_id: string
      context_window_size?: number
      context_window_used?: number
    }
    title?: string
    mode?: string
    createdAt?: number
  }): Promise<void> {
    if (!isBackendEnabled()) return

    const backendSessionID = await ensureSession({
      localSessionID: input.localSessionID,
      title: input.title,
      modelID: input.usage.model_id,
      mode: input.mode,
      createdAt: input.createdAt,
    })
    if (!backendSessionID) return

    try {
      await SessionsBackend.recordUsage(backendSessionID, input.usage)
    } catch (error) {
      log.warn("failed to mirror backend usage", {
        localSessionID: input.localSessionID,
        backendSessionID,
        error,
      })
    }
  }
}
