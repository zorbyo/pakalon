import { spawn } from "node:child_process";
import { parseFrontmatter, parseShellFrontmatter } from "@/utils/frontmatterParser.js";

export type ShellPromptBlock = {
  shell: boolean;
  command?: string;
};

type ShellBlockRun = {
  command: string;
  shell: ShellPromptBlock;
};

function execShell(command: string, shell: ShellPromptBlock): Promise<string> {
  return new Promise((resolve) => {
    const executable = shell.command ?? (process.platform === "win32" ? "pwsh" : "bash");
    const lower = executable.toLowerCase();
    const shellArgs = lower.includes("pwsh") || lower.includes("powershell")
      ? ["-NoProfile", "-Command", command]
      : ["-lc", command];

    const child = spawn(executable, shellArgs, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trimEnd());
      } else {
        resolve(stderr.trimEnd() || stdout.trimEnd());
      }
    });

    child.on("error", (err) => {
      resolve(String(err));
    });
  });
}

function collectShellBlocks(prompt: string): { content: string; blocks: ShellBlockRun[] } {
  const { frontmatter, content } = parseFrontmatter(prompt);
  const shell = parseShellFrontmatter(frontmatter.shell, "skill-prompt") ?? {
    shell: true,
    command: process.platform === "win32" ? "pwsh" : "bash",
  };

  const blocks: ShellBlockRun[] = [];
  const regex = /!`([\s\S]*?)`/g;
  for (const match of content.matchAll(regex)) {
    const command = match[1]?.trim();
    if (command) {
      blocks.push({ command, shell });
    }
  }
  return { content, blocks };
}

function injectTemplateVariables(command: string): string {
  return command.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => {
    return process.env[name] ?? match;
  });
}

export async function executeShellCommandsInPrompt(prompt: string): Promise<string> {
  const { content, blocks } = collectShellBlocks(prompt);
  let output = content;

  for (const block of blocks) {
    const result = await execShell(injectTemplateVariables(block.command), block.shell);
    output = output.replace(`!\`${block.command}\``, result);
  }

  return output.trimStart();
}
