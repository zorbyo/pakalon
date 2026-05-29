import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface SecurityFinding {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'sast' | 'dast' | 'dependency' | 'secrets' | 'compliance' | 'code-review';
  file?: string;
  line?: number;
  recommendation?: string;
  cve?: string;
  cvss?: number;
  firstSeen: string;
  status: 'open' | 'fixed' | 'wontfix' | 'false-positive';
}

export interface ScanReport {
  scanId: string;
  timestamp: string;
  duration: number;
  tools: string[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    securityScore: number;
  };
  findings: SecurityFinding[];
  regressions: {
    new: SecurityFinding[];
    fixed: SecurityFinding[];
  };
  metadata: Record<string, any>;
}

export interface ReportOptions {
  outputDir: string;
  formats: ('markdown' | 'json' | 'html')[];
  includeRaw?: boolean;
  title?: string;
}

type ReportIndex = {
  version: 1;
  updatedAt: string;
  latestScanId?: string;
  reports: Array<{
    scanId: string;
    timestamp: string;
    files: string[];
    summary: ScanReport['summary'];
  }>;
  findings: Record<
    string,
    {
      firstSeen: string;
      lastSeen: string;
      lastStatus: SecurityFinding['status'];
      lastSeverity: SecurityFinding['severity'];
      category: SecurityFinding['category'];
      title: string;
      history: Array<{
        scanId: string;
        timestamp: string;
        status: SecurityFinding['status'];
        severity: SecurityFinding['severity'];
      }>;
    }
  >;
};

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), '.pakalon', 'security', 'reports');
const SEVERITY_WEIGHTS: Record<SecurityFinding['severity'], number> = {
  critical: 25,
  high: 10,
  medium: 3,
  low: 1,
  info: 0,
};

function resolveOutputDir(outputDir?: string): string {
  return path.resolve(outputDir ?? DEFAULT_OUTPUT_DIR);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createScanId(): string {
  return `scan-${new Date().toISOString().replace(/[\W:]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function ensureStatus(status?: SecurityFinding['status']): SecurityFinding['status'] {
  return status ?? 'open';
}

function normalizeFinding(finding: SecurityFinding, seenAt: string): SecurityFinding {
  return {
    ...finding,
    status: ensureStatus(finding.status),
    firstSeen: finding.firstSeen || seenAt,
  };
}

function isOpen(finding: SecurityFinding): boolean {
  return finding.status === 'open';
}

function sortFindings(findings: SecurityFinding[]): SecurityFinding[] {
  const order: Record<SecurityFinding['severity'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  return [...findings].sort((a, b) => {
    const severityDelta = order[a.severity] - order[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const categoryDelta = a.category.localeCompare(b.category);
    if (categoryDelta !== 0) return categoryDelta;
    return a.title.localeCompare(b.title);
  });
}

function openFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return findings.filter(isOpen);
}

function formatCvEReference(cve: string | undefined): { label: string; url?: string } {
  if (!cve) return { label: '' };
  const normalized = cve.trim().toUpperCase();
  const url = `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(normalized)}`;
  return { label: normalized, url };
}

function cveLinksForFindings(findings: SecurityFinding[]): Record<string, string> {
  const links: Record<string, string> = {};
  for (const finding of findings) {
    if (finding.cve) {
      links[finding.id] = formatCvEReference(finding.cve).url ?? '';
    }
  }
  return links;
}

function buildSummary(findings: SecurityFinding[]): ScanReport['summary'] {
  const open = openFindings(findings);
  const summary = {
    total: open.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    securityScore: calculateSecurityScore(open),
  };

  for (const finding of open) {
    summary[finding.severity] += 1;
  }

  return summary;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadIndex(indexPath: string): Promise<ReportIndex> {
  const existing = await readJson<ReportIndex>(indexPath);
  if (existing?.version === 1) return existing;
  return {
    version: 1,
    updatedAt: nowIso(),
    reports: [],
    findings: {},
  };
}

function updateIndexHistory(index: ReportIndex, report: ScanReport): ReportIndex {
  const updated = structuredClone(index) as ReportIndex;
  const timestamp = report.timestamp;

  for (const finding of report.findings) {
    const current = updated.findings[finding.id];
    if (!current) {
      updated.findings[finding.id] = {
        firstSeen: finding.firstSeen,
        lastSeen: timestamp,
        lastStatus: finding.status,
        lastSeverity: finding.severity,
        category: finding.category,
        title: finding.title,
        history: [
          {
            scanId: report.scanId,
            timestamp,
            status: finding.status,
            severity: finding.severity,
          },
        ],
      };
      continue;
    }

    current.lastSeen = timestamp;
    current.lastStatus = finding.status;
    current.lastSeverity = finding.severity;
    current.category = finding.category;
    current.title = finding.title;
    current.history.push({
      scanId: report.scanId,
      timestamp,
      status: finding.status,
      severity: finding.severity,
    });
  }

  updated.reports.push({
    scanId: report.scanId,
    timestamp,
    files: [],
    summary: report.summary,
  });
  updated.latestScanId = report.scanId;
  updated.updatedAt = timestamp;
  return updated;
}

function findingsFromIndex(index: ReportIndex): SecurityFinding[] {
  return Object.entries(index.findings)
    .filter(([, entry]) => entry.lastStatus === 'open')
    .map(([id, entry]) => ({
      id,
      title: entry.title,
      description: entry.title,
      severity: entry.lastSeverity,
      category: entry.category,
      firstSeen: entry.firstSeen,
      status: entry.lastStatus,
    }));
}

function detectRegressions(current: SecurityFinding[], previous: SecurityFinding[]): { new: SecurityFinding[]; fixed: SecurityFinding[] } {
  const currentOpen = openFindings(current);
  const previousOpen = openFindings(previous);
  const currentIds = new Set(currentOpen.map((finding) => finding.id));
  const previousIds = new Set(previousOpen.map((finding) => finding.id));

  return {
    new: sortFindings(currentOpen.filter((finding) => !previousIds.has(finding.id))),
    fixed: sortFindings(previousOpen.filter((finding) => !currentIds.has(finding.id))),
  };
}

function formatFindingsByCategory(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
  const grouped: Record<string, SecurityFinding[]> = {
    sast: [],
    dast: [],
    dependency: [],
    secrets: [],
    compliance: [],
    'code-review': [],
  };

  for (const finding of findings) {
    grouped[finding.category] ??= [];
    grouped[finding.category].push(finding);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = sortFindings(grouped[key]);
  }

  return grouped;
}

function calculateSecurityScore(findings: SecurityFinding[]): number {
  const open = openFindings(findings);
  const counts = open.reduce(
    (acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );

  const penalty =
    counts.critical * SEVERITY_WEIGHTS.critical +
    counts.high * SEVERITY_WEIGHTS.high +
    counts.medium * SEVERITY_WEIGHTS.medium +
    counts.low * SEVERITY_WEIGHTS.low;

  return Math.max(0, 100 - penalty);
}

function buildMarkdownReport(report: ScanReport, title: string): string {
  const grouped = formatFindingsByCategory(report.findings);
  const cveLinks = cveLinksForFindings(report.findings);
  const score = report.summary.securityScore;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const topIssues = report.regressions.new.slice(0, 5);

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**Scan ID:** ${report.scanId}  `);
  lines.push(`**Generated:** ${report.timestamp}  `);
  lines.push(`**Duration:** ${(report.duration / 1000).toFixed(1)}s  `);
  lines.push(`**Tools:** ${report.tools.length ? report.tools.join(', ') : 'n/a'}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Security Score | ${score}/100 (${grade}) |`);
  lines.push(`| Open Findings | ${report.summary.total} |`);
  lines.push(`| Critical | ${report.summary.critical} |`);
  lines.push(`| High | ${report.summary.high} |`);
  lines.push(`| Medium | ${report.summary.medium} |`);
  lines.push(`| Low | ${report.summary.low} |`);
  lines.push(`| Info | ${report.summary.info} |`);
  lines.push('');
  lines.push('### Regression Tracking');
  lines.push('');
  lines.push(`- New issues: ${report.regressions.new.length}`);
  lines.push(`- Fixed issues: ${report.regressions.fixed.length}`);
  lines.push('');

  if (topIssues.length) {
    lines.push('### New Issues Requiring Attention');
    lines.push('');
    for (const finding of topIssues) {
      lines.push(`- **${finding.title}** (${finding.severity.toUpperCase()}, ${finding.category})`);
      lines.push(`  - ${escapeMarkdown(finding.description)}`);
      if (finding.recommendation) lines.push(`  - Recommendation: ${escapeMarkdown(finding.recommendation)}`);
    }
    lines.push('');
  }

  lines.push('## Findings by Category');
  lines.push('');

  for (const [category, categoryFindings] of Object.entries(grouped)) {
    if (!categoryFindings.length) continue;
    lines.push(`### ${category.toUpperCase()}`);
    lines.push('');
    lines.push(`| Severity | Status | Title | Location | CVE |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const finding of categoryFindings) {
      const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : '—';
      const cve = finding.cve ? `[${formatCvEReference(finding.cve).label}](${cveLinks[finding.id]})` : '—';
      lines.push(
        `| ${finding.severity.toUpperCase()} | ${finding.status} | ${escapeMarkdown(finding.title)} | ${escapeMarkdown(location)} | ${cve} |`,
      );
      lines.push(`|  |  | ${escapeMarkdown(finding.description)} |  |  |`);
      if (finding.recommendation) {
        lines.push(`|  |  | _Recommendation:_ ${escapeMarkdown(finding.recommendation)} |  |  |`);
      }
    }
    lines.push('');
  }

  if (report.regressions.new.length) {
    lines.push('## New Findings');
    lines.push('');
    for (const finding of report.regressions.new) {
      lines.push(`- **${escapeMarkdown(finding.title)}** (${finding.severity.toUpperCase()})`);
    }
    lines.push('');
  }

  if (report.regressions.fixed.length) {
    lines.push('## Fixed Findings');
    lines.push('');
    for (const finding of report.regressions.fixed) {
      lines.push(`- ~~${escapeMarkdown(finding.title)}~~ (${finding.severity.toUpperCase()})`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildHtmlReport(report: ScanReport, title: string): string {
  const cveLinks = cveLinksForFindings(report.findings);
  const grouped = formatFindingsByCategory(report.findings);
  const score = report.summary.securityScore;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  const cards = [
    ['Security Score', `${score}/100 (${grade})`],
    ['Open Findings', String(report.summary.total)],
    ['Critical', String(report.summary.critical)],
    ['High', String(report.summary.high)],
    ['Medium', String(report.summary.medium)],
    ['Low', String(report.summary.low)],
    ['Info', String(report.summary.info)],
    ['New', String(report.regressions.new.length)],
    ['Fixed', String(report.regressions.fixed.length)],
  ]
    .map(
      ([label, value]) => `
        <div class="card">
          <div class="card-label">${escapeHtml(label)}</div>
          <div class="card-value">${escapeHtml(value)}</div>
        </div>`,
    )
    .join('');

  const categorySections = Object.entries(grouped)
    .filter(([, findings]) => findings.length)
    .map(([category, findings]) => {
      const rows = findings
        .map((finding) => {
          const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : '—';
          const cve = finding.cve ? `<a href="${cveLinks[finding.id]}" target="_blank" rel="noreferrer">${escapeHtml(formatCvEReference(finding.cve).label)}</a>` : '—';
          return `
            <tr>
              <td><span class="sev sev-${finding.severity}">${finding.severity.toUpperCase()}</span></td>
              <td>${escapeHtml(finding.status)}</td>
              <td><strong>${escapeHtml(finding.title)}</strong><div class="muted">${escapeHtml(finding.description)}</div>${finding.recommendation ? `<div class="rec">Recommendation: ${escapeHtml(finding.recommendation)}</div>` : ''}</td>
              <td>${escapeHtml(location)}</td>
              <td>${cve}</td>
            </tr>`;
        })
        .join('');

      return `
        <section class="section">
          <h2>${escapeHtml(category.toUpperCase())}</h2>
          <table>
            <thead>
              <tr><th>Severity</th><th>Status</th><th>Finding</th><th>Location</th><th>CVE</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  const regressions = `
    <section class="section">
      <h2>Regression Tracking</h2>
      <div class="split">
        <div>
          <h3>New Issues</h3>
          <ul>${report.regressions.new.map((finding) => `<li>${escapeHtml(finding.title)} <span class="muted">(${finding.severity.toUpperCase()})</span></li>`).join('') || '<li>None</li>'}</ul>
        </div>
        <div>
          <h3>Fixed Issues</h3>
          <ul>${report.regressions.fixed.map((finding) => `<li>${escapeHtml(finding.title)} <span class="muted">(${finding.severity.toUpperCase()})</span></li>`).join('') || '<li>None</li>'}</ul>
        </div>
      </div>
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1020; color: #e5eefb; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 20px 56px; }
    .hero { background: linear-gradient(135deg, #111827, #172554); border: 1px solid rgba(148,163,184,.2); border-radius: 20px; padding: 28px; box-shadow: 0 24px 48px rgba(0,0,0,.22); }
    h1,h2,h3 { margin: 0 0 12px; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }
    .card { background: rgba(15,23,42,.7); border: 1px solid rgba(148,163,184,.18); border-radius: 16px; padding: 16px; }
    .card-label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #93c5fd; }
    .card-value { margin-top: 8px; font-size: 28px; font-weight: 700; }
    .section { margin-top: 28px; background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.16); border-radius: 18px; padding: 22px; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid rgba(148,163,184,.16); vertical-align: top; }
    th { color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .sev { display: inline-flex; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .sev-critical { background: #7f1d1d; color: #fecaca; }
    .sev-high { background: #9a3412; color: #fed7aa; }
    .sev-medium { background: #92400e; color: #fde68a; }
    .sev-low { background: #1d4ed8; color: #dbeafe; }
    .sev-info { background: #374151; color: #e5eefb; }
    .muted { color: #94a3b8; font-size: 13px; }
    .rec { color: #cbd5e1; font-size: 13px; margin-top: 4px; }
    a { color: #93c5fd; }
    ul { margin: 0; padding-left: 20px; }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">Security report generated for scan <strong>${escapeHtml(report.scanId)}</strong> on ${escapeHtml(report.timestamp)}.</p>
      <div class="meta">${cards}</div>
    </section>

    <section class="section">
      <h2>Executive Summary</h2>
      <p>Security score: <strong>${score}/100</strong>. New issues: <strong>${report.regressions.new.length}</strong>. Fixed issues: <strong>${report.regressions.fixed.length}</strong>.</p>
    </section>

    ${regressions}
    ${categorySections}
  </main>
</body>
</html>`;
}

export async function generateSecurityReport(
  findings: SecurityFinding[],
  previousReport?: ScanReport,
  options?: Partial<ReportOptions>,
): Promise<{
  report: ScanReport;
  files: string[];
}> {
  const outputDir = resolveOutputDir(options?.outputDir);
  const title = options?.title ?? 'Security Report';
  const timestamp = nowIso();
  const scanId = createScanId();
  const indexPath = path.join(outputDir, 'security-index.json');
  const formats = options?.formats ?? ['markdown', 'json', 'html'];
  const startedAt = Date.now();

  await fs.mkdir(outputDir, { recursive: true });

  const index = await loadIndex(indexPath);
  const seenAt = previousReport?.timestamp ?? index.updatedAt ?? timestamp;
  const normalizedFindings = findings.map((finding) => normalizeFinding(finding, seenAt));

  const previousFindings = previousReport?.findings?.length
    ? previousReport.findings.map((finding) => normalizeFinding(finding, previousReport.timestamp))
    : findingsFromIndex(index);

  const regressions = detectRegressions(normalizedFindings, previousFindings);
  const summary = buildSummary(normalizedFindings);
  const report: ScanReport = {
    scanId,
    timestamp,
    duration: 0,
    tools: [],
    summary,
    findings: sortFindings(normalizedFindings),
    regressions,
    metadata: {
      title,
      outputDir,
      generatedAt: timestamp,
      cveLinks: cveLinksForFindings(normalizedFindings),
      groupedByCategory: Object.fromEntries(
        Object.entries(formatFindingsByCategory(normalizedFindings)).map(([category, items]) => [category, items.length]),
      ),
    },
  };
  report.duration = Date.now() - startedAt;

  const jsonPath = path.join(outputDir, `${scanId}.json`);
  const markdownPath = path.join(outputDir, `${scanId}.md`);
  const htmlPath = path.join(outputDir, `${scanId}.html`);
  const rawPath = path.join(outputDir, `${scanId}.raw.json`);

  const files: string[] = [];

  const writeReport = async (format: 'json' | 'markdown' | 'html', filePath: string): Promise<void> => {
    if (!formats.includes(format)) return;
    if (format === 'json') {
      await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } else if (format === 'markdown') {
      await fs.writeFile(filePath, buildMarkdownReport(report, title), 'utf8');
    } else {
      await fs.writeFile(filePath, buildHtmlReport(report, title), 'utf8');
    }
    files.push(filePath);
  };

  await writeReport('json', jsonPath);
  await writeReport('markdown', markdownPath);
  await writeReport('html', htmlPath);

  if (options?.includeRaw) {
    await fs.writeFile(rawPath, `${JSON.stringify({ scanId, timestamp, findings }, null, 2)}\n`, 'utf8');
    files.push(rawPath);
  }

  const updatedIndex = updateIndexHistory(index, report);
  const latestReportEntry = updatedIndex.reports.at(-1);
  if (latestReportEntry) {
    latestReportEntry.files = [...files];
  }

  await fs.writeFile(indexPath, `${JSON.stringify(updatedIndex, null, 2)}\n`, 'utf8');
  files.push(indexPath);

  return { report, files };
}
