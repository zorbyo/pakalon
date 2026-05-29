/**
 * /teleport command — Transfer session to remote environment.
 * Allows teleporting the current CLI session to a remote machine.
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import logger from "@/utils/logger.js";

export interface TeleportTarget {
  name: string;
  host: string;
  port: number;
  user: string;
  savedAt: string;
}

export interface TeleportConfig {
  targets: TeleportTarget[];
  activeConnection: {
    target: TeleportTarget;
    startedAt: string;
    pid: number | null;
  } | null;
}

let activeProcess: ChildProcess | null = null;

function getConfigDir(): string {
  const base =
    process.env.PAKALON_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "pakalon")
      : path.join(os.homedir(), ".config", "pakalon"));
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

function getTeleportConfigPath(): string {
  return path.join(getConfigDir(), "teleport-targets.json");
}

function loadTeleportConfig(): TeleportConfig {
  const configPath = getTeleportConfigPath();
  if (!fs.existsSync(configPath)) {
    return { targets: [], activeConnection: null };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as TeleportConfig;
  } catch {
    return { targets: [], activeConnection: null };
  }
}

function saveTeleportConfig(config: TeleportConfig): void {
  const configPath = getTeleportConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

function parseTargetString(input: string): { user: string; host: string; port: number } | null {
  const match = input.match(/^(?:(\w+)@)?([a-zA-Z0-9.-]+)(?::(\d+))?$/);
  if (!match) return null;
  const [, user, host, portStr] = match;
  if (!host) return null;
  return {
    user: user || process.env.USER || "root",
    host,
    port: portStr ? parseInt(portStr, 10) : 22,
  };
}

function testSshConnection(user: string, host: string, port: number, timeout = 5): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ssh", [
      "-o", `ConnectTimeout=${timeout}`,
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-p", String(port),
      `${user}@${host}`,
      "echo connected",
    ], { stdio: "ignore", timeout: (timeout + 2) * 1000 });

    proc.on("exit", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

export async function cmdTeleport(args: string[]): Promise<string> {
  const config = loadTeleportConfig();

  // Scan for --save / --remove flags anywhere in args
  const saveIdx = args.indexOf("--save");
  const removeIdx = args.indexOf("--remove");
  const sshIdx = args.indexOf("--ssh");
  const listFlag = args.includes("--list") || args.includes("list");
  const statusFlag = args.includes("--status") || args.includes("status");
  const cancelFlag = args.includes("--cancel") || args.includes("cancel");

  // --list
  if (listFlag && saveIdx === -1 && removeIdx === -1) {
    if (config.targets.length === 0) {
      return `Clipboard Available Teleport Targets
━━━━━━━━━━━━━━━━━━━━━━━━━━

No saved targets found.

To save a target:
  /teleport user@host --save my-server`;
    }

    let output = `Clipboard Available Teleport Targets
━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (let i = 0; i < config.targets.length; i++) {
      const t = config.targets[i]!;
      output += `${i + 1}. ${t.user}@${t.host}:${t.port}  (saved: ${t.savedAt})\n`;
    }
    return output;
  }

  // --status
  if (statusFlag && saveIdx === -1 && removeIdx === -1) {
    if (!config.activeConnection) {
      return `Satellite Antenna Teleport Status
━━━━━━━━━━━━━━━━━━

No active teleport session.

Use /teleport <target> to start a new session.`;
    }

    const conn = config.activeConnection;
    const started = new Date(conn.startedAt);
    const duration = Math.floor((Date.now() - started.getTime()) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;

    return `Satellite Antenna Teleport Status
━━━━━━━━━━━━━━━━━━

Target: ${conn.target.user}@${conn.target.host}:${conn.target.port}
Started: ${conn.startedAt}
Duration: ${mins}m ${secs}s
PID: ${conn.pid ?? "N/A"}`;
  }

  // --cancel
  if (cancelFlag) {
    if (activeProcess) {
      try {
        activeProcess.kill("SIGTERM");
        activeProcess = null;
      } catch {
        // process already dead
      }
    }
    if (config.activeConnection) {
      config.activeConnection = null;
      saveTeleportConfig(config);
      return "Teleport session cancelled.";
    }
    return "No active teleport session to cancel.";
  }

  // --save
  if (saveIdx !== -1) {
    const name = args[saveIdx + 1];
    if (!name) {
      return "Usage: /teleport <target> --save <name>\nExample: /teleport user@host --save my-server";
    }
    // Extract target: either before --save or after the name
    let targetStr: string | undefined;
    if (saveIdx === 0) {
      // /teleport --save name user@host
      targetStr = args[saveIdx + 2];
    } else {
      // /teleport user@host --save name
      targetStr = args[0];
    }
    if (!targetStr) {
      return "Usage: /teleport <target> --save <name>\nExample: /teleport user@host --save my-server";
    }
    const parsed = parseTargetString(targetStr);
    if (!parsed) {
      return `Invalid target format: ${targetStr}\nExpected: user@host or user@host:port`;
    }
    const existing = config.targets.find((t) => t.name === name);
    if (existing) {
      existing.host = parsed.host;
      existing.port = parsed.port;
      existing.user = parsed.user;
      existing.savedAt = new Date().toISOString();
    } else {
      config.targets.push({
        name,
        host: parsed.host,
        port: parsed.port,
        user: parsed.user,
        savedAt: new Date().toISOString(),
      });
    }
    saveTeleportConfig(config);
    return `Target "${name}" saved: ${parsed.user}@${parsed.host}:${parsed.port}`;
  }

  // --remove
  if (removeIdx !== -1) {
    const name = args[removeIdx + 1];
    if (!name) {
      return "Usage: /teleport --remove <name>";
    }
    const idx = config.targets.findIndex((t) => t.name === name);
    if (idx === -1) {
      return `Target "${name}" not found.`;
    }
    config.targets.splice(idx, 1);
    saveTeleportConfig(config);
    return `Target "${name}" removed.`;
  }

  // No arguments — show help
  const firstArg = args[0];
  if (!firstArg) {
    return `
Rocket Teleport Command
━━━━━━━━━━━━━━━━━━━━

Usage: /teleport [target|options]

Teleport transfers your current CLI session to a remote environment.
This allows you to continue working on a different machine.

Options:
  <target>         Connect to a remote target (user@host[:port])
  --save <name>    Save current target with a name
  --remove <name>  Remove a saved target
  --list           List available teleport targets
  --status         Show current teleport status
  --cancel         Cancel active teleport session

Examples:
  /teleport user@remote-server
  /teleport user@192.168.1.100:2222
  /teleport user@host --save my-server
  /teleport --list

Note: Requires SSH access to the target machine and
      the remote machine must have Pakalon installed.`;
  }

  // --ssh or raw target
  let rawTarget: string;
  if (sshIdx !== -1) {
    const targetArg = args[sshIdx + 1];
    if (!targetArg) {
      return "Usage: /teleport --ssh user@host[:port]";
    }
    rawTarget = targetArg;
  } else {
    rawTarget = firstArg;
  }

  // Try to resolve named target
  let parsed = parseTargetString(rawTarget);
  if (!parsed) {
    const saved = config.targets.find((t) => t.name === rawTarget);
    if (saved) {
      parsed = { user: saved.user, host: saved.host, port: saved.port };
    } else {
      return `Invalid target: ${rawTarget}\nExpected: user@host[:port] or a saved target name.`;
    }
  }

  logger.info(`Testing SSH connection to ${parsed.user}@${parsed.host}:${parsed.port}...`);
  const connected = await testSshConnection(parsed.user, parsed.host, parsed.port);

  if (!connected) {
    return `Failed to connect to ${parsed.user}@${parsed.host}:${parsed.port}

Make sure:
  - SSH is installed
  - The host is reachable
  - SSH key-based auth is configured for ${parsed.user}@${parsed.host}`;
  }

  // Start real SSH session
  const target: TeleportTarget = {
    name: rawTarget,
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    savedAt: new Date().toISOString(),
  };

  activeProcess = spawn("ssh", [
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(target.port),
    `${target.user}@${target.host}`,
  ], { stdio: "inherit" });

  config.activeConnection = {
    target,
    startedAt: new Date().toISOString(),
    pid: activeProcess.pid || null,
  };
  saveTeleportConfig(config);

  activeProcess.on("exit", (code) => {
    logger.info(`SSH session exited with code ${code}`);
    const currentConfig = loadTeleportConfig();
    if (currentConfig.activeConnection) {
      currentConfig.activeConnection = null;
      saveTeleportConfig(currentConfig);
    }
    activeProcess = null;
  });

  activeProcess.on("error", (err) => {
    logger.error(`SSH process error: ${err.message}`);
    const currentConfig = loadTeleportConfig();
    if (currentConfig.activeConnection) {
      currentConfig.activeConnection = null;
      saveTeleportConfig(currentConfig);
    }
    activeProcess = null;
  });

  return `Connected to ${target.user}@${target.host}:${target.port}

Teleport session is active. The remote SSH session is running.
Use /teleport --status to check connection status.
Use /teleport --cancel to end the session.

Note: Type 'exit' or Ctrl+D to close the SSH connection.`;
}

// Slash command definition
export const teleportCommand = {
  name: "teleport",
  aliases: ["tp"],
  description: "Teleport session to remote environment",
  usage: "/teleport [target|--list|--status|--cancel]",
  category: "session" as const,

  async execute(context: any, args: string[]): Promise<{ success: boolean; message: string }> {
    try {
      const result = await cmdTeleport(args);
      return { success: true, message: result };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default teleportCommand;