import { cmd } from "./cmd"

export const ClearCommand = cmd({
  command: "clear",
  describe: "Clear the terminal screen",
  builder: (yargs) => yargs,
  async handler() {
    // Clear terminal using ANSI escape codes
    process.stdout.write("\x1b[2J\x1b[H")
    console.log("Screen cleared.")
  },
})
