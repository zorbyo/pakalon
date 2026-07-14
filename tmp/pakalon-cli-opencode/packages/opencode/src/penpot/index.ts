import { PenpotDocker } from "./docker"
import { PenpotSync } from "./sync"
import { PenpotClient } from "./client"
import { PenpotBrowser } from "./browser"
import { Log } from "../util/log"

const log = Log.create({ service: "penpot" })

export namespace Penpot {
  export const Docker = PenpotDocker
  export const Sync = PenpotSync
  export const Client = PenpotClient
  export const Browser = PenpotBrowser

  export async function start(): Promise<boolean> {
    log.info("starting penpot integration")
    return PenpotDocker.start()
  }

  export async function stop(): Promise<boolean> {
    log.info("stopping penpot integration")
    return PenpotDocker.stop()
  }

  export async function openInBrowser(fileId?: string): Promise<void> {
    await PenpotBrowser.open(fileId)
  }

  export function getUrl(): string {
    return PenpotDocker.getURL()
  }
}

export { PenpotDocker } from "./docker"
export { PenpotSync } from "./sync"
export { PenpotClient } from "./client"
export { PenpotBrowser } from "./browser"
