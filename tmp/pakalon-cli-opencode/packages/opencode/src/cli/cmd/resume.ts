import { cmd } from "./cmd"
import { UI } from "../ui"

interface ResumeArgs {
  session?: string
}

export const ResumeCommand = cmd({
  command: "resume [session]",
  describe: "Resume a paused or previous session",
  builder: (yargs) =>
    yargs.positional("session", {
      type: "string",
      describe: "Session ID to resume (default: most recent)",
    }),
  async handler(args: ResumeArgs) {
    UI.println(UI.Style.TEXT_INFO + "Looking for sessions to resume...")
    UI.empty()

    // In real implementation, this would load from session storage
    const sessions = [
      { id: "sess-001", timestamp: "2026-04-03 10:00", summary: "Working on CLI features" },
      { id: "sess-002", timestamp: "2026-04-02 15:30", summary: "Bug fixes" },
    ]

    if (args.session) {
      const session = sessions.find(s => s.id === args.session)
      if (!session) {
        UI.println(UI.Style.TEXT_ERROR + `Session not found: ${args.session}`)
        UI.println(UI.Style.TEXT_DIM + "Use /resume without arguments to see available sessions")
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + `✓ Resuming session: ${session.id}`)
      UI.println(UI.Style.TEXT_DIM + `Last active: ${session.timestamp}`)
      UI.println(UI.Style.TEXT_DIM + `Summary: ${session.summary}`)
      return
    }

    if (sessions.length === 0) {
      UI.println(UI.Style.TEXT_WARN + "No sessions to resume.")
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Available Sessions")
    UI.empty()

    for (const session of sessions) {
      UI.println(`${UI.Style.TEXT_INFO}${session.id}${UI.Style.RESET}`)
      UI.println(`  Time: ${session.timestamp}`)
      UI.println(`  Summary: ${session.summary}`)
      UI.empty()
    }

    UI.println(UI.Style.TEXT_DIM + "Use /resume <session-id> to resume a specific session")
    UI.println(UI.Style.TEXT_DIM + "Or /resume to resume the most recent session")
  },
})
