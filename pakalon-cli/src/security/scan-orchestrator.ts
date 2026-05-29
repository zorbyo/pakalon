import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import logger from '@/utils/logger.js';
import {
  generateSecurityReport,
  type ScanReport,
  type SecurityFinding,
} from './report-generator.js';

const execAsync = promisify(exec);

export type ScannerType = 'sast' | 'dast' | 'secrets' | 'dependencies' | 'all';

export interface ScanOptions {
  projectDir: string;
  scanners?: ScannerType[];
  targetUrl?: string;
  outputDir?: string;
  generateReport?: boolean;
  previousReportPath?: string;
  timeout?: number;
}

export interface ScannerResult {
  scanner: ScannerType;
  tool: string;
  success: boolean;
  findings: SecurityFinding[];
  rawOutput?: string;
  duration: number;
  error?: string;
}

export interface ScanSummary {
  scanId: string;
  timestamp: string;
  scanners: ScannerResult[];
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  duration: number;
}

type ParsedCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), '.pakalon', 'security', 'scans');
const DEFAULT_TIMEOUT = 120_000;

function nowIso(): string {
  return new Date().toISOString();
}

function createScanId(): string {
  return `scan-${new Date().toISOString().replace(/[\W:]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function resolveOutputDir(outputDir?: string): string {
  return path.resolve(outputDir ?? DEFAULT_OUTPUT_DIR);
}

function severityRank(severity: SecurityFinding['severity']): number {
  switch (severity) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

function normalizeSeverity(input?: string): SecurityFinding['severity'] {
  const value = (input ?? '').toString().trim().toLowerCase();
  if (value.includes('critical')) return 'critical';
  if (value.includes('high')) return 'high';
  if (value.includes('medium') || value.includes('moderate')) return 'medium';
  if (value.includes('low')) return 'low';
  return 'info';
}

function cleanText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function hashId(parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function createFinding(input: Omit<SecurityFinding, 'id' | 'firstSeen' | 'status'>, scanId: string): SecurityFinding {
  const stableId = hashId([
    scanId,
    input.category,
    input.severity,
    input.title,
    input.file ?? '',
    input.line ? String(input.line) : '',
    input.cve ?? '',
  ]);

  return {
    ...input,
    id: `finding-${stableId}`,
    firstSeen: nowIso(),
    status: 'open',
  };
}

function extractJsonCandidate(rawOutput: string): string | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;

  const firstObject = trimmed.indexOf('{');
  const firstArray = trimmed.indexOf('[');
  const startsAt = [firstObject, firstArray].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (startsAt === undefined) return null;

  return trimmed.slice(startsAt).trim();
}

function parseJsonOutput<T>(rawOutput: string): T | null {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function joinDetails(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

async function runCommand(command: string, cwd: string, timeout: number): Promise<ParsedCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env },
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; code?: number };
    const message = (e.message || '').toLowerCase();
    if (e.code === 'ENOENT' || message.includes('not recognized') || message.includes('command not found')) {
      throw new Error(`Tool not installed: ${command.split(/\s+/)[0]}`);
    }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
      timedOut: Boolean(e.killed && message.includes('timed out')),
    };
  }
}

function makeFindingTitle(prefix: string, suffix: string): string {
  return `${prefix}: ${suffix}`;
}

export function parseSemgrepOutput(rawOutput: string): SecurityFinding[] {
  const parsed = parseJsonOutput<any>(rawOutput);
  const results = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];

  return results.map((result: any) => {
    const file = cleanText(result?.path ?? result?.extra?.path ?? result?.location?.path);
    const line = Number(result?.start?.line ?? result?.extra?.line ?? result?.location?.start?.line);
    const severity = normalizeSeverity(result?.extra?.severity ?? result?.severity ?? result?.level);
    const ruleId = cleanText(result?.check_id ?? result?.extra?.rule_id ?? result?.rule_id);
    const title = cleanText(result?.extra?.message ?? result?.message ?? ruleId) || 'Semgrep finding';
    const description = joinDetails(
      cleanText(result?.extra?.message ?? result?.message),
      cleanText(result?.extra?.metadata?.cwe),
      cleanText(result?.extra?.metadata?.owasp),
    ) || title;

    return createFinding(
      {
        title,
        description,
        severity,
        category: 'sast',
        file: file || undefined,
        line: Number.isFinite(line) ? line : undefined,
        recommendation: cleanText(result?.extra?.metadata?.fix ?? result?.extra?.metadata?.recommendation) || undefined,
      },
      'semgrep',
    );
  });
}

function parseEslintOutput(rawOutput: string): SecurityFinding[] {
  const parsed = parseJsonOutput<any>(rawOutput);
  const files = Array.isArray(parsed) ? parsed : [];
  const findings: SecurityFinding[] = [];

  for (const fileResult of files) {
    const filePath = cleanText(fileResult?.filePath);
    for (const message of fileResult?.messages ?? []) {
      const severity = Number(message?.severity) === 2 ? 'high' : Number(message?.severity) === 1 ? 'medium' : 'info';
      findings.push(
        createFinding(
          {
            title: cleanText(message?.ruleId ?? message?.message) || 'ESLint finding',
            description: cleanText(message?.message) || 'ESLint reported a code quality/security issue',
            severity: severity === 'info' ? 'medium' : severity,
            category: 'sast',
            file: filePath || undefined,
            line: typeof message?.line === 'number' ? message.line : undefined,
            recommendation: cleanText(message?.suggestions?.[0]?.desc) || undefined,
          },
          'eslint',
        ),
      );
    }
  }

  return findings;
}

export function parseGitleaksOutput(rawOutput: string): SecurityFinding[] {
  const parsed = parseJsonOutput<any>(rawOutput);
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];

  return entries.map((entry: any) => {
    const file = cleanText(entry?.File ?? entry?.file ?? entry?.Path ?? entry?.path);
    const line = Number(entry?.StartLine ?? entry?.line ?? entry?.Line);
    const ruleId = cleanText(entry?.RuleID ?? entry?.ruleID ?? entry?.Rule ?? entry?.rule);
    const description = cleanText(entry?.Description ?? entry?.description ?? entry?.Secret ?? entry?.match) || 'Potential secret detected';
    const title = makeFindingTitle('Secret detected', ruleId || path.basename(file) || 'gitleaks');

    return createFinding(
      {
        title,
        description,
        severity: normalizeSeverity(entry?.Severity ?? entry?.severity) || 'high',
        category: 'secrets',
        file: file || undefined,
        line: Number.isFinite(line) ? line : undefined,
        recommendation: 'Rotate the secret, remove it from the repository, and add it to a secure secret store.',
        cve: cleanText(entry?.RuleID ?? entry?.ruleID) || undefined,
      },
      'gitleaks',
    );
  });
}

export function parseNpmAuditOutput(rawOutput: string): SecurityFinding[] {
  const parsed = parseJsonOutput<any>(rawOutput);
  const findings: SecurityFinding[] = [];

  if (!parsed) return findings;

  const advisories = parsed?.vulnerabilities && typeof parsed.vulnerabilities === 'object'
    ? Object.entries(parsed.vulnerabilities as Record<string, any>)
    : Object.entries(parsed?.advisories ?? {});

  for (const [packageName, vulnerability] of advisories) {
    const details = vulnerability as any;
    const viaItems = Array.isArray(details?.via) ? details.via : [details];

    for (const via of viaItems) {
      if (typeof via === 'string') {
        findings.push(
          createFinding(
            {
              title: makeFindingTitle('Dependency vulnerability', packageName),
              description: joinDetails(packageName, via, cleanText(details?.effects?.join?.(', '))) || `npm audit found an issue in ${packageName}`,
              severity: normalizeSeverity(details?.severity),
              category: 'dependency',
              file: 'package-lock.json',
              recommendation: cleanText(details?.fixAvailable ? 'Upgrade to the fixed version or apply the available fix.' : 'Upgrade the affected dependency to a patched version.'),
              cve: cleanText(details?.url) || undefined,
              cvss: typeof details?.cvss?.score === 'number' ? details.cvss.score : undefined,
            },
            'npm-audit',
          ),
        );
        continue;
      }

      const advisory = via as any;
      findings.push(
        createFinding(
          {
            title: makeFindingTitle('Dependency vulnerability', cleanText(advisory?.name) || packageName),
            description: joinDetails(
              cleanText(advisory?.title),
              cleanText(advisory?.range),
              cleanText(advisory?.via?.join?.(', ')),
            ) || `npm audit found a vulnerability in ${packageName}`,
            severity: normalizeSeverity(advisory?.severity ?? details?.severity),
            category: 'dependency',
            file: 'package-lock.json',
            recommendation: cleanText(details?.fixAvailable ? 'Upgrade the dependency or apply the suggested fix.' : 'Review the dependency tree and upgrade affected packages.'),
            cve: cleanText(advisory?.url ?? details?.url) || undefined,
            cvss: typeof advisory?.cvss?.score === 'number' ? advisory.cvss.score : typeof details?.cvss?.score === 'number' ? details.cvss.score : undefined,
          },
          'npm-audit',
        ),
      );
    }
  }

  return findings;
}

function parseZapJsonOutput(rawOutput: string): SecurityFinding[] {
  const parsed = parseJsonOutput<any>(rawOutput);
  const alerts = Array.isArray(parsed?.site)
    ? parsed.site.flatMap((site: any) => site?.alerts ?? [])
    : Array.isArray(parsed?.alerts)
      ? parsed.alerts
      : [];

  return alerts.map((alert: any) => {
    const file = cleanText(alert?.uri ?? alert?.url);
    const title = cleanText(alert?.alert ?? alert?.name) || 'DAST finding';
    const description = joinDetails(
      cleanText(alert?.desc ?? alert?.description),
      cleanText(alert?.solution),
      cleanText(alert?.reference),
    ) || title;

    return createFinding(
      {
        title: makeFindingTitle('ZAP alert', title),
        description,
        severity: normalizeSeverity(alert?.riskdesc ?? alert?.risk ?? alert?.severity),
        category: 'dast',
        file: file || undefined,
        recommendation: cleanText(alert?.solution) || 'Review the alert and harden the exposed endpoint.',
        cve: cleanText(alert?.cweid ?? alert?.wascid) || undefined,
      },
      'owasp-zap',
    );
  });
}

async function writeScannerArtifacts(scanDir: string, result: ScannerResult): Promise<void> {
  const fileBase = path.join(scanDir, result.scanner);
  await fs.writeFile(`${fileBase}.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (result.rawOutput) {
    await fs.writeFile(`${fileBase}.raw.txt`, result.rawOutput, 'utf8');
  }
}

async function loadPreviousReport(previousReportPath?: string): Promise<ScanReport | undefined> {
  if (!previousReportPath) return undefined;
  try {
    const raw = await fs.readFile(previousReportPath, 'utf8');
    const parsed = JSON.parse(raw) as ScanReport;
    return parsed?.findings ? parsed : undefined;
  } catch (error) {
    logger.warn(`[security-scan] Unable to load previous report: ${String(error)}`);
    return undefined;
  }
}

function selectScanners(scanners?: ScannerType[]): ScannerType[] {
  const requested = scanners?.length ? scanners : ['all'];
  const normalized = new Set<Exclude<ScannerType, 'all'>>();

  for (const scanner of requested) {
    if (scanner === 'all') {
      normalized.add('sast');
      normalized.add('dast');
      normalized.add('secrets');
      normalized.add('dependencies');
      continue;
    }
    normalized.add(scanner);
  }

  return [...normalized];
}

async function runSastWithSemgrep(projectDir: string, timeout: number, scanId: string): Promise<ScannerResult> {
  const startedAt = Date.now();
  try {
    const command = process.platform === 'win32'
      ? `semgrep scan --config auto --json --quiet "${projectDir}"`
      : `semgrep scan --config auto --json --quiet ${JSON.stringify(projectDir)}`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, projectDir, timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    const findings = parseSemgrepOutput(rawOutput);
    return {
      scanner: 'sast',
      tool: 'semgrep',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `semgrep exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    return {
      scanner: 'sast',
      tool: 'semgrep',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

async function runSastWithEslint(projectDir: string, timeout: number): Promise<ScannerResult> {
  const startedAt = Date.now();
  try {
    const command = process.platform === 'win32'
      ? `npx --no-install eslint . --ext .ts,.tsx,.js,.jsx --format json`
      : `npx --no-install eslint . --ext .ts,.tsx,.js,.jsx --format json`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, projectDir, timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    const findings = parseEslintOutput(rawOutput);
    return {
      scanner: 'sast',
      tool: 'eslint',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `eslint exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    return {
      scanner: 'sast',
      tool: 'eslint',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

export async function runSastScan(projectDir: string): Promise<ScannerResult> {
  const timeout = DEFAULT_TIMEOUT;
  const semgrepResult = await runSastWithSemgrep(projectDir, timeout, createScanId());
  if (semgrepResult.success || semgrepResult.error?.includes('exited with code')) return semgrepResult;
  if (semgrepResult.error?.includes('Tool not installed')) {
    logger.warn(`[security-scan] ${semgrepResult.error}; falling back to ESLint`);
    return runSastWithEslint(projectDir, timeout);
  }
  return semgrepResult;
}

export async function runSecretsScan(projectDir: string): Promise<ScannerResult> {
  const startedAt = Date.now();
  const timeout = DEFAULT_TIMEOUT;

  try {
    const command = `gitleaks detect --source ${JSON.stringify(projectDir)} --report-format json --report-path -`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, projectDir, timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    const findings = parseGitleaksOutput(rawOutput);
    return {
      scanner: 'secrets',
      tool: 'gitleaks',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `gitleaks exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    const fallback = String(error);
    logger.warn(`[security-scan] gitleaks unavailable: ${fallback}`);
    return {
      scanner: 'secrets',
      tool: 'regex-secret-scan',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: fallback,
    };
  }
}

function hasFile(projectDir: string, relativePath: string): Promise<boolean> {
  return fs
    .access(path.join(projectDir, relativePath))
    .then(() => true)
    .catch(() => false);
}

async function runNpmAudit(projectDir: string, timeout: number): Promise<ScannerResult> {
  const startedAt = Date.now();
  try {
    const command = `npm audit --json --omit=dev`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, projectDir, timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    const findings = parseNpmAuditOutput(rawOutput);
    return {
      scanner: 'dependencies',
      tool: 'npm audit',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `npm audit exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    return {
      scanner: 'dependencies',
      tool: 'npm audit',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

async function runPipAudit(projectDir: string, timeout: number): Promise<ScannerResult> {
  const startedAt = Date.now();
  try {
    const command = `pip-audit -f json`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, projectDir, timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    const parsed = parseJsonOutput<any>(rawOutput);
    const vulnerabilities = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.dependencies) ? parsed.dependencies : [];
    const findings = vulnerabilities.flatMap((item: any) => {
      const packageName = cleanText(item?.name ?? item?.package ?? item?.dependency);
      const entries = Array.isArray(item?.vulns) ? item.vulns : [];
      return entries.map((vuln: any) => createFinding(
        {
          title: makeFindingTitle('Python dependency vulnerability', packageName || 'pip-audit'),
          description: joinDetails(cleanText(vuln?.id), cleanText(vuln?.fix_versions?.join?.(', ')), cleanText(vuln?.description)) || 'pip-audit found a vulnerable package',
          severity: normalizeSeverity(vuln?.severity),
          category: 'dependency',
          file: 'requirements.txt',
          recommendation: 'Upgrade the affected Python dependency to a patched version.',
          cve: cleanText(vuln?.id) || undefined,
        },
        'pip-audit',
      ));
    });

    return {
      scanner: 'dependencies',
      tool: 'pip-audit',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `pip-audit exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    return {
      scanner: 'dependencies',
      tool: 'pip-audit',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

export async function runDependencyScan(projectDir: string): Promise<ScannerResult> {
  const timeout = DEFAULT_TIMEOUT;
  const hasNodeLock = await hasFile(projectDir, 'package-lock.json');
  const hasRequirements = await hasFile(projectDir, 'requirements.txt') || await hasFile(projectDir, 'pyproject.toml');

  if (hasNodeLock) {
    return runNpmAudit(projectDir, timeout);
  }

  if (hasRequirements) {
    return runPipAudit(projectDir, timeout);
  }

  return {
    scanner: 'dependencies',
    tool: 'dependency-scan',
    success: true,
    findings: [],
    duration: 0,
    error: 'No supported dependency manifest found',
  };
}

async function basicUrlScan(targetUrl: string, timeout: number): Promise<ScannerResult> {
  const startedAt = Date.now();
  const findings: SecurityFinding[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const headers = response.headers;
    const status = response.status;
    const isHttps = targetUrl.startsWith('https://');

    if (!isHttps) {
      findings.push(createFinding({
        title: 'Insecure transport',
        description: `Target URL uses HTTP instead of HTTPS: ${targetUrl}`,
        severity: 'medium',
        category: 'dast',
        file: targetUrl,
        recommendation: 'Serve the application over HTTPS and redirect all HTTP traffic.',
      }, 'basic-http-scan'));
    }

    if (status >= 500) {
      findings.push(createFinding({
        title: 'Server error response',
        description: `Target returned HTTP ${status}`,
        severity: 'high',
        category: 'dast',
        file: targetUrl,
        recommendation: 'Investigate the failing endpoint and remove error leakage.',
      }, 'basic-http-scan'));
    } else if (status >= 400) {
      findings.push(createFinding({
        title: 'Client error response',
        description: `Target returned HTTP ${status}`,
        severity: 'medium',
        category: 'dast',
        file: targetUrl,
        recommendation: 'Review the endpoint behavior and validate route handling.',
      }, 'basic-http-scan'));
    }

    const requiredHeaders = [
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
    ];

    const missing = requiredHeaders.filter((header) => !headers.has(header));
    if (isHttps && !headers.has('strict-transport-security')) missing.push('strict-transport-security');

    for (const header of missing) {
      findings.push(createFinding({
        title: `Missing security header: ${header}`,
        description: `The target response does not set ${header}.`,
        severity: header === 'content-security-policy' || header === 'strict-transport-security' ? 'medium' : 'low',
        category: 'dast',
        file: targetUrl,
        recommendation: `Add the ${header} header to the HTTP response.`,
      }, 'basic-http-scan'));
    }

    return {
      scanner: 'dast',
      tool: 'basic-http-scan',
      success: true,
      findings,
      rawOutput: JSON.stringify({ targetUrl, status, missingHeaders: missing }, null, 2),
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      scanner: 'dast',
      tool: 'basic-http-scan',
      success: false,
      findings: [createFinding({
        title: 'Target unreachable',
        description: `Failed to reach ${targetUrl}: ${String(error)}`,
        severity: 'high',
        category: 'dast',
        file: targetUrl,
        recommendation: 'Verify the target URL, application uptime, and network access.',
      }, 'basic-http-scan')],
      rawOutput: String(error),
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

async function runZapBaseline(targetUrl: string, timeout: number): Promise<ScannerResult> {
  const startedAt = Date.now();
  const workDir = path.join(process.cwd(), '.pakalon', 'security', 'zap');
  const reportJson = path.join(workDir, `zap-${createScanId()}.json`);
  const reportHtml = path.join(workDir, `zap-${createScanId()}.html`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const command = `zap-baseline.py -t ${JSON.stringify(targetUrl)} -J ${JSON.stringify(reportJson)} -r ${JSON.stringify(reportHtml)}`;
    const { stdout, stderr, exitCode, timedOut } = await runCommand(command, process.cwd(), timeout);
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n');
    let findings: SecurityFinding[] = [];
    try {
      const reportRaw = await fs.readFile(reportJson, 'utf8');
      findings = parseZapJsonOutput(reportRaw);
    } catch {
      findings = parseZapJsonOutput(rawOutput);
    }

    return {
      scanner: 'dast',
      tool: 'owasp-zap',
      success: !timedOut,
      findings,
      rawOutput,
      duration: Date.now() - startedAt,
      error: exitCode ? `zap-baseline exited with code ${exitCode}` : undefined,
    };
  } catch (error) {
    return {
      scanner: 'dast',
      tool: 'owasp-zap',
      success: false,
      findings: [],
      duration: Date.now() - startedAt,
      error: String(error),
    };
  }
}

export async function runDastScan(targetUrl: string): Promise<ScannerResult> {
  const timeout = DEFAULT_TIMEOUT;
  try {
    const zapResult = await runZapBaseline(targetUrl, timeout);
    if (zapResult.findings.length || zapResult.success) return zapResult;
  } catch {
    // Fall through to basic scan.
  }

  return basicUrlScan(targetUrl, timeout);
}

async function writeSummary(scanDir: string, summary: ScanSummary, reportFiles: string[] = []): Promise<void> {
  await fs.writeFile(
    path.join(scanDir, 'scan-summary.json'),
    `${JSON.stringify({ ...summary, reportFiles }, null, 2)}\n`,
    'utf8',
  );
}

export async function runSecurityScan(options: ScanOptions): Promise<ScanSummary> {
  const startedAt = Date.now();
  const scanId = createScanId();
  const timestamp = nowIso();
  const outputDir = resolveOutputDir(options.outputDir);
  const scanDir = path.join(outputDir, scanId);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const scanners = selectScanners(options.scanners);
  const previousReport = await loadPreviousReport(options.previousReportPath);

  await fs.mkdir(scanDir, { recursive: true });

  const tasks = scanners.map(async (scanner) => {
    let result: ScannerResult;
    if (scanner === 'sast') {
      result = await runSastScan(options.projectDir);
    } else if (scanner === 'secrets') {
      result = await runSecretsScan(options.projectDir);
    } else if (scanner === 'dependencies') {
      result = await runDependencyScan(options.projectDir);
    } else {
      if (!options.targetUrl) {
        result = {
          scanner: 'dast',
          tool: 'basic-http-scan',
          success: false,
          findings: [],
          duration: 0,
          error: 'DAST requires targetUrl',
        };
      } else {
        result = await runDastScan(options.targetUrl);
      }
    }

    await writeScannerArtifacts(scanDir, result);
    return result;
  });

  const scannersResults = await Promise.all(tasks);
  const findings = scannersResults.flatMap((result) => result.findings);

  let reportFiles: string[] = [];
  if (options.generateReport !== false) {
    const reportOutputDir = path.join(outputDir, 'reports');
    const { files } = await generateSecurityReport(findings, previousReport, {
      outputDir: reportOutputDir,
      includeRaw: true,
      title: `Security Scan ${scanId}`,
    });
    reportFiles = files;
  }

  const summary: ScanSummary = {
    scanId,
    timestamp,
    scanners: scannersResults,
    totalFindings: findings.length,
    criticalCount: findings.filter((finding) => finding.severity === 'critical').length,
    highCount: findings.filter((finding) => finding.severity === 'high').length,
    mediumCount: findings.filter((finding) => finding.severity === 'medium').length,
    duration: Date.now() - startedAt,
  };

  await writeSummary(scanDir, summary, reportFiles);

  logger.info(
    `[security-scan] ${scanId} completed with ${summary.totalFindings} findings across ${scannersResults.length} scanner(s)`,
  );

  return summary;
}
