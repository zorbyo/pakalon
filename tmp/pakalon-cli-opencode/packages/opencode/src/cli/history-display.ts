import { Log } from "../util/log"

const log = Log.create({ service: "cli:history" })

export interface SessionSummary {
  id: string
  directory: string
  createdAt: number
  messageCount: number
  tokensUsed: number
  model: string
  status: "active" | "completed"
  firstMessage?: string
}

export interface SessionDetail extends SessionSummary {
  messages: { role: string; content: string; timestamp: number }[]
  filesChanged: number
  linesAdded: number
  linesRemoved: number
}

export namespace HistoryDisplay {
  export function formatSessionList(sessions: SessionSummary[], dir: string): string {
    const header = `Session History - Current Directory: ${dir}`
    const sep = "─".repeat(76)

    const rows = sessions.map((s, i) => {
      const date = new Date(s.createdAt).toISOString().slice(0, 19).replace("T", " ")
      const tokens = s.tokensUsed.toLocaleString()
      const status = s.status === "active" ? "Active   " : "Completed"
      return `│ ${String(i + 1).padStart(2)} │ ${s.id.slice(0, 13).padEnd(13)} │ ${date} │ ${String(s.messageCount).padStart(8)} │ ${tokens.padStart(9)} │ ${status} │`
    })

    return [
      `┌${"─".repeat(76)}┐`,
      `│ ${header.padEnd(75)}│`,
      `├${sep}┤`,
      "│ #  │ Session ID    │ Date/Time           │ Messages │   Tokens │ Status   │",
      `├${sep}┤`,
      ...rows,
      `└${sep}┘`,
      "",
      "Commands: /resume <session_id> | /history <n> | /history --search <query>",
    ].join("\n")
  }

  export function formatSessionDetail(session: SessionDetail): string {
    const date = new Date(session.createdAt).toISOString().slice(0, 19).replace("T", " ")
    const sep = "─".repeat(76)

    const recentMsgs = session.messages.slice(-5).map((m, i) => {
      const time = new Date(m.timestamp).toISOString().slice(11, 19)
      const role = m.role === "user" ? "User" : "AI"
      const preview = m.content.slice(0, 60).replace(/\n/g, " ")
      return `  ${i + 1}. [${time}] ${role}: ${preview}...`
    })

    return [
      `┌${sep}┐`,
      `│ Session: ${session.id.padEnd(66)}│`,
      `├${sep}┤`,
      `│ Status: ${session.status.padEnd(67)}│`,
      `│ Started: ${date.padEnd(66)}│`,
      `│ Model: ${session.model.padEnd(68)}│`,
      `├${sep}┤`,
      `│ Statistics${" ".repeat(65)}│`,
      `│   Messages: ${String(session.messageCount).padEnd(63)}│`,
      `│   Tokens Used: ${session.tokensUsed.toLocaleString().padEnd(60)}│`,
      `│   Files Modified: ${String(session.filesChanged).padEnd(57)}│`,
      `│   Lines Changed: +${session.linesAdded} / -${session.linesRemoved}${" ".repeat(50 - String(session.linesAdded).length - String(session.linesRemoved).length)}│`,
      `├${sep}┤`,
      `│ Recent Messages${" ".repeat(60)}│`,
      ...recentMsgs.map((l) => `│ ${l.padEnd(75)}│`),
      `└${sep}┘`,
    ].join("\n")
  }

  export function formatExport(sessions: SessionSummary[], format: "json" | "csv" | "md"): string {
    if (format === "json") return JSON.stringify(sessions, null, 2)
    if (format === "csv") {
      const header = "id,directory,createdAt,messageCount,tokensUsed,model,status"
      const rows = sessions.map(
        (s) => `${s.id},${s.directory},${s.createdAt},${s.messageCount},${s.tokensUsed},${s.model},${s.status}`,
      )
      return [header, ...rows].join("\n")
    }

    const lines = [
      "# Session History Export",
      "",
      "| Session ID | Directory | Date | Messages | Tokens | Model | Status |",
      "|---|---|---|---|---|---|---|",
    ]
    for (const s of sessions) {
      const date = new Date(s.createdAt).toISOString().slice(0, 10)
      lines.push(
        `| ${s.id} | ${s.directory} | ${date} | ${s.messageCount} | ${s.tokensUsed} | ${s.model} | ${s.status} |`,
      )
    }
    return lines.join("\n")
  }
}
