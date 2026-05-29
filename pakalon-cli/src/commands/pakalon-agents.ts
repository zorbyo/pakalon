/**
 * /pakalon-agents command — creates the full .pakalon-agents scaffold.
 */
import fs from "fs";
import path from "path";
import { createAgentsFolderStructure } from "@/utils/agents-folder-structure.js";
import type { CommandDefinition, CommandContext, CommandResult } from "./types.js";

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;

  let files = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files += countFiles(fullPath);
    } else {
      files += 1;
    }
  }
  return files;
}

export async function cmdPakalonAgents(projectDir = process.cwd()): Promise<{ filesCreated: number }> {
  const resolved = path.resolve(projectDir);
  const projectName = path.basename(resolved);
  const agentsDir = path.join(resolved, ".pakalon-agents");
  const beforeCount = countFiles(agentsDir);

  createAgentsFolderStructure({
    projectDir: resolved,
    projectName,
  });

  return { filesCreated: Math.max(0, countFiles(agentsDir) - beforeCount) };
}

export const pakalonAgentsCommand: CommandDefinition = {
  name: "pakalon-agents",
  description: "Create the full .pakalon-agents folder structure",
  usage: "/pakalon-agents",
  category: "advanced",
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const projectDir = context.cwd ?? process.cwd();
    const info = (msg: string) => {
      if (context.info) {
        (context.info as (m: string) => void)(msg);
      }
    };
    try {
      const result = await cmdPakalonAgents(projectDir);
      const message = result.filesCreated > 0
        ? `Created \`.pakalon-agents/\` scaffold with **${result.filesCreated}** files.\n\nFolder structure initialized for the 6-phase SDLC pipeline.`
        : "`.pakalon-agents/` is already initialized. Missing scaffold files were checked.";
      info(message);
      return { success: true, message };
    } catch (e: any) {
      const errMessage = `Failed to initialize \`.pakalon-agents/\`: ${e.message}`;
      info(errMessage);
      return { success: false, message: errMessage };
    }
  }
};
