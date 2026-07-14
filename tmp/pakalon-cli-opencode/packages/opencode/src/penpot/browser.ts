import { Log } from "../util/log"

const log = Log.create({ service: "penpot:browser" })

export namespace PenpotBrowser {
  export async function open(fileId?: string): Promise<void> {
    const url = fileId
      ? `http://localhost:9001/#/workspace?file=${fileId}`
      : "http://localhost:9001"

    log.info("opening penpot in browser", { url })

    const cmd = process.platform === "win32"
      ? `start ${url}`
      : process.platform === "darwin"
        ? `open ${url}`
        : `xdg-open ${url}`

    try {
      const { exec } = await import("child_process")
      exec(cmd)
    } catch {
      log.warn("failed to open browser", { url })
    }
  }

  export function getShareUrl(fileId: string): string {
    return `http://localhost:9001/view/${fileId}`
  }
}
