import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"

const log = Log.create({ service: "trust" })

export interface TrustedDirectory {
  path: string
  trustedAt: number
  name?: string
}

export interface TrustStore {
  version: number
  directories: TrustedDirectory[]
}

const TRUST_STORE_VERSION = 1

function trustFilePath(): string {
  return path.join(Global.Path.config, "trusted.json")
}

async function loadStore(): Promise<TrustStore> {
  try {
    const data = await Filesystem.readJson<TrustStore>(trustFilePath())
    if (data.version === TRUST_STORE_VERSION && Array.isArray(data.directories)) {
      return data
    }
  } catch {
    // File doesn't exist or is corrupted, create new store
  }
  return { version: TRUST_STORE_VERSION, directories: [] }
}

async function saveStore(store: TrustStore): Promise<void> {
  await Filesystem.writeJson(trustFilePath(), store)
}

export namespace Trust {
  export async function isTrusted(directory: string): Promise<boolean> {
    const normalized = path.resolve(directory)
    const store = await loadStore()
    return store.directories.some((d) => path.resolve(d.path) === normalized)
  }

  export async function trust(directory: string, name?: string): Promise<void> {
    const normalized = path.resolve(directory)
    const store = await loadStore()
    const existing = store.directories.findIndex((d) => path.resolve(d.path) === normalized)
    const entry: TrustedDirectory = {
      path: normalized,
      trustedAt: Date.now(),
      name,
    }
    if (existing >= 0) {
      store.directories[existing] = entry
    } else {
      store.directories.push(entry)
    }
    await saveStore(store)
    log.info("trusted directory", { path: normalized })
  }

  export async function untrust(directory: string): Promise<void> {
    const normalized = path.resolve(directory)
    const store = await loadStore()
    store.directories = store.directories.filter((d) => path.resolve(d.path) !== normalized)
    await saveStore(store)
    log.info("untrusted directory", { path: normalized })
  }

  export async function list(): Promise<TrustedDirectory[]> {
    const store = await loadStore()
    return store.directories
  }

  export async function removeStale(): Promise<number> {
    const { existsSync } = await import("fs")
    const store = await loadStore()
    const before = store.directories.length
    store.directories = store.directories.filter((d) => existsSync(d.path))
    const removed = before - store.directories.length
    if (removed > 0) {
      await saveStore(store)
      log.info("removed stale trusted directories", { count: removed })
    }
    return removed
  }
}
