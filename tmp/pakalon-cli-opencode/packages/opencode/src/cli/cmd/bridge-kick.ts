import { cmd } from "./cmd"
import { UI } from "../ui"
import { PythonBridge } from "../../bridge/python-bridge"

export const BridgeKickCommand = cmd({
  command: "bridge-kick",
  describe: "restart the local bridge runtime",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON",
    }),
  handler: async (rawArgs) => {
    const args = {
      json: Boolean(rawArgs.json),
    }

    await PythonBridge.stop()
    await PythonBridge.start()
    const health = await PythonBridge.getHealth().catch(() => undefined)

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            action: "bridge-kick",
            running: PythonBridge.isRunning(),
            health: health ?? null,
          },
          null,
          2,
        ),
      )
      return
    }

    UI.println(UI.Style.TEXT_SUCCESS + "✓ Bridge restarted" + UI.Style.TEXT_NORMAL)
    if (health) {
      UI.println(`Status: ${health.status}`)
      UI.println(`Agents: ${(health.agents ?? []).join(", ") || "(none)"}`)
    }
  },
})
