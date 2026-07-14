import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import path from "path"
import os from "os"
import crypto from "crypto"

const log = Log.create({ service: "pakalon:telemetry" })

export interface MachineIdentifiers {
  machineId: string
  macMachineId: string
  devDeviceId: string
}

export interface TelemetryEvent {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

export interface StorageJson {
  machineId: string
  macMachineId: string
  devDeviceId: string
  createdAt: number
  lastUpdated: number
}

export namespace TelemetryManager {
  const STORAGE_FILE = path.join(
    os.homedir(),
    ".config",
    "Pakalon",
    "User",
    "globalStorage",
    "storage.json",
  )

  let cachedIdentifiers: MachineIdentifiers | null = null

  export async function getIdentifiers(): Promise<MachineIdentifiers> {
    if (cachedIdentifiers) return cachedIdentifiers

    try {
      const data = await Filesystem.readJson<StorageJson>(STORAGE_FILE)
      cachedIdentifiers = {
        machineId: data.machineId,
        macMachineId: data.macMachineId,
        devDeviceId: data.devDeviceId,
      }
      return cachedIdentifiers
    } catch {
      return await generateAndSaveIdentifiers()
    }
  }

  export async function generateAndSaveIdentifiers(): Promise<MachineIdentifiers> {
    const identifiers: MachineIdentifiers = {
      machineId: crypto.randomUUID(),
      macMachineId: crypto.randomBytes(32).toString("hex"),
      devDeviceId: crypto.randomBytes(16).toString("hex"),
    }

    const storage: StorageJson = {
      ...identifiers,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    }

    try {
      await Filesystem.writeJson(STORAGE_FILE, storage)
      cachedIdentifiers = identifiers
      log.info("Generated and saved machine identifiers")
    } catch (error) {
      log.error("Failed to save machine identifiers", { error })
    }

    return identifiers
  }

  export async function trackEvent(event: TelemetryEvent): Promise<void> {
    const identifiers = await getIdentifiers()

    const payload = {
      ...event,
      machineId: identifiers.machineId,
      timestamp: event.timestamp || Date.now(),
    }

    // Store locally for now
    log.info("Telemetry event", { type: event.type, machineId: identifiers.machineId })

    // In production, this would send to backend
    // await sendToBackend(payload)
  }

  export async function trackPrompt(
    sessionId: string,
    modelId: string,
    tokensUsed: number,
  ): Promise<void> {
    await trackEvent({
      type: "prompt",
      timestamp: Date.now(),
      data: { sessionId, modelId, tokensUsed },
    })
  }

  export async function trackCodeChange(
    sessionId: string,
    filePath: string,
    linesAdded: number,
    linesDeleted: number,
  ): Promise<void> {
    await trackEvent({
      type: "code_change",
      timestamp: Date.now(),
      data: { sessionId, filePath, linesAdded, linesDeleted },
    })
  }

  export async function trackSessionStart(sessionId: string): Promise<void> {
    await trackEvent({
      type: "session_start",
      timestamp: Date.now(),
      data: { sessionId },
    })
  }

  export async function trackSessionEnd(
    sessionId: string,
    duration: number,
    totalTokens: number,
  ): Promise<void> {
    await trackEvent({
      type: "session_end",
      timestamp: Date.now(),
      data: { sessionId, duration, totalTokens },
    })
  }

  export async function getMachineId(): Promise<string> {
    const identifiers = await getIdentifiers()
    return identifiers.machineId
  }

  export async function resetIdentifiers(): Promise<void> {
    await generateAndSaveIdentifiers()
    log.info("Machine identifiers reset")
  }
}

export default TelemetryManager
