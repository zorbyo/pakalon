/**
 * Custom Agent Definitions via Markdown.
 *
 * Agents are defined as Markdown files with YAML frontmatter:
 * ```markdown
 * ---
 * name: react-reviewer
 * description: React code review specialist
 * allowed-tools: [view, grep, glob, edit]
 * infer: true
 * mode: subagent
 * system-prompt: You are a React code review specialist...
 * ---
 *
 * Agent instructions go here in markdown.
 * ```
 *
 * Discovery locations:
 * - .pakalon/agents/[name].md (project-local)
 * - ~/.pakalon/agents/[name].md (user-global)
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  /** Unique agent name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Tools this agent can use (empty = all tools) */
  allowedTools?: string[];
  /** Whether agent can infer additional context */
  infer?: boolean;
  /** Agent mode: "chat" (interactive) or "subagent" (background task) */
  mode?: "chat" | "subagent";
  /** System prompt override */
  systemPrompt?: string;
  /** Markdown body with agent instructions */
  body: string;
  /** Source path */
  sourcePath: string;
  /** Scope: "project" or "user" */
  scope: "project" | "user";
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML-like frontmatter from markdown.
 * Simple parser that handles key: value and key: [array] syntax.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = content.split("\n");

  // Check for frontmatter delimiters
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n").trim();

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterLines) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (match) {
      const key = match[1]!.replace(/-([a-z])/g, (_, c) => String(c).toUpperCase());
      let value: unknown = match[2]!.trim();

      // Parse arrays: [item1, item2]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }

      // Parse booleans
      if (value === "true") value = true;
      if (value === "false") value = false;

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Agent Discovery
// ---------------------------------------------------------------------------

function getProjectAgentsDir(): string {
  return path.join(process.cwd(), ".pakalon", "agents");
}

function getUserAgentsDir(): string {
  return path.join(os.homedir(), ".pakalon", "agents");
}

/**
 * Discover all agent definitions from project and user directories.
 */
export function discoverAgents(): AgentDefinition[] {
  const agents: AgentDefinition[] = [];

  // Project-scoped agents
  const projectDir = getProjectAgentsDir();
  if (fs.existsSync(projectDir)) {
    const entries = fs.readdirSync(projectDir).filter((f) => f.endsWith(".md"));
    for (const file of entries) {
      const agent = loadAgent(path.join(projectDir, file), "project");
      if (agent) agents.push(agent);
    }
  }

  // User-scoped agents
  const userDir = getUserAgentsDir();
  if (fs.existsSync(userDir)) {
    const entries = fs.readdirSync(userDir).filter((f) => f.endsWith(".md"));
    for (const file of entries) {
      const name = path.basename(file, ".md");
      // Skip if already loaded from project
      if (agents.some((a) => a.name === name)) continue;

      const agent = loadAgent(path.join(userDir, file), "user");
      if (agent) agents.push(agent);
    }
  }

  return agents;
}

/**
 * Load a single agent definition from a markdown file.
 */
function loadAgent(filePath: string, scope: "project" | "user"): AgentDefinition | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const name = (frontmatter.name as string) ?? path.basename(filePath, ".md");

    return {
      name,
      description: frontmatter.description as string | undefined,
      allowedTools: frontmatter.allowedTools as string[] | undefined,
      infer: frontmatter.infer as boolean | undefined,
      mode: (frontmatter.mode as "chat" | "subagent") ?? "chat",
      systemPrompt: frontmatter.systemPrompt as string | undefined,
      body,
      sourcePath: filePath,
      scope,
    };
  } catch (err) {
    logger.warn("[agents] Failed to load agent", { filePath, error: String(err) });
    return null;
  }
}

/**
 * Get a specific agent by name.
 */
export function getAgent(name: string): AgentDefinition | null {
  const agents = discoverAgents();
  return agents.find((a) => a.name === name) ?? null;
}

/**
 * Build a system prompt from an agent definition.
 */
export function buildAgentSystemPrompt(agent: AgentDefinition, baseSystemPrompt?: string): string {
  const parts: string[] = [];

  if (baseSystemPrompt) {
    parts.push(baseSystemPrompt);
    parts.push("");
  }

  if (agent.systemPrompt) {
    parts.push(agent.systemPrompt);
    parts.push("");
  }

  if (agent.body) {
    parts.push("## Agent Instructions");
    parts.push(agent.body);
  }

  if (agent.allowedTools && agent.allowedTools.length > 0) {
    parts.push("");
    parts.push(`## Allowed Tools`);
    parts.push(`You may ONLY use these tools: ${agent.allowedTools.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Create a new agent definition file.
 */
export function createAgent(
  name: string,
  description: string,
  body: string,
  options: {
    allowedTools?: string[];
    mode?: "chat" | "subagent";
    systemPrompt?: string;
    scope?: "project" | "user";
  } = {}
): string {
  const scope = options.scope ?? "project";
  const dir = scope === "project" ? getProjectAgentsDir() : getUserAgentsDir();
  fs.mkdirSync(dir, { recursive: true });

  const frontmatterLines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
  ];

  if (options.allowedTools) {
    frontmatterLines.push(`allowed-tools: [${options.allowedTools.join(", ")}]`);
  }
  if (options.mode) {
    frontmatterLines.push(`mode: ${options.mode}`);
  }
  if (options.systemPrompt) {
    frontmatterLines.push(`system-prompt: ${options.systemPrompt}`);
  }

  frontmatterLines.push("---");
  frontmatterLines.push("");
  frontmatterLines.push(body);

  const filePath = path.join(dir, `${name}.md`);
  fs.writeFileSync(filePath, frontmatterLines.join("\n"), "utf-8");

  logger.info("[agents] Created agent", { name, filePath });
  return filePath;
}

/**
 * Delete an agent definition file.
 */
export function deleteAgent(name: string, scope?: "project" | "user"): boolean {
  const dirs = scope
    ? [scope === "project" ? getProjectAgentsDir() : getUserAgentsDir()]
    : [getProjectAgentsDir(), getUserAgentsDir()];

  for (const dir of dirs) {
    const filePath = path.join(dir, `${name}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info("[agents] Deleted agent", { name, filePath });
      return true;
    }
  }

  return false;
}
