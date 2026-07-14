import { cmd } from "./cmd"
import { UI } from "../ui"
import { GithubInstallCommand } from "./github"

export const InstallGithubAppCommand = cmd({
  command: "install-github-app",
  describe: "install/configure the GitHub app integration",
  handler: async () => {
    if (!GithubInstallCommand.handler) {
      UI.error("GitHub install flow is unavailable in this build.")
      process.exitCode = 1
      return
    }

    await GithubInstallCommand.handler({} as any)
  },
})
