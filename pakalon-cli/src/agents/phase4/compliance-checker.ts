import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';

export interface ComplianceFinding {
  standard: string;
  control: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  evidence: string[];
  recommendation: string;
}

export interface ComplianceReport {
  projectDir: string;
  standards: string[];
  generatedAt: string;
  findings: ComplianceFinding[];
  score: number;
}

const CONTROL_KEYWORDS: Record<string, { positive: RegExp[]; negative?: RegExp[]; recommendation: string }> = {
  encryption: {
    positive: [/encrypt/i, /tls/i, /https/i, /bcrypt/i, /argon2/i, /crypto/i, /kms/i, /helmet/i],
    recommendation: 'Use transport and at-rest encryption for sensitive data.',
  },
  access_controls: {
    positive: [/auth/i, /rbac/i, /acl/i, /permission/i, /role/i, /session/i, /jwt/i, /clerk/i, /supabase/i],
    recommendation: 'Enforce least-privilege access controls and authenticated routes.',
  },
  audit_logging: {
    positive: [/audit/i, /logger/i, /log/i, /trace/i, /event/i],
    recommendation: 'Keep auditable logs for security-relevant actions.',
  },
  data_retention: {
    positive: [/retention/i, /delete account/i, /erase/i, /purge/i, /ttl/i, /lifecycle/i],
    recommendation: 'Define retention and deletion policies for stored user data.',
  },
  consent_management: {
    positive: [/consent/i, /cookie/i, /privacy policy/i, /opt[- ]in/i, /gdpr/i],
    recommendation: 'Provide explicit consent and privacy controls where required.',
  },
};

function normalizeStandards(standards: string[]): string[] {
  return standards.map((standard) => standard.trim().toUpperCase()).filter(Boolean);
}

async function gatherEvidence(projectDir: string): Promise<string[]> {
  const candidates = await fg(['package.json', 'README*', 'src/**/*.{ts,tsx,js,jsx}', '.pakalon/**/*', '.env*'], {
    cwd: projectDir,
    dot: true,
    onlyFiles: true,
    unique: true,
    ignore: ['node_modules/**', 'dist/**', '.git/**', '.pakalon-agents/**'],
  });

  const evidence: string[] = [];
  for (const relative of candidates.slice(0, 50)) {
    const absolute = path.join(projectDir, relative);
    const content = await fs.readFile(absolute, 'utf8').catch(() => '');
    if (!content) continue;
    for (const [name, control] of Object.entries(CONTROL_KEYWORDS)) {
      if (control.positive.some((pattern) => pattern.test(content))) {
        evidence.push(`${relative}: ${name}`);
      }
    }
  }

  return [...new Set(evidence)];
}

function evaluateControl(standard: string, control: string, evidence: string[]): ComplianceFinding {
  const present = evidence.filter((entry) => entry.includes(control));
  const status: ComplianceFinding['status'] = present.length > 0 ? 'pass' : 'fail';
  return {
    standard,
    control,
    status,
    evidence: present,
    recommendation: CONTROL_KEYWORDS[control]?.recommendation ?? 'Review this control manually.',
  };
}

function controlsForStandard(standard: string): string[] {
  if (standard === 'SOC2') return ['encryption', 'access_controls', 'audit_logging', 'data_retention'];
  if (standard === 'GDPR') return ['encryption', 'access_controls', 'data_retention', 'consent_management'];
  return Object.keys(CONTROL_KEYWORDS);
}

export async function runComplianceCheck(projectDir: string, standards: string[]): Promise<ComplianceReport> {
  const requested = normalizeStandards(standards.length ? standards : ['SOC2', 'GDPR']);
  const evidence = await gatherEvidence(projectDir);
  const findings: ComplianceFinding[] = [];

  for (const standard of requested) {
    for (const control of controlsForStandard(standard)) {
      findings.push(evaluateControl(standard, control, evidence));
    }
  }

  const score = Math.round((findings.filter((finding) => finding.status === 'pass').length / Math.max(1, findings.length)) * 100);
  const report: ComplianceReport = {
    projectDir,
    standards: requested,
    generatedAt: new Date().toISOString(),
    findings,
    score,
  };

  const outputDir = path.join(projectDir, '.pakalon-agents', 'phase-4');
  await fs.mkdir(outputDir, { recursive: true });

  const lines = [
    '# Compliance Audit Report',
    '',
    `- Project: ${projectDir}`,
    `- Standards: ${requested.join(', ')}`,
    `- Score: ${score}/100`,
    '',
  ];

  for (const standard of requested) {
    lines.push(`## ${standard}`);
    for (const finding of findings.filter((item) => item.standard === standard)) {
      lines.push(`- [${finding.status.toUpperCase()}] ${finding.control.replace(/_/g, ' ')}`);
      if (finding.evidence.length) lines.push(`  - Evidence: ${finding.evidence.slice(0, 3).join(', ')}`);
      lines.push(`  - Recommendation: ${finding.recommendation}`);
    }
    lines.push('');
  }

  await fs.writeFile(path.join(outputDir, 'compliance-report.md'), `${lines.join('\n')}\n`, 'utf8');
  return report;
}
