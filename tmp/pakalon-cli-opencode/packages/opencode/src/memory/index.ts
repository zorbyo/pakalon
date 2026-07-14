import { Mem0 } from "./mem0"
import { Context } from "./context"
import { Log } from "../util/log"

const log = Log.create({ service: "memory" })

export namespace Memory {
  export async function init(projectPath: string): Promise<void> {
    await Mem0.load(projectPath)
    log.info("memory system initialized")
  }

  export async function shutdown(projectPath: string): Promise<void> {
    await Mem0.save(projectPath)
    log.info("memory system saved")
  }
}

export { Mem0 } from "./mem0"
export { Context } from "./context"
