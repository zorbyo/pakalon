import fs from 'fs/promises';
import path from 'path';
import { runPenetrationTest } from './pentest-automation.js';

export interface MonitorFinding {
  id: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  details: string;
}

export interface MonitorHandle {
  stop(): Promise<void>;
  isRunning: boolean;
  lastRunAt?: string;
}

async function appendLog(projectDir: string, message: string): Promise<void> {
  const outputDir = path.join(projectDir, '.pakalon-agents', 'phase-4');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.appendFile(path.join(outputDir, 'monitor.log'), `${new Date().toISOString()} ${message}\n`, 'utf8');
}

async function runtimeSnapshot(targetUrl: string, projectDir: string): Promise<MonitorFinding[]> {
  const findings: MonitorFinding[] = [];

  try {
    const response = await fetch(targetUrl, { method: 'GET', redirect: 'follow' });
    const headers = Object.fromEntries(response.headers as unknown as Iterable<[string, string]>);
    const missing = ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security']
      .filter((header) => !(header in headers));
    for (const header of missing) {
      findings.push({
        id: `header:${header}`,
        source: 'headers',
        severity: header === 'content-security-policy' || header === 'strict-transport-security' ? 'high' : 'medium',
        title: `Missing ${header}`,
        details: `The runtime target is missing ${header}.`,
      });
    }
  } catch (error) {
    findings.push({
      id: 'runtime:unreachable',
      source: 'fetch',
      severity: 'high',
      title: 'Target unreachable',
      details: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const pentest = await runPenetrationTest(targetUrl, projectDir);
    for (const finding of pentest.findings.slice(0, 20)) {
      findings.push({
        id: `zap:${finding.category}:${finding.alert}:${finding.url}`,
        source: 'zap',
        severity: finding.risk === 'High' ? 'high' : finding.risk === 'Medium' ? 'medium' : 'low',
        title: finding.alert,
        details: finding.solution,
      });
    }
  } catch {
    // best effort only
  }

  return findings;
}

export async function startRuntimeMonitoring(targetUrl: string, intervalMs: number): Promise<MonitorHandle> {
  const projectDir = process.cwd();
  const seen = new Set<string>();
  let running = true;
  let lastRunAt: string | undefined;
  let inFlight = false;

  const run = async (): Promise<void> => {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      const findings = await runtimeSnapshot(targetUrl, projectDir);
      lastRunAt = new Date().toISOString();
      for (const finding of findings) {
        if (seen.has(finding.id)) continue;
        seen.add(finding.id);
        await appendLog(projectDir, `[ALERT] ${finding.title} (${finding.severity}) - ${finding.details}`);
      }
      await appendLog(projectDir, `[INFO] runtime scan completed with ${findings.length} findings`);
    } finally {
      inFlight = false;
    }
  };

  await run();
  const timer = setInterval(() => { void run(); }, Math.max(30_000, intervalMs));

  return {
    get isRunning() {
      return running;
    },
    get lastRunAt() {
      return lastRunAt;
    },
    async stop(): Promise<void> {
      running = false;
      clearInterval(timer);
      await appendLog(projectDir, '[INFO] runtime monitoring stopped');
    },
  };
}
