import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Identifier } from "../id/id"

const log = Log.create({ service: "cli:automations" })

export interface AutomationTemplate {
  id: string
  name: string
  description: string
  category: string
  trigger: string
  actions: string[]
  cron?: string
}

export interface Automation {
  id: string
  name: string
  description: string
  templateId?: string
  trigger: { type: string; config: Record<string, unknown> }
  actions: { type: string; config: Record<string, unknown> }[]
  enabled: boolean
  lastRun?: number
  nextRun?: number
  createdAt: number
}

export namespace AutomationCLI {
  const TEMPLATES: AutomationTemplate[] = [
    {
      id: "daily-backup",
      name: "Daily Backup",
      description: "Run automated backup every day at midnight",
      category: "maintenance",
      trigger: "cron:0 0 * * *",
      actions: ["backup-database", "backup-files"],
    },
    {
      id: "pr-review",
      name: "Auto PR Review",
      description: "Automatically review new pull requests",
      category: "development",
      trigger: "github:pull_request:opened",
      actions: ["run-lint", "run-tests", "ai-review"],
    },
    {
      id: "deploy-staging",
      name: "Deploy to Staging",
      description: "Auto-deploy main branch to staging on push",
      category: "deployment",
      trigger: "github:push:main",
      actions: ["build", "test", "deploy-staging"],
    },
    {
      id: "issue-triage",
      name: "Issue Auto-Triage",
      description: "Auto-label and assign new GitHub issues",
      category: "development",
      trigger: "github:issue:opened",
      actions: ["ai-classify", "auto-label", "auto-assign"],
    },
    {
      id: "weekly-report",
      name: "Weekly Report",
      description: "Generate weekly development summary",
      category: "reporting",
      trigger: "cron:0 9 * * 1",
      actions: ["collect-stats", "generate-report", "notify-slack"],
    },
    {
      id: "security-scan",
      name: "Security Scan",
      description: "Run security scans on schedule",
      category: "security",
      trigger: "cron:0 3 * * 0",
      actions: ["run-sast", "run-dast", "generate-report"],
    },
  ]

  export function listTemplates(): AutomationTemplate[] {
    return TEMPLATES
  }

  export function getTemplate(id: string): AutomationTemplate | undefined {
    return TEMPLATES.find(t => t.id === id)
  }

  export async function createFromTemplate(
    projectPath: string,
    templateId: string,
    name?: string,
  ): Promise<Automation | null> {
    const template = getTemplate(templateId)
    if (!template) {
      log.error("template not found", { templateId })
      return null
    }

    const id = Identifier.ascending("tool")
    const now = Date.now()
    const triggerParts = template.trigger.split(":")
    const triggerType = triggerParts[0]
    const triggerConfig: Record<string, unknown> = {}
    if (triggerType === "cron" && triggerParts[1]) triggerConfig.expression = triggerParts[1]
    if (triggerType === "github" && triggerParts[1]) {
      triggerConfig.event = triggerParts[1]
      if (triggerParts[2]) triggerConfig.ref = triggerParts[2]
    }

    const automation: Automation = {
      id,
      name: name ?? template.name,
      description: template.description,
      templateId,
      trigger: { type: triggerType, config: triggerConfig },
      actions: template.actions.map(a => ({ type: a, config: {} })),
      enabled: true,
      createdAt: now,
    }

    await saveAutomation(projectPath, automation)
    log.info("created automation", { id, name: automation.name })
    return automation
  }

  export async function createCustom(
    projectPath: string,
    name: string,
    description: string,
    triggerType: string,
    triggerConfig: Record<string, unknown>,
    actions: string[],
  ): Promise<Automation> {
    const id = Identifier.ascending("tool")
    const now = Date.now()

    const automation: Automation = {
      id,
      name,
      description,
      trigger: { type: triggerType, config: triggerConfig },
      actions: actions.map(a => ({ type: a, config: {} })),
      enabled: true,
      createdAt: now,
    }

    await saveAutomation(projectPath, automation)
    log.info("created custom automation", { id, name })
    return automation
  }

  export async function listAutomations(projectPath: string): Promise<Automation[]> {
    const dir = `${projectPath}/.pakalon/automations`
    const file = `${dir}/automations.json`
    try {
      const data = await Filesystem.readJson<Automation[]>(file)
      return data
    } catch {
      return []
    }
  }

  export async function toggleAutomation(projectPath: string, id: string): Promise<boolean> {
    const list = await listAutomations(projectPath)
    const auto = list.find(a => a.id === id)
    if (!auto) return false
    auto.enabled = !auto.enabled
    await saveAllAutomations(projectPath, list)
    return auto.enabled
  }

  export async function deleteAutomation(projectPath: string, id: string): Promise<boolean> {
    const list = await listAutomations(projectPath)
    const filtered = list.filter(a => a.id !== id)
    if (filtered.length === list.length) return false
    await saveAllAutomations(projectPath, filtered)
    return true
  }

  async function saveAutomation(projectPath: string, automation: Automation): Promise<void> {
    const list = await listAutomations(projectPath)
    list.push(automation)
    await saveAllAutomations(projectPath, list)
  }

  async function saveAllAutomations(projectPath: string, list: Automation[]): Promise<void> {
    const dir = `${projectPath}/.pakalon/automations`
    const file = `${dir}/automations.json`
    await Bun.$`mkdir -p ${dir}`
    await Filesystem.writeJson(file, list)
  }

  export function formatTemplateList(templates: AutomationTemplate[]): string {
    const cats = new Map<string, AutomationTemplate[]>()
    for (const t of templates) {
      const list = cats.get(t.category) ?? []
      list.push(t)
      cats.set(t.category, list)
    }

    const lines = ["## Automation Templates", ""]
    for (const [cat, list] of cats) {
      lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`)
      for (const t of list) {
        lines.push(`- **${t.id}** — ${t.name}: ${t.description}`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }

  export function formatAutomationList(automations: Automation[]): string {
    if (automations.length === 0) return "No automations configured. Use `/automations templates` to browse available templates."
    const lines = ["## Active Automations", ""]
    for (const a of automations) {
      const status = a.enabled ? "✅" : "❌"
      const trigger = `${a.trigger.type}:${JSON.stringify(a.trigger.config)}`
      lines.push(`${status} **${a.name}** — ${a.description}`)
      lines.push(`   Trigger: \`${trigger}\` | Actions: ${a.actions.map(ac => ac.type).join(", ")}`)
      if (a.lastRun) lines.push(`   Last run: ${new Date(a.lastRun).toISOString()}`)
      lines.push("")
    }
    return lines.join("\n")
  }
}
