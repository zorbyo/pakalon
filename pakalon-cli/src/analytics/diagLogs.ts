import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface DiagnosticLogEntry {
  timestamp: string;
  level: DiagnosticLogLevel;
  event: string;
  data: Record<string, unknown>;
}

function getDiagnosticLogFile(): string | undefined {
  return process.env.PAKALON_DIAGNOSTICS_FILE;
}

export function logForDiagnosticsNoPII(
  level: DiagnosticLogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const logFile = getDiagnosticLogFile();
  if (!logFile) {
    return;
  }

  const entry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    data: data ?? {},
  };

  const line = JSON.stringify(entry) + '\n';
  try {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(logFile, line);
  } catch {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, line);
    } catch {
      // Silently fail if logging is not possible
    }
  }
}

export async function withDiagnosticsTiming<T>(
  event: string,
  fn: () => Promise<T>,
  getData?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startTime = Date.now();
  logForDiagnosticsNoPII('info', `${event}_started`);

  try {
    const result = await fn();
    const additionalData = getData ? getData(result) : {};
    logForDiagnosticsNoPII('info', `${event}_completed`, {
      duration_ms: Date.now() - startTime,
      ...additionalData,
    });
    return result;
  } catch (error) {
    logForDiagnosticsNoPII('error', `${event}_failed`, {
      duration_ms: Date.now() - startTime,
    });
    throw error;
  }
}