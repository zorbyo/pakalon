import { cmd } from "./cmd"
import { UI } from "../ui"
import { PythonBridge } from "../../bridge/python-bridge"

type BridgeAction = "start" | "stop" | "status" | "health"

interface BridgeArgs {
  action?: string
  json?: boolean
}

function normalizeAction(value?: string): BridgeAction {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "start") return "start"
  if (normalized === "stop") return "stop"
  if (normalized === "health") return "health"
  return "status"
}

export const BridgeCommand = cmd({
  command: "bridge [action]",
  describe: "manage the local bridge runtime",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["start", "stop", "status", "health"] as const,
        default: "status",
        describe: "Bridge action",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: BridgeArgs = {
      action: typeof rawArgs.action === "string" ? rawArgs.action : undefined,
      json: Boolean(rawArgs.json),
    }

    const action = normalizeAction(args.action)

    if (action === "start") {
      await PythonBridge.start()
      const health = await PythonBridge.getHealth().catch(() => undefined)

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              action,
              running: PythonBridge.isRunning(),
              health: health ?? null,
            },
            null,
            2,
          ),
        )
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + "✓ Bridge started" + UI.Style.TEXT_NORMAL)
      if (health) {
        UI.println(`Status: ${health.status}`)
        UI.println(`Agents: ${(health.agents ?? []).join(", ") || "(none)"}`)
      }
      return
    }

    if (action === "stop") {
      await PythonBridge.stop()
      if (args.json) {
        console.log(JSON.stringify({ action, running: PythonBridge.isRunning() }, null, 2))
        return
      }
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Bridge stopped" + UI.Style.TEXT_NORMAL)
      return
    }

    if (action === "health") {
      try {
        const health = await PythonBridge.getHealth()
        if (args.json) {
          console.log(JSON.stringify({ action, running: PythonBridge.isRunning(), health }, null, 2))
          return
        }

        UI.println(UI.Style.TEXT_HIGHLIGHT + "Bridge Health" + UI.Style.TEXT_NORMAL)
        UI.empty()
        UI.println(`Status: ${health.status}`)
        UI.println(`Agents: ${(health.agents ?? []).join(", ") || "(none)"}`)
      } catch (error) {
        if (args.json) {
          console.log(
            JSON.stringify(
              {
                action,
                running: PythonBridge.isRunning(),
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          )
          return
        }
        UI.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      }
      return
    }

    const running = PythonBridge.isRunning()
    const health = running ? await PythonBridge.getHealth().catch(() => undefined) : undefined

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            action,
            running,
            health: health ?? null,
          },
          null,
          2,
        ),
      )
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Bridge Status" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(`Running: ${running ? "yes" : "no"}`)
    if (health) {
      UI.println(`Health:  ${health.status}`)
      UI.println(`Agents:  ${(health.agents ?? []).join(", ") || "(none)"}`)
    }
  },
})
