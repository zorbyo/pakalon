import * as fs from 'fs/promises';
import * as path from 'path';

import { collectProjectTree } from '../../pipeline/session.js';

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  file?: string;
  line?: number;
  requirement?: string;
  status: 'open' | 'fixed' | 'accepted';
}

export interface RequirementCheckContext {
  projectDir: string;
  tree?: string[];
  artifactText?: Map<string, string>;
}

const REQUIRED_PHASE1_FILES = [
  '.pakalon/plan.md',
  '.pakalon/tasks.md',
  '.pakalon/spec.md',
];

const REQUIRED_PHASE2_FILES = [
  '.pakalon-agents/ai-agents/phase-2/phase-2.md',
  '.pakalon-agents/ai-agents/phase-2/Wireframe_generated.svg',
  '.pakalon-agents/ai-agents/phase-2/Wireframe_generated.penpot',
];

const REQUIRED_PHASE3_FILES = [
  '.pakalon-agents/ai-agents/phase-3/phase-3.md',
  '.pakalon-agents/ai-agents/phase-3/auditor.md',
];

const REQUIRED_DIRECTORIES = [
  '.pakalon',
  '.pakalon-agents',
  '.pakalon-agents/ai-agents',
  '.pakalon-agents/ai-agents/phase-1',
  '.pakalon-agents/ai-agents/phase-2',
  '.pakalon-agents/ai-agents/phase-3',
  'src',
];

const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; severity: Finding['severity']; category: string; description: string }> = [
  { pattern: /\beval\s*\(/, severity: 'critical', category: 'security', description: 'Avoid eval() in production code.' },
  { pattern: /new Function\s*\(/, severity: 'critical', category: 'security', description: 'Avoid dynamic Function constructors.' },
  { pattern: /child_process['"`].*execSync|execSync\s*\(/, severity: 'high', category: 'security', description: 'Review synchronous shell execution usage.' },
  { pattern: /innerHTML\s*=|dangerouslySetInnerHTML/, severity: 'medium', category: 'security', description: 'Review untrusted HTML injection surfaces.' },
  { pattern: /TODO|FIXME/, severity: 'low', category: 'quality', description: 'Track unresolved implementation notes.' },
];

async function fileExists(projectDir: string, relative: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectDir, relative));
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(projectDir: string, relative: string): Promise<string> {
  try {
    return await fs.readFile(path.join(projectDir, relative), 'utf8');
  } catch {
    return '';
  }
}

function scoreFromFindings(findings: Finding[]): number {
  const weights: Record<Finding['severity'], number> = {
    critical: 28,
    high: 16,
    medium: 8,
    low: 3,
    info: 1,
  };

  const penalty = findings.reduce((sum, finding) => sum + weights[finding.severity], 0);
  return Math.max(0, 100 - penalty);
}

export async function collectAuditorArtifacts(projectDir: string): Promise<Map<string, string>> {
  const candidates = [
    '.pakalon/plan.md',
    '.pakalon/tasks.md',
    '.pakalon/spec.md',
    '.pakalon/phase-1.md',
    '.pakalon/phase-2.md',
    '.pakalon/phase-3.md',
    '.pakalon-agents/ai-agents/phase-1/phase-1.md',
    '.pakalon-agents/ai-agents/phase-2/phase-2.md',
    '.pakalon-agents/ai-agents/phase-3/phase-3.md',
    '.pakalon-agents/ai-agents/phase-3/auditor.md',
  ];

  const artifactText = new Map<string, string>();
  for (const relative of candidates) {
    artifactText.set(relative, await readTextIfExists(projectDir, relative));
  }
  return artifactText;
}

export async function runRequirementChecks(ctx: RequirementCheckContext): Promise<Finding[]> {
  const tree = ctx.tree ?? collectProjectTree(ctx.projectDir, 1500);
  const findings: Finding[] = [];

  for (const relative of REQUIRED_DIRECTORIES) {
    if (!tree.some((file) => file === `${relative}/` || file.startsWith(`${relative}/`))) {
      findings.push({
        severity: 'high',
        category: 'structure',
        description: `Missing required directory: ${relative}`,
        file: relative,
        requirement: `Directory ${relative} must exist`,
        status: 'open',
      });
    }
  }

  for (const relative of REQUIRED_PHASE1_FILES) {
    const content = await readTextIfExists(ctx.projectDir, relative);
    if (!content.trim()) {
      findings.push({
        severity: 'critical',
        category: 'phase-1',
        description: `Phase 1 artifact missing or empty: ${relative}`,
        file: relative,
        requirement: 'All Phase 1 files must exist and have content',
        status: 'open',
      });
    }
  }

  for (const relative of REQUIRED_PHASE2_FILES) {
    if (!(await fileExists(ctx.projectDir, relative))) {
      findings.push({
        severity: 'high',
        category: 'phase-2',
        description: `Phase 2 artifact missing: ${relative}`,
        file: relative,
        requirement: 'Phase 2 wireframes must exist',
        status: 'open',
      });
    }
  }

  for (const relative of REQUIRED_PHASE3_FILES) {
    if (!(await fileExists(ctx.projectDir, relative))) {
      findings.push({
        severity: 'medium',
        category: 'phase-3',
        description: `Phase 3 artifact missing: ${relative}`,
        file: relative,
        requirement: 'Phase 3 implementation artifacts must exist',
        status: 'open',
      });
    }
  }

  const plan = await readTextIfExists(ctx.projectDir, '.pakalon/plan.md');
  const tasks = await readTextIfExists(ctx.projectDir, '.pakalon/tasks.md');
  const phase3 = await readTextIfExists(ctx.projectDir, '.pakalon-agents/ai-agents/phase-3/phase-3.md');

  if (plan && tasks && phase3) {
    const requirements = [
      ['frontend', /frontend|ui|next\.js|react/i],
      ['backend', /backend|api|express|fastify|rest/i],
      ['database', /database|postgres|schema|migration/i],
      ['integration', /integration|end-to-end|e2e|testing/i],
    ] as const;

    for (const [name, pattern] of requirements) {
      if (!pattern.test(plan) && !pattern.test(tasks)) {
        findings.push({
          severity: 'low',
          category: 'coverage',
          description: `Plan/tasks do not explicitly mention ${name} coverage.`,
          requirement: 'Phase 3 code should follow the plan',
          status: 'open',
        });
      }
    }
  }

  const treeText = tree.join('\n');
  if (!/package\.json/i.test(treeText)) {
    findings.push({
      severity: 'critical',
      category: 'project',
      description: 'package.json was not detected in the scanned tree.',
      requirement: 'Required files/directories must exist',
      status: 'open',
    });
  }

  if (!/src\//i.test(treeText)) {
    findings.push({
      severity: 'high',
      category: 'project',
      description: 'src/ directory was not detected in the scanned tree.',
      requirement: 'Required files/directories must exist',
      status: 'open',
    });
  }

  const codeFiles = tree.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of codeFiles.slice(0, 200)) {
    const content = await readTextIfExists(ctx.projectDir, file);
    if (!content) continue;

    for (const rule of SUSPICIOUS_PATTERNS) {
      if (rule.pattern.test(content)) {
        findings.push({
          severity: rule.severity,
          category: rule.category,
          description: rule.description,
          file,
          requirement: 'Security patterns should be followed',
          status: 'open',
        });
      }
    }
  }

  return findings;
}

export function calculateComplianceScore(findings: Finding[]): number {
  return scoreFromFindings(findings);
}

export function summarizeFindings(findings: Finding[]): string {
  return findings
    .map((finding) => `- [${finding.severity.toUpperCase()}] ${finding.category}: ${finding.description}${finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ''})` : ''}`)
    .join('\n');
}
