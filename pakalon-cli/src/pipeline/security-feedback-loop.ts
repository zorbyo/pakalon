import * as fs from "fs/promises";
import * as path from "path";
import { Phase4Agent, type SecurityFinding as Phase4Finding } from "@/agents/phase4/index.js";
import type { AgentContext } from "@/agents/types.js";

export interface SecurityFeedbackConfig {
  projectDir: string;
  maxIterations?: number;
  severityThreshold: "critical" | "high" | "medium";
  onIteration?: (iteration: number, issues: Finding[]) => void;
}

export interface SecurityFeedbackResult {
  success: boolean;
  iterations: number;
  finalIssues: Finding[];
  patchesApplied: string[];
  codeChanges: Map<string, string>;
}

export type Finding = Phase4Finding;

type Severity = Finding["severity"];

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
  INFO: 0,
};

function normalizeThreshold(value: SecurityFeedbackConfig["severityThreshold"]): Severity {
  return value.toUpperCase() as Severity;
}

function isActionable(finding: Finding, threshold: Severity): boolean {
  return SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[threshold];
}

function createPhase4Agent(projectDir: string): Phase4Agent {
  const context: AgentContext = {
    agentId: `phase4-feedback-${Date.now()}`,
    agentName: "phase4-feedback",
    agentType: "phase-4-security-feedback",
    permissionMode: "auto",
    tools: [],
    disallowedTools: [],
    background: false,
    projectDir,
    userPrompt: "Security feedback loop",
    isYolo: true,
  };

  return new Phase4Agent(context);
}

function mergeCodeChange(codeChanges: Map<string, string>, filePath: string, content: string): void {
  codeChanges.set(filePath, content);
}

function envKeyFromIdentifier(identifier: string): string {
  return identifier
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function readLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function lineAt(content: string, line?: number): string | undefined {
  if (!line || line < 1) return undefined;
  return readLines(content)[line - 1];
}

function patchHardcodedSecret(content: string, finding: Finding): { content: string; applied: boolean; description?: string } {
  const line = lineAt(content, finding.line);
  if (!line) return { content, applied: false };

  const match = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]{8,})\3\s*;?\s*$/);
  if (!match) return { content, applied: false };

  const indent = match[1] ?? "";
  const identifier = match[2] ?? "";
  const literal = match[4] ?? "";
  if (!identifier) return { content, applied: false };
  if (!/key|secret|token|password|passwd|credential|api/i.test(identifier) && literal.length < 16) {
    return { content, applied: false };
  }

  const envKey = envKeyFromIdentifier(identifier);
  const replacement = `${indent}const ${identifier} = process.env.${envKey} ?? \"\";`;
  const next = readLines(content);
  next[(finding.line ?? 1) - 1] = replacement;
  return {
    content: next.join("\n"),
    applied: true,
    description: `${finding.file}: moved hardcoded secret ${identifier} to process.env.${envKey}`,
  };
}

function patchEvalUsage(content: string, finding: Finding): { content: string; applied: boolean; description?: string } {
  const line = lineAt(content, finding.line);
  if (!line) return { content, applied: false };

  const match = line.match(/^(\s*.*)eval\s*\((.+)\)(.*)$/);
  if (!match) return { content, applied: false };

  const prefix = match[1] ?? "";
  const expr = (match[2] ?? "").trim();
  const suffix = match[3] ?? "";
  const safeExpr = expr;
  if (/[^\w.$\[\]"'\s,+-]/.test(safeExpr) && !/^\w+$/.test(safeExpr)) {
    return { content, applied: false };
  }

  const replacementLine = `${prefix}JSON.parse(${safeExpr})${suffix}`;
  const next = readLines(content);
  next[(finding.line ?? 1) - 1] = replacementLine;
  return {
    content: next.join("\n"),
    applied: true,
    description: `${finding.file}: replaced eval() with JSON.parse()`
  };
}

function patchXss(content: string, finding: Finding): { content: string; applied: boolean; description?: string } {
  const line = lineAt(content, finding.line);
  if (!line) return { content, applied: false };

  if (!/\.innerHTML\s*=/.test(line)) return { content, applied: false };
  const nextLine = line.replace(/\.innerHTML\s*=/, ".textContent =");
  const next = readLines(content);
  next[(finding.line ?? 1) - 1] = nextLine;
  return {
    content: next.join("\n"),
    applied: true,
    description: `${finding.file}: replaced innerHTML assignment with textContent`,
  };
}

function patchSqlInjection(content: string, finding: Finding): { content: string; applied: boolean; description?: string } {
  const line = lineAt(content, finding.line);
  if (!line) return { content, applied: false };

  const templateMatch = line.match(/\b(query|execute|raw)\s*\(\s*`([^`]*?)\$\{([^}]+)\}([^`]*)`\s*\)/);
  if (templateMatch) {
    const fn = templateMatch[1] ?? "query";
    const before = templateMatch[2] ?? "";
    const expr = templateMatch[3] ?? "";
    const after = templateMatch[4] ?? "";
    const sql = `${before}?${after}`.replace(/`/g, "\\`").replace(/"/g, '\\"');
    const replacement = `${fn}("${sql}", [${expr.trim()}])`;
    const next = readLines(content);
    next[(finding.line ?? 1) - 1] = line.replace(templateMatch[0], replacement);
    return {
      content: next.join("\n"),
      applied: true,
      description: `${finding.file}: parameterized SQL query`,
    };
  }

  const concatMatch = line.match(/\b(query|execute|raw)\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\+\s*([^)]*)\)/);
  if (concatMatch) {
    const fn = concatMatch[1] ?? "query";
    const singleBefore = concatMatch[2] ?? "";
    const doubleBefore = concatMatch[3] ?? "";
    const expr = concatMatch[4] ?? "";
    const sql = (singleBefore ?? doubleBefore ?? "") + "?";
    const replacement = `${fn}("${sql.replace(/"/g, '\\"')}", [${expr.trim()}])`;
    const next = readLines(content);
    next[(finding.line ?? 1) - 1] = line.replace(concatMatch[0], replacement);
    return {
      content: next.join("\n"),
      applied: true,
      description: `${finding.file}: parameterized concatenated SQL query`,
    };
  }

  return { content, applied: false };
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  const existing = await readFileIfExists(filePath);
  if (existing === content) return;
  await fs.writeFile(filePath, content, "utf8");
}

function resolvePackageVersion(lockData: unknown, packageName: string): string | undefined {
  if (!lockData || typeof lockData !== "object") return undefined;
  const root = lockData as {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string; requires?: Record<string, string> }>;
  };

  const pkgPath = `node_modules/${packageName}`;
  const packageVersion = root.packages?.[pkgPath]?.version;
  if (packageVersion) return packageVersion;
  const depVersion = root.dependencies?.[packageName]?.version;
  if (depVersion) return depVersion;
  return undefined;
}

async function patchInsecureDependencies(projectDir: string, codeChanges: Map<string, string>): Promise<string[]> {
  const packageJsonPath = path.join(projectDir, "package.json");
  const lockPath = path.join(projectDir, "package-lock.json");
  const packageJsonRaw = await readFileIfExists(packageJsonPath);
  if (!packageJsonRaw) return [];

  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    packageJson = JSON.parse(packageJsonRaw) as typeof packageJson;
  } catch {
    return [];
  }

  const lockRaw = await readFileIfExists(lockPath);
  let lockData: unknown = null;
  if (lockRaw) {
    try {
      lockData = JSON.parse(lockRaw);
    } catch {
      lockData = null;
    }
  }

  const changed: string[] = [];
  const next = structuredClone(packageJson) as typeof packageJson;

  const updateDeps = (deps?: Record<string, string>) => {
    if (!deps) return;
    for (const [name, version] of Object.entries(deps)) {
      if (version !== "*" && version.toLowerCase() !== "latest") continue;
      const resolved = resolvePackageVersion(lockData, name);
      if (!resolved) continue;
      deps[name] = resolved;
      changed.push(`package.json: pinned ${name} from ${version} to ${resolved}`);
    }
  };

  updateDeps(next.dependencies);
  updateDeps(next.devDependencies);

  if (changed.length > 0) {
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    await writeIfChanged(packageJsonPath, serialized);
    mergeCodeChange(codeChanges, packageJsonPath, serialized);
  }

  return changed;
}

export class SecurityFeedbackLoop {
  constructor(private readonly config: SecurityFeedbackConfig) {}

  public async run(): Promise<SecurityFeedbackResult> {
    const projectDir = path.resolve(this.config.projectDir);
    const maxIterations = this.config.maxIterations ?? 3;
    const threshold = normalizeThreshold(this.config.severityThreshold);
    const patchesApplied: string[] = [];
    const codeChanges = new Map<string, string>();
    let finalIssues: Finding[] = [];
    let success = false;
    let iterationsRun = 0;

    const agent = createPhase4Agent(projectDir);

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      iterationsRun = iteration;
      agent.setIteration(iteration);
      const findings = await agent.getStructuredFindings();
      finalIssues = findings;
      this.config.onIteration?.(iteration, findings);

      const actionable = findings.filter((finding) => isActionable(finding, threshold));
      if (actionable.length === 0) {
        success = true;
        break;
      }

  const patchResult = await agent.applyPatches(actionable);
      for (const patch of patchResult.patchesApplied) patchesApplied.push(patch);
      for (const [file, content] of patchResult.codeChanges.entries()) {
        mergeCodeChange(codeChanges, file, content);
      }

      const dependencyPatches = await patchInsecureDependencies(projectDir, codeChanges);
      patchesApplied.push(...dependencyPatches);

      if (patchResult.patchesApplied.length === 0 && dependencyPatches.length === 0) {
        break;
      }
    }

    if (finalIssues.length === 0) {
      const current = await agent.getStructuredFindings();
      finalIssues = current;
      success = current.filter((finding) => isActionable(finding, threshold)).length === 0;
    } else {
      success = finalIssues.filter((finding) => isActionable(finding, threshold)).length === 0;
    }

    return {
      success,
      iterations: iterationsRun,
      finalIssues,
      patchesApplied,
      codeChanges,
    };
  }
}

export async function runSecurityFeedbackLoop(config: SecurityFeedbackConfig): Promise<SecurityFeedbackResult> {
  return new SecurityFeedbackLoop(config).run();
}
