/**
 * Monorepo Config Discovery — walks from CWD to git root for custom instructions/agents.
 * Matches Copilot CLI's directory traversal for config discovery.
 *
 * Discovers:
 * - .pakalon/ directories with settings, hooks, MCP configs
 * - PAKALON.md / CLAUDE.md instruction files
 * - .pakalon-agent files (agent configurations)
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import logger from "@/utils/logger.js";

export interface DiscoveredConfig {
  /** Path to the config file/directory */
  path: string;
  /** Type of config */
  type: "settings" | "instructions" | "hooks" | "mcp" | "agent" | "skills";
  /** Content (for instruction files) */
  content?: string;
  /** Depth from CWD (0 = CWD itself) */
  depth: number;
}

/**
 * Find the git root directory from a starting path.
 */
export function findGitRoot(startDir: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Walk from CWD up to git root, discovering config files at each level.
 */
export function discoverConfigs(cwd: string): DiscoveredConfig[] {
  const configs: DiscoveredConfig[] = [];
  const gitRoot = findGitRoot(cwd);
  const rootDir = gitRoot ?? path.parse(cwd).root;

  let currentDir = path.resolve(cwd);
  let depth = 0;

  while (true) {
    // Check for .pakalon directory
    const pakalonDir = path.join(currentDir, ".pakalon");
    if (fs.existsSync(pakalonDir) && fs.statSync(pakalonDir).isDirectory()) {
      // Settings
      const settingsPath = path.join(pakalonDir, "settings.json");
      if (fs.existsSync(settingsPath)) {
        configs.push({ path: settingsPath, type: "settings", depth });
      }

      // Hooks
      const hooksPath = path.join(pakalonDir, "hooks.json");
      if (fs.existsSync(hooksPath)) {
        configs.push({ path: hooksPath, type: "hooks", depth });
      }

      // MCP config
      const mcpPath = path.join(pakalonDir, "mcp.json");
      if (fs.existsSync(mcpPath)) {
        configs.push({ path: mcpPath, type: "mcp", depth });
      }

      // Skills directory
      const skillsDir = path.join(pakalonDir, "skills");
      if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
        configs.push({ path: skillsDir, type: "skills", depth });
      }
    }

    // Check for instruction files
    const instructionFiles = ["PAKALON.md", "CLAUDE.md", ".pakalon-instructions.md"];
    for (const fileName of instructionFiles) {
      const filePath = path.join(currentDir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          configs.push({ path: filePath, type: "instructions", content, depth });
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Check for .pakalon-agent files
    const agentFiles = fs.readdirSync(currentDir).filter((f) => f.endsWith(".pakalon-agent"));
    for (const agentFile of agentFiles) {
      configs.push({ path: path.join(currentDir, agentFile), type: "agent", depth });
    }

    // Walk up to git root
    if (currentDir === rootDir || currentDir === gitRoot) break;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // filesystem root
    currentDir = parentDir;
    depth++;
  }

  return configs;
}

/**
 * Build a merged instruction string from all discovered instruction files.
 * Files closer to CWD (lower depth) take precedence.
 */
export function buildMergedInstructions(cwd: string): string {
  const configs = discoverConfigs(cwd);
  const instructionConfigs = configs
    .filter((c) => c.type === "instructions" && c.content)
    .sort((a, b) => a.depth - b.depth);

  if (instructionConfigs.length === 0) return "";

  const parts = instructionConfigs.map((c) =>
    `<!-- From: ${c.path} (depth ${c.depth}) -->\n${c.content}`
  );

  return parts.join("\n\n---\n\n");
}
