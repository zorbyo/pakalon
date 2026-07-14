import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Trust } from "../../project/trust"
import { Instance } from "../../project/instance"
import path from "path"

export const TrustCommand = cmd({
  command: "trust",
  describe: "manage trusted directories for MCP server loading",
  builder: (yargs) =>
    yargs
      .command(TrustListCommand)
      .command(TrustAddCommand)
      .command(TrustRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const TrustListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list trusted directories",
  async handler() {
    UI.empty()
    prompts.intro("Trusted Directories")

    const directories = await Trust.list()
    if (directories.length === 0) {
      prompts.log.info("No trusted directories found.")
      return
    }

    for (const dir of directories) {
      const name = dir.name ? ` (${dir.name})` : ""
      const date = new Date(dir.trustedAt).toLocaleDateString()
      prompts.log.info(`${dir.path}${name} - trusted ${date}`)
    }

    prompts.outro(`Total: ${directories.length} trusted directories`)
  },
})

export const TrustAddCommand = cmd({
  command: "add [directory]",
  aliases: ["+"],
  describe: "trust a directory for MCP server loading",
  builder: (yargs) =>
    yargs.positional("directory", {
      describe: "directory to trust (defaults to current working directory)",
      type: "string",
    }),
  async handler(args) {
    const directory = path.resolve(args.directory ?? process.cwd())

    if (await Trust.isTrusted(directory)) {
      prompts.log.info(`Directory already trusted: ${directory}`)
      return
    }

    await Trust.trust(directory)
    prompts.log.success(`Trusted directory: ${directory}`)
    prompts.log.info("Workspace MCP servers will now load when running pakalon in this directory.")
  },
})

export const TrustRemoveCommand = cmd({
  command: "remove <directory>",
  aliases: ["rm"],
  describe: "remove trust for a directory",
  async handler(args) {
    const directory = path.resolve(args.directory as string)

    if (!(await Trust.isTrusted(directory))) {
      prompts.log.info(`Directory not trusted: ${directory}`)
      return
    }

    await Trust.untrust(directory)
    prompts.log.success(`Removed trust for: ${directory}`)
  },
})
