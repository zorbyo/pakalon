/**
 * Logger — writes debug entries to ~/.config/pakalon/debug.log
 * Only active when PAKALON_DEBUG=1 env var is set.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type LogLevel = "debug" | "info" | "warn" | "error";

const DEBUG = process.env["PAKALON_DEBUG"] === "1";
const LOG_DIR = path.join(os.homedir(), ".config", "pakalon");
const LOG_FILE = path.join(LOG_DIR, "debug.log");

let logStream: fs.WriteStream | null = null;
let currentLevel: LogLevel = DEBUG ? "debug" : "info";

export function setLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return order[level] >= order[currentLevel];
}

function getStream(): fs.WriteStream | null {
  if (!DEBUG) return null;
  if (logStream) return logStream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    return logStream;
  } catch {
    return null;
  }
}

function write(level: string, message: string, data?: unknown): void {
  if (!shouldLog(level as LogLevel)) return;
  const stream = getStream();
  if (!stream) return;
  const ts = new Date().toISOString();
  const entry = data
    ? `${ts} [${level}] ${message} ${JSON.stringify(data)}\n`
    : `${ts} [${level}] ${message}\n`;
  stream.write(entry);
}

export const logger = {
  debug: (msg: string, data?: unknown) => write("DEBUG", msg, data),
  info: (msg: string, data?: unknown) => write("INFO", msg, data),
  warn: (msg: string, data?: unknown) => write("WARN", msg, data),
  error: (msg: string, data?: unknown) => write("ERROR", msg, data),
  setLevel,
};

/** Convenience alias — writes a DEBUG-level entry if PAKALON_DEBUG=1 */
export function debugLog(msg: string, data?: unknown): void {
  write("DEBUG", msg, data);
}

export default logger;
