import { cmd } from "./cmd"
import { Skill } from "@/skill"
import { UI } from "../ui"

export const SkillsCommand = cmd({
  command: "skills",
  describe: "list available skills (lazy loaded on-demand)",
  builder: (yargs) =>
    yargs.option("verbose", {
      type: "boolean",
      alias: "v",
      describe: "Show detailed information",
    }),
  async handler(args) {
    const skills = await Skill.all()
    const verbose = args.verbose ?? false

    if (verbose) {
      UI.println(Skill.fmt(skills, { verbose: true }))
    } else {
      UI.println(Skill.fmt(skills, { verbose: false }))
    }
  },
})
