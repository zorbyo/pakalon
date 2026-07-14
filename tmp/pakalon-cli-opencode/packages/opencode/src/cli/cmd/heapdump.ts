import fs from "fs/promises"
import path from "path"
import os from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"

interface HeapdumpArgs {
  output?: string
  json?: boolean
}

async function canAccess(dir: string) {
  try {
    await fs.access(dir)
    return true
  } catch {
    return false
  }
}

async function preferredOutputDir(): Promise<string> {
  const desktop = path.join(os.homedir(), "Desktop")
  if (await canAccess(desktop)) return desktop
  await fs.mkdir(Global.Path.log, { recursive: true })
  return Global.Path.log
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
}

async function writeHeapSnapshotSafe(filePath: string): Promise<boolean> {
  try {
    const v8 = await import("v8")
    if (typeof v8.writeHeapSnapshot !== "function") return false
    v8.writeHeapSnapshot(filePath)
    return true
  } catch {
    return false
  }
}

export const HeapdumpCommand = cmd({
  command: "heapdump",
  describe: "capture a heap snapshot (when supported) and runtime diagnostics",
  builder: (yargs) =>
    yargs
      .option("output", {
        alias: "o",
        type: "string",
        describe: "Output file path for heap snapshot",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: HeapdumpArgs = {
      output: typeof rawArgs.output === "string" ? rawArgs.output : undefined,
      json: Boolean(rawArgs.json),
    }

    const timestamp = new Date().toISOString().replace(/[.:]/g, "-")
    const outDir = args.output ? path.dirname(path.resolve(process.cwd(), args.output)) : await preferredOutputDir()
    const heapPath = args.output
      ? path.resolve(process.cwd(), args.output)
      : path.join(outDir, `pakalon-heap-${timestamp}.heapsnapshot`)
    const runtimePath = path.join(outDir, `pakalon-runtime-${timestamp}.json`)

    await ensureDirectory(path.dirname(heapPath))
    await ensureDirectory(path.dirname(runtimePath))

    const heapdumpWritten = await writeHeapSnapshotSafe(heapPath)

    const runtimeDiagnostics = {
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: process.uptime(),
    }

    await fs.writeFile(runtimePath, JSON.stringify(runtimeDiagnostics, null, 2), "utf8")

    const payload = {
      heapdumpWritten,
      heapPath: heapdumpWritten ? heapPath : undefined,
      runtimePath,
      diagnostics: runtimeDiagnostics,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Heapdump" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (heapdumpWritten) {
      UI.println(UI.Style.TEXT_SUCCESS + `✓ Heap snapshot saved to ${heapPath}` + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(
        UI.Style.TEXT_WARNING +
          "Heap snapshot is not supported in this runtime, but runtime diagnostics were captured." +
          UI.Style.TEXT_NORMAL,
      )
    }

    UI.println(`Runtime diagnostics: ${runtimePath}`)
  },
})
