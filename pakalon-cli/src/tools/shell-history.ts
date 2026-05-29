import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface ShellHistoryEntry {
  id: string;
  shell: "bash" | "powershell" | "secure-bash";
  command: string;
  expandedCommand?: string;
  cwd: string;
  exitCode?: number;
  createdAt: string;
}

export interface AliasExpansionResult {
  command: string;
  expanded: boolean;
  alias?: string;
  replacement?: string;
}

const DEFAULT_BASH_ALIASES: Record<string, string> = {
  ll: "ls -la",
  la: "ls -A",
  l: "ls -CF",
};

const HISTORY_LIMIT = 1000;

function getConfigDir(): string {
  const dir =
    process.env.PAKALON_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "pakalon")
      : path.join(os.homedir(), ".config", "pakalon"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getHistoryPath(): string {
  return path.join(getConfigDir(), "shell-history.json");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function parseEnvAliases(): Record<string, string> {
  const raw = process.env.PAKALON_SHELL_ALIASES;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    const aliases: Record<string, string> = {};
    for (const item of raw.split(",")) {
      const [name, ...rest] = item.split("=");
      if (name?.trim() && rest.length > 0) {
        aliases[name.trim()] = rest.join("=").trim();
      }
    }
    return aliases;
  }
}

function readProjectAliases(cwd: string): Record<string, string> {
  const aliasFile = path.join(cwd, ".pakalon", "shell-aliases.json");
  const parsed = readJsonFile<Record<string, unknown>>(aliasFile, {});
  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function nativeHistoryFiles(): Array<{ shell: ShellHistoryEntry["shell"]; filePath: string }> {
  const home = os.homedir();
  const files: Array<{ shell: ShellHistoryEntry["shell"]; filePath: string }> = [
    { shell: "bash", filePath: path.join(home, ".bash_history") },
    { shell: "bash", filePath: path.join(home, ".zsh_history") },
  ];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      files.push(
        {
          shell: "powershell",
          filePath: path.join(appData, "Microsoft", "Windows", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"),
        },
        {
          shell: "powershell",
          filePath: path.join(appData, "Microsoft", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"),
        },
      );
    }
  } else {
    files.push({
      shell: "powershell",
      filePath: path.join(home, ".local", "share", "powershell", "PSReadLine", "ConsoleHost_history.txt"),
    });
  }

  return files;
}

function parseNativeHistoryLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(":")) {
    const separator = trimmed.indexOf(";");
    return separator >= 0 ? trimmed.slice(separator + 1).trim() || null : null;
  }
  return trimmed;
}

function splitLeadingToken(command: string): { leadingWhitespace: string; token: string; rest: string } | null {
  const match = command.match(/^(\s*)([A-Za-z0-9_.:-]+)([\s\S]*)$/);
  if (!match) return null;
  return {
    leadingWhitespace: match[1] ?? "",
    token: match[2] ?? "",
    rest: match[3] ?? "",
  };
}

export function getShellAliases(cwd = process.cwd()): Record<string, string> {
  return {
    ...DEFAULT_BASH_ALIASES,
    ...parseEnvAliases(),
    ...readProjectAliases(cwd),
  };
}

export function expandShellAlias(command: string, cwd = process.cwd()): AliasExpansionResult {
  const parsed = splitLeadingToken(command);
  if (!parsed || parsed.token.toLowerCase() === "alias") {
    return { command, expanded: false };
  }

  const aliases = getShellAliases(cwd);
  const replacement = aliases[parsed.token];
  if (!replacement) {
    return { command, expanded: false };
  }

  const rest = parsed.rest.trimStart();
  const expanded = replacement.includes("$@")
    ? replacement.replace(/\$@/g, rest)
    : `${replacement}${rest ? ` ${rest}` : ""}`;

  return {
    command: `${parsed.leadingWhitespace}${expanded}`,
    expanded: true,
    alias: parsed.token,
    replacement,
  };
}

export function normalizeNoHupForPlatform(command: string, cwd = process.cwd()): { command: string; normalized: boolean; logPath?: string } {
  if (process.platform !== "win32") {
    return { command, normalized: false };
  }

  const match = command.match(/^\s*nohup\s+([\s\S]+?)(?:\s+&)?\s*$/i);
  if (!match) {
    return { command, normalized: false };
  }

  let inner = (match[1] ?? "").trim();
  inner = inner.replace(/\s+2>&1\s*$/i, "").trim();

  let logPath = path.join(cwd, ".pakalon", "nohup", `nohup-${Date.now()}.log`);
  const redirect = inner.match(/([\s\S]+?)\s+>\s+(.+)$/);
  if (redirect) {
    inner = (redirect[1] ?? "").trim();
    logPath = path.resolve(cwd, (redirect[2] ?? "").trim().replace(/^["']|["']$/g, ""));
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const escapedCommand = inner.replace(/'/g, "''");
  const escapedCwd = cwd.replace(/'/g, "''");
  const escapedLog = logPath.replace(/'/g, "''");

  return {
    normalized: true,
    logPath,
    command:
      `Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command','${escapedCommand} *> ''${escapedLog}''') ` +
      `-WorkingDirectory '${escapedCwd}' -WindowStyle Hidden; ` +
      `Write-Output 'Started background command. Output: ${escapedLog}'`,
  };
}

export function readShellHistory(): ShellHistoryEntry[] {
  return readJsonFile<ShellHistoryEntry[]>(getHistoryPath(), []);
}

export function readNativeShellHistory(): ShellHistoryEntry[] {
  const entries: ShellHistoryEntry[] = [];
  for (const { shell, filePath } of nativeHistoryFiles()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const command = parseNativeHistoryLine(line);
        if (!command) continue;
        entries.push({
          id: `native:${shell}:${entries.length}`,
          shell,
          command,
          cwd: os.homedir(),
          createdAt: new Date(0).toISOString(),
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

export function recordShellHistory(entry: Omit<ShellHistoryEntry, "id" | "createdAt">): ShellHistoryEntry {
  const history = readShellHistory();
  const created: ShellHistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
  const next = [...history, created].slice(-HISTORY_LIMIT);
  writeJsonFile(getHistoryPath(), next);
  return created;
}

export function suggestShellHistory(query = "", limit = 10): ShellHistoryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const history = [...readNativeShellHistory(), ...readShellHistory()].slice().reverse();
  const seen = new Set<string>();
  const matches: ShellHistoryEntry[] = [];

  for (const entry of history) {
    const key = `${entry.shell}:${entry.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      normalizedQuery &&
      !entry.command.toLowerCase().includes(normalizedQuery) &&
      !(entry.expandedCommand ?? "").toLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }
    matches.push(entry);
    if (matches.length >= limit) break;
  }

  return matches;
}
