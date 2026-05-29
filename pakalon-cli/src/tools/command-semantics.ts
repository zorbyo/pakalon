export type CommandType = "read" | "write" | "delete" | "network" | "system";

export type CommandRiskLevel = "low" | "medium" | "high" | "critical";

export interface CommandIntent {
  type: CommandType;
  riskLevel: CommandRiskLevel;
  description: string;
}

const READ_PREFIXES = ["ls", "cat", "head", "tail", "grep", "find", "rg", "wc", "pwd", "stat", "file", "tree", "which", "where", "whereis"];
const WRITE_PREFIXES = ["echo", "tee", "mkdir", "touch", "printf", "cp", "mv", "sed", "perl"];
const DELETE_PREFIXES = ["rm", "rmdir", "del", "erase", "unlink"];
const NETWORK_PREFIXES = ["curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "netcat", "ping", "nslookup", "dig"];
const SYSTEM_PREFIXES = ["sudo", "chmod", "chown", "chgrp", "kill", "pkill", "killall", "systemctl", "service", "mount", "umount", "df", "du"];

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function hasAny(command: string, values: string[]): boolean {
  const token = firstToken(command);
  return values.includes(token);
}

function inferRisk(command: string, type: CommandType): CommandRiskLevel {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();

  if (/\bsudo\b/.test(lower) || /\bmkfs\b/.test(lower) || /\bdd\s+if=/.test(lower) || /\brm\s+-rf\b/.test(lower) || /\bshutdown\b/.test(lower) || /\breboot\b/.test(lower)) {
    return "critical";
  }

  if (type === "delete") {
    if (/\b-rf\b|\b-r\b|\b--recursive\b|\b--force\b/.test(lower) || /\bdel\b/.test(lower)) {
      return "high";
    }
    return "medium";
  }

  if (type === "system") {
    if (/\bchmod\s+777\b/.test(lower) || /\bchown\b/.test(lower) || /\bkill\b/.test(lower)) return "high";
    return "medium";
  }

  if (type === "network") {
    if (/\|\s*(ba)?sh\b/.test(lower) || /\|\s*(pwsh|powershell)\b/.test(lower) || /https?:\/\//.test(lower)) return "high";
    return "medium";
  }

  if (type === "write") {
    if (/\s>\s|>>|tee\b/.test(lower)) return "medium";
    return "low";
  }

  return "low";
}

export function analyzeCommandIntent(command: string): CommandIntent {
  const trimmed = command.trim();

  let type: CommandType = "read";
  if (hasAny(trimmed, DELETE_PREFIXES) || /\brm\b|\brmdir\b|\bdel\b|\berase\b/.test(trimmed)) type = "delete";
  else if (hasAny(trimmed, NETWORK_PREFIXES)) type = "network";
  else if (hasAny(trimmed, SYSTEM_PREFIXES) || /\bchmod\b|\bchown\b|\bkill\b|\bsudo\b/.test(trimmed)) type = "system";
  else if (hasAny(trimmed, WRITE_PREFIXES) || />|>>|\btee\b/.test(trimmed)) type = "write";
  else if (hasAny(trimmed, READ_PREFIXES)) type = "read";

  const riskLevel = inferRisk(trimmed, type);

  const descriptions: Record<CommandType, string> = {
    read: "Reads or inspects files, directories, or command output",
    write: "Creates, modifies, or writes data to disk",
    delete: "Deletes files, directories, or content",
    network: "Performs a network request or remote operation",
    system: "Changes permissions, processes, or system state",
  };

  return {
    type,
    riskLevel,
    description: descriptions[type],
  };
}
