import path from "path"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Identifier } from "../id/id"

const log = Log.create({ service: "agent:team" })

export interface TeamInfo {
  id: string
  name: string
  description: string
  color: string
  tools: string[]
  system_prompt: string
  created_at: number
  updated_at: number
}

export interface TeamExecution {
  id: string
  team_id: string
  task: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
  artifacts?: string[]
  tokens_used?: number
  duration_ms?: number
  started_at?: number
  completed_at?: number
  created_at: number
}

interface TeamFile {
  teams: TeamInfo[]
  executions: TeamExecution[]
}

interface CreateOpts {
  name: string
  description: string
  color?: string
  tools?: string[]
  systemPrompt: string
}

interface UpdateOpts {
  name?: string
  description?: string
  color?: string
  tools?: string[]
  systemPrompt?: string
}

const state = {
  root: "",
  teams: new Map<string, TeamInfo>(),
  execs: new Map<string, TeamExecution>(),
}

function file(root: string) {
  return path.join(root, ".pakalon", "agents", "teams.json")
}

function now() {
  return Date.now()
}

function id() {
  if ("sortable" in Identifier && typeof Identifier.sortable === "function") {
    return Identifier.sortable()
  }
  return Identifier.ascending("tool")
}

function save() {
  if (!state.root) return Promise.resolve()
  return TeamManager.saveTeams(state.root)
}

export namespace TeamManager {
  export async function loadTeams(projectPath: string) {
    const p = file(projectPath)
    state.root = projectPath
    state.teams.clear()
    state.execs.clear()
    if (!(await Filesystem.exists(p))) {
      log.info("team file missing, using empty state", { path: p })
      return
    }
    const data = await Filesystem.readJson<TeamFile>(p)
    for (const team of data.teams ?? []) state.teams.set(team.id, team)
    for (const exec of data.executions ?? []) state.execs.set(exec.id, exec)
    log.info("loaded teams", { teams: state.teams.size, executions: state.execs.size })
  }

  export async function saveTeams(projectPath: string) {
    state.root = projectPath
    const p = file(projectPath)
    const data: TeamFile = {
      teams: Array.from(state.teams.values()),
      executions: Array.from(state.execs.values()),
    }
    await Filesystem.writeJson(p, data)
    log.info("saved teams", { path: p, teams: data.teams.length, executions: data.executions.length })
  }

  export async function create(projectPath: string, opts: CreateOpts) {
    state.root = projectPath
    const t = now()
    const team: TeamInfo = {
      id: id(),
      name: opts.name,
      description: opts.description,
      color: opts.color ?? "#6366f1",
      tools: opts.tools ?? [],
      system_prompt: opts.systemPrompt,
      created_at: t,
      updated_at: t,
    }
    state.teams.set(team.id, team)
    await save()
    log.info("created team", { id: team.id, name: team.name })
    return team
  }

  export async function update(projectPath: string, id: string, opts: UpdateOpts) {
    state.root = projectPath
    const team = state.teams.get(id)
    if (!team) return undefined
    const next: TeamInfo = {
      ...team,
      name: opts.name ?? team.name,
      description: opts.description ?? team.description,
      color: opts.color ?? team.color,
      tools: opts.tools ?? team.tools,
      system_prompt: opts.systemPrompt ?? team.system_prompt,
      updated_at: now(),
    }
    state.teams.set(id, next)
    await save()
    log.info("updated team", { id })
    return next
  }

  export async function remove(projectPath: string, id: string) {
    state.root = projectPath
    if (!state.teams.has(id)) return false
    state.teams.delete(id)
    for (const item of Array.from(state.execs.values())) {
      if (item.team_id !== id) continue
      state.execs.delete(item.id)
    }
    await save()
    log.info("removed team", { id })
    return true
  }

  export function get(id: string) {
    return state.teams.get(id)
  }

  export function getByName(name: string) {
    const key = name.toLowerCase()
    return Array.from(state.teams.values()).find((item) => item.name.toLowerCase() === key)
  }

  export function list() {
    return Array.from(state.teams.values()).sort((a, b) => b.updated_at - a.updated_at)
  }

  export async function executeTask(projectPath: string, teamId: string, task: string) {
    state.root = projectPath
    const team = state.teams.get(teamId)
    if (!team) return undefined
    const t = now()
    const exec: TeamExecution = {
      id: id(),
      team_id: teamId,
      task,
      status: "running",
      started_at: t,
      created_at: t,
    }
    state.execs.set(exec.id, exec)
    await save()
    log.info("started team execution", { execution: exec.id, team: teamId })
    return exec
  }

  export async function completeExecution(execId: string, result: string, artifacts: string[], tokensUsed: number) {
    const exec = state.execs.get(execId)
    if (!exec) return undefined
    const end = now()
    const start = exec.started_at ?? exec.created_at
    const next: TeamExecution = {
      ...exec,
      status: "completed",
      result,
      artifacts,
      tokens_used: tokensUsed,
      duration_ms: Math.max(0, end - start),
      completed_at: end,
    }
    state.execs.set(execId, next)
    await save()
    log.info("completed team execution", { execution: execId, duration: next.duration_ms, tokens: tokensUsed })
    return next
  }

  export function listExecutions(teamId?: string) {
    const list = Array.from(state.execs.values())
    if (!teamId) return list.sort((a, b) => b.created_at - a.created_at)
    return list.filter((item) => item.team_id === teamId).sort((a, b) => b.created_at - a.created_at)
  }

  export function formatTeamList(teams: TeamInfo[]) {
    if (teams.length === 0) return "No teams configured"
    const head = "ID | Name | Color | Tools"
    const line = "---|---|---|---"
    const body = teams.map((item) => {
      const tools = item.tools.length > 0 ? item.tools.join(",") : "-"
      return `${item.id} | ${item.name} | ${item.color} | ${tools}`
    })
    return [head, line, ...body].join("\n")
  }
}
