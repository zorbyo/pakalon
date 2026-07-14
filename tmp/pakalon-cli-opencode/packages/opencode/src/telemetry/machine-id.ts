import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"
import { randomUUID } from "crypto"

const log = Log.create({ service: "telemetry:machine-id" })

const MACHINE_ID_FILE = path.join(Global.Path.data, "machine-id.json")

interface MachineInfo {
  id: string
  platform: string
  arch: string
  createdAt: number
}

export namespace MachineId {
  let cached: string | undefined

  export async function get(): Promise<string> {
    if (cached) return cached
    try {
      const info = await Filesystem.readJson<MachineInfo>(MACHINE_ID_FILE)
      cached = info.id
      return info.id
    } catch {
      return generate()
    }
  }

  async function generate(): Promise<string> {
    const id = randomUUID()
    const info: MachineInfo = {
      id,
      platform: process.platform,
      arch: process.arch,
      createdAt: Date.now(),
    }
    await Filesystem.writeJson(MACHINE_ID_FILE, info, 0o600)
    cached = id
    log.info("generated machine ID", { id })
    return id
  }

  export async function getInfo(): Promise<MachineInfo> {
    try {
      return await Filesystem.readJson<MachineInfo>(MACHINE_ID_FILE)
    } catch {
      const id = await generate()
      return {
        id,
        platform: process.platform,
        arch: process.arch,
        createdAt: Date.now(),
      }
    }
  }
}
