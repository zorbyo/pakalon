import { cmd } from "./cmd"
import { UI } from "../ui"

export const ExitCommand = cmd({
  command: "exit",
  describe: "Exit the CLI",
  builder: (yargs) => yargs,
  async handler() {
    UI.println(UI.Style.TEXT_INFO + "Goodbye!")
    process.exit(0)
  },
})
