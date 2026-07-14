import { cmd } from "./cmd"
import { Plugin } from "@/plugin"
import { UI } from "../ui"

export const PluginsCommand = cmd({
  command: "plugins",
  describe: "list available plugins (lazy loaded on-demand)",
  builder: (yargs) =>
    yargs.option("verbose", {
      type: "boolean",
      alias: "v",
      describe: "Show detailed information",
    }),
  async handler(args) {
    // Initialize plugins lazily when command is called
    await Plugin.init()
    const plugins = await Plugin.list()
    const verbose = args.verbose ?? false
    
    if (verbose) {
      UI.println("Available plugins:")
      for (const plugin of plugins) {
        UI.println(`  - ${plugin}`)
      }
    } else {
      UI.println(`${plugins.length} plugin(s) loaded`)
    }
  },
})
