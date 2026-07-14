import { cmd } from "./cmd"
import { UI } from "../ui"

export const InstallSlackAppCommand = cmd({
  command: "install-slack-app",
  describe: "guide Slack app installation for pakalon remote workflows",
  handler: async () => {
    const docUrl = "https://api.slack.com/apps"

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Slack App Installation" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println("1) Open the Slack app management page:")
    UI.println(UI.Style.TEXT_INFO + `   ${docUrl}` + UI.Style.TEXT_NORMAL)
    UI.println("2) Create an app from scratch for your workspace.")
    UI.println("3) Add bot scopes required by your pakalon integration.")
    UI.println("4) Install the app to your workspace and copy the bot token.")
    UI.println("5) Save secrets into your environment/config before enabling slack hooks.")
    UI.empty()
    UI.println(UI.Style.TEXT_DIM + "Tip: use `pakalon remote-env` to verify relevant env vars are set." + UI.Style.TEXT_NORMAL)
  },
})
