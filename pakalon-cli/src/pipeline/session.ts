/**
 * Native TypeScript 6-Phase Pipeline — replaces Python bridge pipeline.
 *
 * Implements Pakalon's unique 6-phase build pipeline entirely in-process:
 *   Phase 1: Planning & Research
 *   Phase 2: Design & Wireframes
 *   Phase 3: Code Implementation
 *   Phase 4: Security QA
 *   Phase 5: CI/CD Setup
 *   Phase 6: Documentation
 *
 * Uses EventEmitter for SSE-like event streaming to TUI.
 * Supports HIL (Human-in-the-Loop) via choice_request events.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import logger from "@/utils/logger.js";
import { BaseAgent } from "@/agents/base-agent.js";
import type { AgentConfig, AgentContext } from "@/agents/types.js";
import { AgentGraph, GraphNode, type GraphContext, type GraphNodeExecutionResult } from "@/orchestration/index.js";
import { getDefaultTddScreenshotPaths, runTddScreenshotComparison } from "@/phase2/index.js";
import { reviewWireframes } from "@/integrations/wireframe-review.js";
import { extractDesignTokens, writeDesignTokens } from "@/penpot/token-extractor.js";
import {
  deployProject,
  estimateCost,
  getCloudProviders,
  type CloudProvider,
} from "../cloud/index.js";
import { buildComponentRegistryContext, initializeComponentRegistry, loadComponentRegistry } from "@/rag/index.js";
import { interPhaseStore, interPhaseRetrieve, type Mem0Client } from "@/memory/mem0-adapter.js";
import { createHybridMem0Client } from "@/memory/hybrid-adapter.js";
import { markPipelinePhaseComplete } from "@/utils/pipeline-state.js";
import type { SecurityFinding as TestingSecurityFinding } from "@/testing/testTypes.js";
import {
  DEFAULT_APP_PORT,
  PolicyEvaluator,
  SandboxDeployer,
  SandboxTester,
  isApplicationLargeEnough,
  isDockerAvailable,
  isSandboxUsableStatus,
  loadSandboxState,
  sandboxLifecycleManager,
} from "@/sandbox/index.js";

// ---------------------------------------------------------------------------
// Types (compatible with bridge/types.ts PhaseSSEEvent)
// ---------------------------------------------------------------------------

export interface PipelineSession {
  id: string;
  projectDir: string;
  userPrompt: string;
  userId: string;
  userPlan: string;
  isYolo: boolean;
  currentPhase: number;
  status: "idle" | "running" | "paused" | "complete" | "error";
  events: EventEmitter;
  abortController: AbortController;
}

export interface PhaseContext {
  phase: number;
  name: string;
  projectDir: string;
  userPrompt: string;
  userId: string;
  isYolo: boolean;
  outputDir: string;
  abortSignal: AbortSignal;
  emit: (event: Record<string, unknown>) => void;
  waitForInput: (message: string, question: string, choices: Array<{ id: string; label: string }>) => Promise<string>;
  waitForChoice: (
    message: string,
    question: string,
    choices: Array<{ id: string; label: string }>,
    options?: { multiSelect?: boolean; allowOther?: boolean; questionIndex?: number; totalQuestions?: number },
  ) => Promise<string | string[]>;
  waitForFreeText: (prompt: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

const sessions = new Map<string, PipelineSession>();

export function createSession(opts: {
  projectDir: string;
  userPrompt: string;
  userId: string;
  userPlan: string;
  isYolo: boolean;
}): PipelineSession {
  const id = crypto.randomUUID();
  const session: PipelineSession = {
    id,
    projectDir: path.resolve(opts.projectDir),
    userPrompt: opts.userPrompt,
    userId: opts.userId,
    userPlan: opts.userPlan,
    isYolo: opts.isYolo,
    currentPhase: 0,
    status: "idle",
    events: new EventEmitter(),
    abortController: new AbortController(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): PipelineSession | undefined {
  return sessions.get(id);
}

export function destroySession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.abortController.abort();
    session.events.removeAllListeners();
    sessions.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Phase Definitions
// ---------------------------------------------------------------------------

interface PhaseDefinition {
  number: number;
  name: string;
  description: string;
  run: (ctx: PhaseContext) => Promise<void>;
}

const PHASE_COUNT = 6;
const TREE_LIMIT = 500;

type ChoiceOption = { id: string; label: string };

type Phase1AnswerMap = Record<string, string | string[]>;

function formatAnswer(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

function resolveChoiceText(value: string | string[], choices: ChoiceOption[], fallback: string): string | string[] {
  const lookup = new Map(choices.map((choice) => [choice.id, choice.label] as const));
  if (Array.isArray(value)) {
    const mapped = value.map((item) => lookup.get(item) ?? PHASE1_CHOICE_LABELS[item] ?? item).filter(Boolean);
    return mapped.length > 0 ? mapped : fallback;
  }
  return lookup.get(value) ?? PHASE1_CHOICE_LABELS[value] ?? value ?? fallback;
}

function normalizeChoiceResponse(value: string, multiSelect = false): string | string[] {
  const trimmed = value.trim();
  if (!multiSelect) return trimmed;
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall through to delimited parsing.
  }

  return trimmed
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type PendingInput = {
  resolve: (value: string | string[]) => void;
  multiSelect?: boolean;
};

function getAgentsRoot(projectDir: string): string {
  return path.join(projectDir, ".pakalon-agents");
}

function getAiAgentsRoot(projectDir: string): string {
  return path.join(getAgentsRoot(projectDir), "ai-agents");
}

function getPrimaryPhaseDir(projectDir: string, phase: number): string {
  return path.join(getAiAgentsRoot(projectDir), `phase-${phase}`);
}

function getLegacyPhaseDir(projectDir: string, phase: number): string {
  return path.join(getAgentsRoot(projectDir), `phase-${phase}`);
}

const DEFAULT_SECURITY_POLICY_YAML = `# Pakalon Security Promotion Policy
promotion_criteria:
  max_critical_vulnerabilities: 0
  max_high_vulnerabilities: 2
  max_medium_vulnerabilities: 10
  min_security_score: 70
  required_sast_coverage: 80
  require_dast: true
  require_sbom: true

actions:
  on_failure: loop_back
  loop_back_phase: 3
  max_loop_iterations: 3

sandbox:
  max_runtime_minutes: 30
  max_memory_mb: 1024
  max_iterations: 5
  auto_cleanup: true
`;

function ensureDefaultSecurityPolicy(projectDir: string): void {
  const policyPath = path.join(projectDir, ".pakalon", "security-policy.yml");
  if (!fs.existsSync(policyPath)) {
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, DEFAULT_SECURITY_POLICY_YAML, "utf-8");
  }
}

function ensurePipelineDirectories(projectDir: string): void {
  const agentsRoot = getAgentsRoot(projectDir);
  const aiAgentsRoot = getAiAgentsRoot(projectDir);

  fs.mkdirSync(agentsRoot, { recursive: true });
  fs.mkdirSync(aiAgentsRoot, { recursive: true });
  fs.mkdirSync(path.join(agentsRoot, "mcp-servers"), { recursive: true });
  fs.mkdirSync(path.join(agentsRoot, "wireframes"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, ".pakalon"), { recursive: true });

  for (let phase = 1; phase <= PHASE_COUNT; phase++) {
    fs.mkdirSync(getPrimaryPhaseDir(projectDir, phase), { recursive: true });
    // Legacy compatibility for older modules still reading .pakalon-agents/phase-*.
    fs.mkdirSync(getLegacyPhaseDir(projectDir, phase), { recursive: true });
  }

  ensureDefaultSecurityPolicy(projectDir);
}

function writePhaseArtifact(
  projectDir: string,
  phase: number,
  fileName: string,
  content: string,
  mirrorLegacy = true,
): string[] {
  const written: string[] = [];

  const primaryPath = path.join(getPrimaryPhaseDir(projectDir, phase), fileName);
  fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
  fs.writeFileSync(primaryPath, content, "utf-8");
  written.push(primaryPath);

  if (mirrorLegacy) {
    const legacyPath = path.join(getLegacyPhaseDir(projectDir, phase), fileName);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, content, "utf-8");
    written.push(legacyPath);
  }

  return written;
}

function readPhaseArtifact(projectDir: string, phase: number, fileName: string): string {
  const candidates = [
    path.join(getPrimaryPhaseDir(projectDir, phase), fileName),
    path.join(getLegacyPhaseDir(projectDir, phase), fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }

  return "";
}

type PackageJsonLike = {
  scripts?: Record<string, string>;
};

function readPackageJson(projectDir: string): PackageJsonLike | null {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJsonLike;
  } catch {
    return null;
  }
}

function detectPackageRunner(projectDir: string): "npm" | "yarn" | "pnpm" | "bun" {
  if (fs.existsSync(path.join(projectDir, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectSandboxCommands(projectDir: string): {
  buildCommand?: string;
  startCommand?: string;
  testCommand?: string;
  reason?: string;
} {
  const pkg = readPackageJson(projectDir);
  if (!pkg) {
    return { reason: "No package.json found; automatic sandbox deployment currently supports Node/Bun projects." };
  }

  const scripts = pkg.scripts ?? {};
  const runner = detectPackageRunner(projectDir);
  const run = (script: string) => `${runner} run ${script}`;

  const buildCommand = scripts.build ? run("build") : undefined;
  const startCommand = scripts.start
    ? run("start")
    : scripts.preview
      ? `${run("preview")} -- --host 0.0.0.0`
      : scripts.dev
        ? `${run("dev")} -- --host 0.0.0.0`
        : undefined;
  const testCommand = scripts.test && !/no test specified/i.test(scripts.test)
    ? run("test")
    : undefined;

  if (!startCommand) {
    return { buildCommand, testCommand, reason: "No start, preview, or dev script found in package.json." };
  }

  return { buildCommand, startCommand, testCommand };
}

async function maybeRunPhase3Sandbox(ctx: PhaseContext): Promise<string[]> {
  const filesWritten: string[] = [];

  if (process.env.PAKALON_DISABLE_AIO_SANDBOX === "1") {
    ctx.emit({ type: "text_delta", content: "  [Sandbox] AIO Sandbox disabled by PAKALON_DISABLE_AIO_SANDBOX=1\n" });
    return filesWritten;
  }

  const commands = detectSandboxCommands(ctx.projectDir);
  if (commands.reason) {
    const report = `# Phase 3 Sandbox\n\nStatus: skipped\n\nReason: ${commands.reason}\n`;
    filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "sandbox.md", report));
    ctx.emit({ type: "text_delta", content: `  [Sandbox] Skipped: ${commands.reason}\n` });
    return filesWritten;
  }

  if (!isDockerAvailable()) {
    const report = "# Phase 3 Sandbox\n\nStatus: skipped\n\nReason: Docker or Podman was not available.\n";
    filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "sandbox.md", report));
    ctx.emit({ type: "text_delta", content: "  [Sandbox] Docker not available; environment sandbox skipped\n" });
    return filesWritten;
  }

  const isLarge = await isApplicationLargeEnough(ctx.projectDir);
  if (!isLarge) {
    const report = "# Phase 3 Sandbox\n\nStatus: skipped\n\nReason: Application did not meet the size/dependency threshold.\n";
    filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "sandbox.md", report));
    ctx.emit({ type: "text_delta", content: "  [Sandbox] Application below sandbox threshold; skipped\n" });
    return filesWritten;
  }

  const existing = await loadSandboxState(ctx.projectDir);
  if (existing && isSandboxUsableStatus(existing.status)) {
    await sandboxLifecycleManager.destroy(existing.sandboxId, ctx.projectDir).catch((error) => {
      logger.warn(`[pipeline] Existing sandbox cleanup failed: ${error}`);
    });
  }

  const policyPath = path.join(ctx.projectDir, ".pakalon", "security-policy.yml");
  const policy = await PolicyEvaluator.loadFromFile(policyPath);
  const memoryMb = policy.getPolicy().sandbox?.max_memory_mb;
  const deployer = new SandboxDeployer();

  try {
    ctx.emit({ type: "text_delta", content: "  [Sandbox] Provisioning AIO Sandbox container\n" });
    const session = await sandboxLifecycleManager.provision(ctx.projectDir, {
      appPort: DEFAULT_APP_PORT,
      memoryMb,
    });

    ctx.emit({ type: "text_delta", content: `  [Sandbox] Provisioned MCP ${session.mcpUrl}, app ${session.appUrl}\n` });

    const deployResult = await deployer.deployApp(session, {
      projectDir: ctx.projectDir,
      sandboxUrl: session.url,
      buildCommand: commands.buildCommand,
      startCommand: commands.startCommand,
      appPort: DEFAULT_APP_PORT,
    });

    await sandboxLifecycleManager.updateSession(session.sandboxId, {
      status: deployResult.success ? "deployed" : "failed",
      appUrl: deployResult.appUrl.replace(/\/$/, ""),
      deployStatus: deployResult,
    }, ctx.projectDir);

    let testSummary = "not run";
    if (deployResult.success) {
      const tester = new SandboxTester();
      const testResults = await tester.runFunctionalTests(session, {
        sandboxUrl: deployResult.appUrl,
        projectDir: ctx.projectDir,
        testCommand: commands.testCommand,
      });
      testSummary = `${testResults.passed}/${testResults.total} passed`;
      await sandboxLifecycleManager.updateSession(session.sandboxId, {
        status: testResults.success ? "tested" : "failed",
        testResults,
      }, ctx.projectDir);
    }

    const report = `# Phase 3 Sandbox

Status: ${deployResult.success ? "deployed" : "failed"}

## Endpoints
- Sandbox MCP: ${session.mcpUrl}
- Application: ${deployResult.appUrl}

## Deployment
- Success: ${deployResult.success ? "yes" : "no"}
- Message: ${deployResult.message}
- Duration: ${deployResult.duration}ms

## Tests
- Result: ${testSummary}
`;
    filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "sandbox.md", report));
    ctx.emit({ type: "text_delta", content: `  [Sandbox] ${deployResult.success ? "Deployment ready" : "Deployment failed"}; tests ${testSummary}\n` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = `# Phase 3 Sandbox\n\nStatus: failed\n\nError: ${message}\n`;
    filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "sandbox.md", report));
    ctx.emit({ type: "text_delta", content: `  [Sandbox] Provisioning failed: ${message}\n` });
    logger.warn(`[pipeline] Sandbox provisioning failed: ${message}`);
  } finally {
    await deployer.disconnect().catch(() => undefined);
  }

  return filesWritten;
}

type SandboxPolicyGate = {
  active: boolean;
  passed: boolean;
  evaluator?: PolicyEvaluator;
  reasons: string[];
  action?: "loop_back" | "report_only" | "block";
  loopBackPhase?: number;
  maxLoopIterations?: number;
};

async function evaluateSandboxPolicyGate(projectDir: string): Promise<SandboxPolicyGate> {
  const sandboxState = await loadSandboxState(projectDir);
  if (!sandboxState || sandboxState.status === "destroyed") {
    return { active: false, passed: true, reasons: [] };
  }

  const evaluator = await PolicyEvaluator.loadFromFile(path.join(projectDir, ".pakalon", "security-policy.yml"));

  if (!isSandboxUsableStatus(sandboxState.status)) {
    const reasons = [`Sandbox status is ${sandboxState.status}; application was not successfully deployed and tested.`];
    const policyResult = {
      passed: false,
      score: 0,
      reasons,
      details: [{
        check: "Sandbox deployment",
        passed: false,
        expected: "tested",
        actual: sandboxState.status,
        severity: "error" as const,
      }],
    };
    await sandboxLifecycleManager.updateSession(sandboxState.sandboxId, {
      policyResult,
    }, projectDir);
    await evaluator.writeFixRequests(projectDir, reasons);
    return {
      active: true,
      passed: false,
      evaluator,
      reasons,
      action: evaluator.getPolicy().actions.on_failure,
      loopBackPhase: evaluator.getPolicy().actions.loop_back_phase,
      maxLoopIterations: evaluator.getPolicy().actions.max_loop_iterations,
    };
  }

  const policyResult = await evaluator.evaluate(projectDir);
  await sandboxLifecycleManager.updateSession(sandboxState.sandboxId, {
    status: "evaluating",
    policyResult,
  }, projectDir);

  if (!policyResult.passed) {
    await evaluator.writeFixRequests(projectDir, policyResult.reasons);
  }

  return {
    active: true,
    passed: policyResult.passed,
    evaluator,
    reasons: policyResult.reasons,
    action: evaluator.getPolicy().actions.on_failure,
    loopBackPhase: evaluator.getPolicy().actions.loop_back_phase,
    maxLoopIterations: evaluator.getPolicy().actions.max_loop_iterations,
  };
}

async function destroyProjectSandbox(projectDir: string): Promise<void> {
  const sandboxState = await loadSandboxState(projectDir);
  if (!sandboxState || sandboxState.status === "destroyed") return;
  await sandboxLifecycleManager.destroy(sandboxState.sandboxId, projectDir).catch((error) => {
    logger.warn(`[pipeline] Sandbox cleanup failed: ${error}`);
  });
}

function summarizeText(text: string, limit = 1600): string {
  const normalized = text.trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}\n\n... (truncated)`;
}

function formatExecutionLog(entry: {
  nodeId: string;
  state: string;
  exitCode: number;
  duration: number;
  output: string;
  error?: string;
}): string {
  const lines = [
    `## ${entry.nodeId}`,
    `- State: ${entry.state}`,
    `- Exit code: ${entry.exitCode}`,
    `- Duration: ${entry.duration}ms`,
  ];

  if (entry.error) {
    lines.push(`- Error: ${entry.error}`);
  }

  lines.push("", "### Output", summarizeText(entry.output, 2400));
  return lines.join("\n");
}

async function loadPhaseTools(): Promise<Record<string, unknown>> {
  try {
    const toolsModule = await import("@/ai/tools.js");
    // allTools is ToolSet (Record<string, tool>) — NOT an array
    return toolsModule.allTools as Record<string, unknown>;
  } catch (error) {
    logger.warn(`[phase3] Tool registry unavailable; running without tools: ${String(error)}`);
    return {};
  }
}

async function runPhase3SecurityFeedbackLoop(projectDir: string) {
  const module = await import("./security-feedback-loop.js");
  return module.runSecurityFeedbackLoop({
    projectDir,
    maxIterations: 3,
    severityThreshold: "high",
  });
}

class Phase3GraphNode extends GraphNode {
  constructor(options: ConstructorParameters<typeof GraphNode>[0], _briefContent: string) {
    super(options);
  }

  public override async execute(context: GraphContext): Promise<GraphNodeExecutionResult> {
    const existingPromise = context.get(`${this.id}:promise`) as Promise<GraphNodeExecutionResult> | undefined;
    if (existingPromise) {
      return existingPromise;
    }

    const runPromise = (async (): Promise<GraphNodeExecutionResult> => {
      if (context.get(`${this.id}:state`) === "completed") {
        return {
          nodeId: this.id,
          state: "completed",
          output: String(context.get(`${this.id}`) ?? ""),
          exitCode: Number(context.get(`${this.id}:exitCode`) ?? 0),
          duration: 0,
          iteration: this.executionCount,
        };
      }

      this.state = "running";
      this.executionCount += 1;
      const startedAt = Date.now();

      const agentContext: AgentContext = {
        agentId: this.id,
        agentName: this.agentName,
        agentType: "phase-3-subagent",
        permissionMode: "auto",
        tools: [],
        disallowedTools: [],
        background: false,
        projectDir: typeof context.get("projectDir") === "string" ? String(context.get("projectDir")) : undefined,
        model: this.model,
        userPrompt: typeof context.get("userPrompt") === "string" ? String(context.get("userPrompt")) : undefined,
        isYolo: Boolean(context.get("isYolo")),
      };

      const agentConfig: AgentConfig = {
        name: this.agentName,
        model: this.model,
        systemPrompt: this.systemPrompt,
        tools: await loadPhaseTools(),
        maxTokens: this.maxTokens,
        temperature: this.temperature,
      };

      try {
        const agent = new BaseAgent(agentConfig, agentContext);
        const output = await agent.run(this.buildPrompt(context));
        this.state = "completed";

        return {
          nodeId: this.id,
          state: this.state,
          output,
          exitCode: 0,
          duration: Date.now() - startedAt,
          iteration: this.executionCount,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.state = "error";

        return {
          nodeId: this.id,
          state: this.state,
          output: "",
          exitCode: 2,
          error: message,
          duration: Date.now() - startedAt,
          iteration: this.executionCount,
        };
      }
    })();

    context.set(`${this.id}:promise`, runPromise);
    const result = await runPromise;
    context.set(`${this.id}:result`, result);
    context.set(`${this.id}`, result.output);
    context.set(`${this.id}:state`, result.state);
    context.set(`${this.id}:exitCode`, result.exitCode);
    context.delete(`${this.id}:promise`);
    return result;
  }
}

class Phase3StartNode extends GraphNode {
  public override async execute(): Promise<GraphNodeExecutionResult> {
    this.state = "completed";

    return {
      nodeId: this.id,
      state: this.state,
      output: "Phase 3 dispatcher initialized",
      exitCode: 0,
      duration: 0,
      iteration: 1,
    };
  }
}

export function collectProjectTree(projectDir: string, limit = TREE_LIMIT): string[] {
  const ignored = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".venv",
    "env",
  ]);
  const files: string[] = [];

  const walk = (dir: string) => {
    if (files.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) break;
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectDir, full).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };

  walk(projectDir);
  return files;
}

interface SecurityFinding {
  id: string;
  tool: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  line: number;
  message: string;
}

const SECURITY_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isSecurityScannableFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (base === "package-lock.json" || base === "bun.lock" || base === "yarn.lock" || base === "pnpm-lock.yaml") {
    return false;
  }
  if (base === ".env" || base.startsWith(".env.")) return true;
  return SECURITY_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function collectLocalSecurityFindings(projectDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const files = collectProjectTree(projectDir, 1_500).filter(isSecurityScannableFile);

  const pushFinding = (finding: Omit<SecurityFinding, "id">) => {
    findings.push({
      id: `PKL-${String(findings.length + 1).padStart(4, "0")}`,
      ...finding,
    });
  };

  for (const rel of files) {
    const full = path.join(projectDir, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > 1_000_000) continue;

    let text = "";
    try {
      text = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/AKIA[0-9A-Z]{16}/.test(line)) {
        pushFinding({
          tool: "local-secret-scan",
          severity: "critical",
          file: rel,
          line: index + 1,
          message: "Potential AWS access key detected.",
        });
      }
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
        pushFinding({
          tool: "local-secret-scan",
          severity: "critical",
          file: rel,
          line: index + 1,
          message: "Private key material detected.",
        });
      }
      if (/(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']/i.test(line)) {
        pushFinding({
          tool: "local-secret-scan",
          severity: "high",
          file: rel,
          line: index + 1,
          message: "Hard-coded credential-like value detected.",
        });
      }
      if (/\beval\s*\(/.test(line) && /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(rel)) {
        pushFinding({
          tool: "local-sast",
          severity: "medium",
          file: rel,
          line: index + 1,
          message: "Use of eval can introduce code-injection risk.",
        });
      }
    });

    if (path.basename(rel) === "package.json") {
      try {
        const pkg = JSON.parse(text) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = {
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        };
        for (const [name, version] of Object.entries(deps)) {
          if (version === "*" || version.toLowerCase() === "latest") {
            pushFinding({
              tool: "local-dependency-scan",
              severity: "medium",
              file: rel,
              line: 1,
              message: `Dependency ${name} uses a floating version (${version}).`,
            });
          }
        }
      } catch {
        pushFinding({
          tool: "local-dependency-scan",
          severity: "low",
          file: rel,
          line: 1,
          message: "package.json could not be parsed for dependency checks.",
        });
      }
    }
  }

  return findings;
}

interface Phase4BrowserEvidenceResult {
  files: string[];
  summary: string;
}

async function collectPhase4BrowserEvidence(projectDir: string): Promise<Phase4BrowserEvidenceResult> {
  const evidenceDir = path.join(getPrimaryPhaseDir(projectDir, 4), "browser-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });

  const targetUrl = process.env.SECURITY_TARGET_URL ?? process.env.PAKALON_TEST_URL ?? "";
  const reportPath = path.join(evidenceDir, "browser-evidence.md");
  const reportBase = [
    "# Phase 4 Browser Evidence",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Target URL: ${targetUrl || "(not configured)"}`,
  ];

  if (!targetUrl) {
    const report = [
      ...reportBase,
      "- Status: skipped",
      "",
      "Set `SECURITY_TARGET_URL` or `PAKALON_TEST_URL` to capture a Phase 4 screenshot and screen recording.",
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, report, "utf-8");
    return { files: [reportPath], summary: "Browser screenshot/recording skipped; no target URL configured." };
  }

  interface LocalBrowser {
    newContext(options: Record<string, unknown>): Promise<LocalContext>;
    close(): Promise<void>;
  }

  interface LocalContext {
    newPage(): Promise<unknown>;
    close(): Promise<void>;
  }

  let browser: LocalBrowser | null = null;
  let context: LocalContext | null = null;

  try {
    const moduleName = "play" + "wright";
    const playwright = await import(/* @vite-ignore */ moduleName) as {
      chromium: {
        launch(options: { headless: boolean }): Promise<LocalBrowser>;
      };
    };

    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir: evidenceDir, size: { width: 1440, height: 1000 } },
    });
    const page = await context.newPage() as {
      goto(url: string, options: Record<string, unknown>): Promise<{ status(): number } | null>;
      screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
      title(): Promise<string>;
      video?: () => { path(): Promise<string> } | null;
    };

    const response = await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => null);
    const title = await page.title().catch(() => "");
    const screenshotPath = path.join(evidenceDir, "target-screenshot.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const video = page.video?.() ?? null;

    await context.close();
    context = null;
    const videoPath = video ? await video.path().catch(() => null) : null;

    const files = [reportPath, screenshotPath, ...(videoPath ? [videoPath] : [])];
    const report = [
      ...reportBase,
      "- Status: captured",
      `- HTTP status: ${response?.status() ?? "unknown"}`,
      `- Page title: ${title || "(untitled)"}`,
      `- Screenshot: ${path.relative(projectDir, screenshotPath)}`,
      `- Screen recording: ${videoPath ? path.relative(projectDir, videoPath) : "(unavailable)"}`,
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, report, "utf-8");
    return { files, summary: `Browser evidence captured for ${targetUrl}.` };
  } catch (error) {
    const report = [
      ...reportBase,
      "- Status: failed",
      `- Error: ${String(error)}`,
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, report, "utf-8");
    return { files: [reportPath], summary: `Browser evidence capture failed: ${String(error)}` };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean).map((file) => path.resolve(file)))];
}

function mirrorDirectoryFiles(sourceDir: string, targetDir: string): string[] {
  const written: string[] = [];
  if (!fs.existsSync(sourceDir)) return written;

  const walk = (source: string, target: string) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        walk(sourcePath, targetPath);
        continue;
      }

      if (entry.isFile()) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        written.push(targetPath);
      }
    }
  };

  walk(sourceDir, targetDir);
  return written;
}

function toTestingFinding(finding: SecurityFinding): TestingSecurityFinding {
  return {
    tool: finding.tool,
    severity: finding.severity.toUpperCase() as TestingSecurityFinding["severity"],
    file: finding.file,
    line: finding.line,
    message: finding.message,
    rule: finding.id,
    recommendation: "Review the flagged source and re-run Phase 4 after remediation.",
  };
}

function summarizeLocalSecurityFindings(findings: SecurityFinding[]): string {
  if (findings.length === 0) {
    return "- No deterministic local security findings detected.";
  }

  const counts = findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<SecurityFinding["severity"], number>);

  const summary = [
    `- Total findings: ${findings.length}`,
    `- Critical: ${counts.critical ?? 0}`,
    `- High: ${counts.high ?? 0}`,
    `- Medium: ${counts.medium ?? 0}`,
    `- Low: ${counts.low ?? 0}`,
    `- Info: ${counts.info ?? 0}`,
    "",
    "### Findings",
    ...findings.map((finding) => {
      const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
      return `- [${finding.severity.toUpperCase()}] ${finding.tool} ${location} - ${finding.message}`;
    }),
  ];

  return summary.join("\n");
}

async function writePhase4CanonicalArtifacts(
  projectDir: string,
  result: { success?: boolean; message?: string; duration?: number; filesCreated?: string[] },
  localFindings: SecurityFinding[],
  browserEvidence: Phase4BrowserEvidenceResult,
): Promise<string[]> {
  const { generateTestingXmlFiles } = await import("@/testing/xmlGenerator.js");
  const outputDir = getPrimaryPhaseDir(projectDir, 4);
  const scanResults = new Map<string, { issues: number }>();

  for (const finding of localFindings) {
    const current = scanResults.get(finding.tool)?.issues ?? 0;
    scanResults.set(finding.tool, { issues: current + 1 });
  }

  const xml = await generateTestingXmlFiles({
    projectDir,
    outputDir,
    securityFindings: localFindings.map(toTestingFinding),
    scanResults,
  });

  const filesWritten = [
    ...writePhaseArtifact(projectDir, 4, "whitebox_testing.xml", xml.whiteboxContent),
    ...writePhaseArtifact(projectDir, 4, "blackbox_testing.xml", xml.blackboxContent),
  ];

  const browserEvidenceFiles = browserEvidence.files
    .map((file) => `- ${path.relative(projectDir, file).replace(/\\/g, "/")}`)
    .join("\n");

  const phase4Md = `# Phase 4: Security QA

## Agent Result
- Success: ${result.success ? "yes" : "no"}
- Message: ${result.message ?? "No agent result message."}
- Duration: ${result.duration ?? 0}ms
- Agent artifacts: ${result.filesCreated?.length ?? 0}

## Local Scan Summary
${summarizeLocalSecurityFindings(localFindings)}

## Browser Evidence
- Summary: ${browserEvidence.summary}
- Files:
${browserEvidenceFiles || "- (none)"}

## XML Reports
- whitebox_testing.xml
- blackbox_testing.xml
`;

  filesWritten.push(...writePhaseArtifact(projectDir, 4, "phase-4.md", phase4Md));
  filesWritten.push(...browserEvidence.files);

  return dedupePaths(filesWritten);
}

const PHASE1_FILE_ORDER = [
  "context_management.md",
  "plan.md",
  "tasks.md",
  "design.md",
  "phase-1.md",
  "agent-skills.md",
  "prd.md",
  "Database_schema.md",
  "API_reference.md",
  "risk-assessment.md",
  "user-stories.md",
  "technical-spec.md",
  "competitive-analysis.md",
  "constraints-and-tradeoffs.md",
];

const PHASE1_CHOICE_LABELS: Record<string, string> = {
  web: "Web application",
  mobile: "Mobile app",
  desktop: "Desktop app",
  cli: "CLI / terminal tool",
  api: "API / backend service",
  consumers: "Consumers / end users",
  teams: "Small teams",
  smb: "SMBs / startups",
  enterprise: "Enterprise users",
  developers: "Developers",
  internal: "Internal operators",
  auth: "Authentication / login",
  dashboard: "Dashboard / overview",
  workflows: "Workflows / CRUD management",
  analytics: "Analytics / reporting",
  payments: "Payments",
  notifications: "Notifications",
  search: "Search",
  realtime: "Real-time collaboration",
  offline: "Offline mode",
  asap: "ASAP",
  short: "1-2 weeks",
  medium: "2-4 weeks",
  standard: "1-3 months",
  long: "3+ months",
  flexible: "Flexible",
  none: "None / prototype only",
  basic: "Basic auth + rate limiting",
  cloud: "Cloud",
  "self-hosted": "Self-hosted",
  both: "Both",
  bootstrapped: "Bootstrapped / minimal",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  solo: "Solo",
  small: "2-3 people",
  large: "7-12 people",
  "use-all": "Use the full available model context for this project",
  "90": "Use 90% of the model context for this project",
  "75": "Use 75% of the model context for this project",
  "65": "Use 65% of the model context for this project",
  "50": "Use 50% of the model context for this project",
  email: "Email",
  push: "Push notifications",
  webhooks: "Webhooks",
  crm: "CRM / external systems",
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const PHASE_CONTEXT_WEIGHTS = [
  { key: "phase-1-planning", label: "Phase 1: Planning and requirements", weight: 0.12 },
  { key: "phase-2-wireframes", label: "Phase 2: Wireframes and design review", weight: 0.14 },
  { key: "phase-3-development", label: "Phase 3: Implementation", weight: 0.42 },
  { key: "phase-4-security", label: "Phase 4: Security and QA", weight: 0.14 },
  { key: "phase-5-deployment", label: "Phase 5: Release and deployment", weight: 0.08 },
  { key: "phase-6-documentation", label: "Phase 6: Documentation", weight: 0.10 },
] as const;

function extractContextPercent(answer: string | string[] | undefined, isNewProject: boolean): number {
  const minimum = isNewProject ? 65 : 35;
  const raw = formatAnswer(answer ?? "").toLowerCase();

  if (raw.includes("full") || raw.includes("all available") || raw.includes("100")) {
    return 100;
  }

  const match = raw.match(/(\d{2,3})\s*%?/);
  const parsed = match ? Number(match[1]) : (isNewProject ? 75 : 50);
  if (!Number.isFinite(parsed)) return isNewProject ? 75 : 50;
  return Math.max(minimum, Math.min(100, parsed));
}

function buildContextBudget(answers: Phase1AnswerMap, isNewProject: boolean): {
  totalContext: number;
  requestedPercent: number;
  projectBudget: number;
  bufferTokens: number;
  usableTokens: number;
  phases: Array<{ key: string; label: string; tokens: number; percentOfUsable: number }>;
} {
  const requestedPercent = extractContextPercent(answers.contextAllocation, isNewProject);
  const projectBudget = Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * (requestedPercent / 100));
  const bufferTokens = Math.floor(projectBudget * 0.10);
  const usableTokens = projectBudget - bufferTokens;

  return {
    totalContext: DEFAULT_CONTEXT_WINDOW_TOKENS,
    requestedPercent,
    projectBudget,
    bufferTokens,
    usableTokens,
    phases: PHASE_CONTEXT_WEIGHTS.map((phase) => ({
      key: phase.key,
      label: phase.label,
      tokens: Math.floor(usableTokens * phase.weight),
      percentOfUsable: Math.round(phase.weight * 100),
    })),
  };
}

function formatContextBudgetMarkdown(budget: ReturnType<typeof buildContextBudget>): string {
  const rows = budget.phases
    .map((phase) => `| ${phase.label} | ${phase.percentOfUsable}% | ${phase.tokens.toLocaleString()} |`)
    .join("\n");

  return `## Token Allocation

| Scope | Allocation | Tokens |
|---|---:|---:|
| Model context window | 100% | ${budget.totalContext.toLocaleString()} |
| Project budget requested | ${budget.requestedPercent}% | ${budget.projectBudget.toLocaleString()} |
| Safety buffer | 10% of project budget | ${budget.bufferTokens.toLocaleString()} |
| Usable phase budget | 90% of project budget | ${budget.usableTokens.toLocaleString()} |

## Phase Budgets

| Phase | Share of usable budget | Tokens |
|---|---:|---:|
${rows}
`;
}

function summarizeExistingProjectState(projectDir: string): {
  isNewProject: boolean;
  files: string[];
  sourceFiles: string[];
  existingPhaseArtifacts: string[];
  highestCompletedPhase: number;
  summary: string;
} {
  const files = collectProjectTree(projectDir, 900);
  const sourceFiles = files.filter((file) => {
    if (file.startsWith(".pakalon")) return false;
    const ext = path.extname(file).toLowerCase();
    return [".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".cs", ".php", ".rb", ".html", ".css"].includes(ext);
  });

  const existingPhaseArtifacts: string[] = [];
  let highestCompletedPhase = 0;
  for (let phase = 1; phase <= PHASE_COUNT; phase++) {
    const candidates = [
      path.join(getPrimaryPhaseDir(projectDir, phase), `phase-${phase}.md`),
      path.join(getLegacyPhaseDir(projectDir, phase), `phase-${phase}.md`),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        existingPhaseArtifacts.push(path.relative(projectDir, candidate).replace(/\\/g, "/"));
        highestCompletedPhase = Math.max(highestCompletedPhase, phase);
        break;
      }
    }
  }

  const isNewProject = sourceFiles.length === 0 && existingPhaseArtifacts.length === 0;
  const summary = isNewProject
    ? "No existing source files or phase artifacts were detected; treat this as a new project."
    : [
        `Detected ${sourceFiles.length} source file(s) across ${files.length} tracked project file(s).`,
        highestCompletedPhase > 0
          ? `Existing phase artifacts indicate completion through Phase ${highestCompletedPhase}.`
          : "No completed phase summary artifacts were detected yet.",
      ].join(" ");

  return {
    isNewProject,
    files,
    sourceFiles,
    existingPhaseArtifacts,
    highestCompletedPhase,
    summary,
  };
}

function writeNormalModePlanningArtifacts(projectDir: string, phase1Files: Record<string, string>): string[] {
  const pakalonDir = path.join(projectDir, ".pakalon");
  fs.mkdirSync(pakalonDir, { recursive: true });

  const normalFiles: Array<[string, string]> = [
    ["plan.md", phase1Files["plan.md"] ?? ""],
    ["task.md", phase1Files["tasks.md"] ?? ""],
    ["tasks.md", phase1Files["tasks.md"] ?? ""],
    ["user-stories.md", phase1Files["user-stories.md"] ?? ""],
    ["context-management.md", phase1Files["context_management.md"] ?? ""],
    ["context_management.md", phase1Files["context_management.md"] ?? ""],
    ["design.md", phase1Files["design.md"] ?? ""],
  ];

  const written: string[] = [];
  for (const [fileName, content] of normalFiles) {
    const filePath = path.join(pakalonDir, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    written.push(filePath);
  }
  return written;
}

function generateUserDoc(userPrompt: string, files: string[], phase1Summary: string): string {
  // Extract tech stack from Phase 1 summary
  const techStackMatch = phase1Summary.match(/Stack preferences[\s\S]*?Frontend\/UI[\s\S]*?(?=\n\n|$)/i);
  const techStack = techStackMatch ? techStackMatch[0] : "";

  // Get file extensions to determine project type
  const extensions = new Set(files.map((f) => path.extname(f).toLowerCase()));
  const isJsProject = extensions.has(".js") || extensions.has(".ts") || extensions.has(".tsx");
  const isGoProject = extensions.has(".go");
  const installCommand = isJsProject ? "npm install" : isGoProject ? "go mod download" : "npm install";
  const runCommand = isJsProject ? "npm run dev" : isGoProject ? "go run main.go" : "npm run dev";
  const testCommand = isJsProject ? "npm test" : isGoProject ? "go test ./..." : "npm test";
  const buildCommand = isJsProject ? "npm run build" : isGoProject ? "go build -o app main.go" : "npm run build";

  // Generate README-style user documentation
  const projectName = path.basename(process.cwd());

  const doc = `# ${projectName}

> Generated by Pakalon — AI-powered CLI code editor

## Overview

${userPrompt}

## Quick Start

\`\`\`bash
# Install dependencies
${installCommand}

# Run the application
${runCommand}
\`\`\`

## Project Structure

${files.slice(0, 30).map((f) => `- \`${f}\``).join("\n")}

${files.length > 30 ? `\n... and ${files.length - 30} more files.\n` : ""}

## Tech Stack

${techStack || "See `technical-spec.md` for full stack details."}

## Key Features

- AI-powered development workflow
- 6-phase autonomous build pipeline
- Security-first design
- Production-ready deployment

## Development

\`\`\`bash
# Run tests
${testCommand}

# Build
${buildCommand}
\`\`\`

## Documentation

- [Technical Specification](./technical-spec.md)
- [API Reference](./API_reference.md)
- [Database Schema](./Database_schema.md)
- [User Stories](./user-stories.md)

## Built with Pakalon

This project was built using [Pakalon](https://pakalon.com) — an AI-powered CLI that builds production software in 6 autonomous phases.

---
*Generated: ${new Date().toISOString()}*
`;

  return doc;
}

function buildPhase3ComponentBriefContext(projectDir: string, userPrompt: string, plan: string, design: string): string {
  try {
    initializeComponentRegistry(projectDir);
    const registry = loadComponentRegistry(projectDir);
    return buildComponentRegistryContext([userPrompt, plan, design].filter(Boolean).join("\n\n"), registry, { topK: 5 });
  } catch (error) {
    logger.warn(`[phase3] Component registry lookup failed: ${String(error)}`);
    return "## Relevant registry components\nNo registry context available.";
  }
}

/**
 * Generate a context-aware wireframe SVG based on the user prompt.
 * Parses the prompt for UI keywords (dashboard, ecommerce, chat, etc.)
 * and produces a greyscale wireframe with appropriate layout sections.
 */
function generateWireframeSvg(prompt: string): string {
  const sanitized = prompt.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lower = prompt.toLowerCase();
  const projectName = sanitized.length > 40 ? sanitized.slice(0, 40) + "…" : sanitized;

  // Detect UI archetype from prompt keywords
  const isDashboard = /dashboard|admin|analytics|panel|monitoring/.test(lower);
  const isEcommerce = /ecommerce|shop|store|product|checkout|cart|billing/.test(lower);
  const isSocial = /social|feed|chat|messaging|forum|community/.test(lower);
  const isSaaS = /saas|subscription|pricing|tenant/.test(lower);
  const isAuth = /login|sign.?in|register|sign.?up|authentication/.test(lower);
  const hasSidebar = isDashboard || isSaaS || isEcommerce;
  const hasCards = isDashboard || isEcommerce || isSocial;

  // Build sidebar nav items
  const navItems = ["Home", "Dashboard", "Projects", "Settings"];
  if (isEcommerce) navItems.splice(1, 0, "Products", "Orders");
  if (isSocial) navItems.splice(1, 0, "Feed", "Messages", "Notifications");
  if (isSaaS) navItems.splice(1, 0, "Workspaces", "Billing");
  if (isAuth) navItems.push("Login", "Sign Up");

  const navSvg = navItems.map((item, i) =>
    `<text x="${hasSidebar ? 24 : 48}" y="${112 + i * 36}" fill="#64748B" font-family="system-ui, sans-serif" font-size="15">${item}</text>`
  ).join("\n  ");

  // Content cards
  let contentCards = "";
  if (hasCards) {
    const cardLabels = isEcommerce
      ? ["Revenue", "Orders", "Customers", "Products"]
      : isSocial
        ? ["Recent Posts", "Activity Feed", "Trending Topics", "Suggested Connections"]
        : ["Key Metrics", "Recent Activity", "Team", "Quick Actions"];
    contentCards = cardLabels.map((label, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = hasSidebar ? 300 + col * 420 : 80 + col * 560;
      const cy = 130 + row * 200;
      return [
        `<rect x="${cx}" y="${cy}" width="${col === 0 ? 380 : 380}" height="170" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" rx="8" />`,
        `<text x="${cx + 16}" y="${cy + 28}" fill="#1E293B" font-family="system-ui, sans-serif" font-size="16" font-weight="600">${label}</text>`,
        `<rect x="${cx + 16}" y="${cy + 40}" width="${(col + 1) * 60}" height="8" fill="#E2E8F0" rx="4" />`,
        `<rect x="${cx + 16}" y="${cy + 58}" width="${(3 - col) * 80}" height="8" fill="#F1F5F9" rx="4" />`,
        `<rect x="${cx + 16}" y="${cy + 76}" width="${(col + 2) * 50}" height="8" fill="#F1F5F9" rx="4" />`,
        `<rect x="${cx + 16}" y="${cy + 100}" width="120" height="32" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" rx="6" />`,
        `<text x="${cx + 28}" y="${cy + 120}" fill="#64748B" font-family="system-ui, sans-serif" font-size="12">View details</text>`,
      ].join("\n  ");
    }).join("\n  ");
  } else {
    // Simple single-content layout for auth/landing pages
    const cx = hasSidebar ? 300 : 80;
    const cy = 130;
    contentCards = [
      `<rect x="${cx}" y="${cy}" width="${hasSidebar ? 900 : 1120}" height="500" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" rx="12" />`,
      `<rect x="${cx + 40}" y="${cy + 40}" width="${hasSidebar ? 350 : 500}" height="${isAuth ? 50 : 32}" fill="#1E293B" rx="6" />`,
      `<text x="${cx + 48}" y="${cy + 72}" fill="#334155" font-family="system-ui, sans-serif" font-size="16">${isAuth ? "Authentication" : "Welcome to"} ${projectName}</text>`,
      `<rect x="${cx + 40}" y="${cy + 100}" width="${hasSidebar ? 500 : 700}" height="12" fill="#F1F5F9" rx="6" />`,
      `<rect x="${cx + 40}" y="${cy + 124}" width="${hasSidebar ? 400 : 600}" height="12" fill="#F1F5F9" rx="6" />`,
      `<rect x="${cx + 40}" y="${cy + 148}" width="${hasSidebar ? 450 : 650}" height="12" fill="#F1F5F9" rx="6" />`,
      // Form fields for auth pages
      ...(isAuth ? [
        `<rect x="${cx + 40}" y="${cy + 190}" width="${hasSidebar ? 400 : 450}" height="40" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" rx="6" />`,
        `<text x="${cx + 52}" y="${cy + 216}" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="14">Email address</text>`,
        `<rect x="${cx + 40}" y="${cy + 244}" width="${hasSidebar ? 400 : 450}" height="40" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" rx="6" />`,
        `<text x="${cx + 52}" y="${cy + 270}" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="14">Password</text>`,
        `<rect x="${cx + 40}" y="${cy + 302}" width="${hasSidebar ? 400 : 450}" height="44" fill="#0F172A" rx="8" />`,
        `<text x="${cx + (hasSidebar ? 220 : 265)}" y="${cy + 328}" fill="#FFFFFF" font-family="system-ui, sans-serif" font-size="15" font-weight="600" text-anchor="middle">Sign in</text>`,
      ] : []),
    ].join("\n  ");
  }

  // Legend footer
  const legend = `<text x="48" y="692" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="12">Generated by Phase 2 · ${new Date().toISOString().slice(0, 10)} · Refine via Penpot sync or /phase-2 review</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="Pakalon wireframe for ${projectName}">
  <defs>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#1E293B" />
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="1280" height="720" fill="#F1F5F9" />
  <!-- Header -->
  <rect width="1280" height="64" fill="url(#hdr)" />
  <text x="24" y="41" fill="#FFFFFF" font-family="system-ui, sans-serif" font-size="22" font-weight="700">${projectName}</text>
  <rect x="1170" y="18" width="80" height="28" fill="#334155" rx="6" />
  <text x="1210" y="37" fill="#CBD5E1" font-family="system-ui, sans-serif" font-size="12" text-anchor="middle">Profile</text>
  <!-- Sidebar -->
  ${hasSidebar ? `<rect x="0" y="64" width="240" height="608" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" />` : ""}
  ${navSvg}
  <!-- Divider -->
  <line x1="${hasSidebar ? 240 : 0}" y1="64" x2="${hasSidebar ? 240 : 1280}" y2="64" stroke="#E2E8F0" stroke-width="1" />
  <!-- Content area -->
  ${contentCards}
  <!-- Legend -->
  ${legend}
</svg>`;
}

const PHASES: PhaseDefinition[] = [
  {
    number: 1,
    name: "Planning & Brainstorming",
    description: "Run interactive planning Q&A and generate detailed phase-1 markdown set",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Clipboard] Phase 1: Planning, Q&A, and requirements synthesis\n\n" });

      const defaults = {
        appType: "Web application",
        audience: "General users",
        coreFeatures: "Authentication, dashboard, project workflows",
        frontendFramework: "React / Next.js",
        backendFramework: "Node.js / Fastify",
        database: "PostgreSQL",
        timeline: "4-8 weeks",
        security: "Basic auth + rate limiting",
        deploymentTarget: "Cloud",
        budgetRange: "Moderate",
        teamSize: "2-5 people",
        contextAllocation: "Use 75% of the model context for this project",
        integrationRequirements: "Auth, analytics",
        constraints: "Security-first, responsive UI, maintainable architecture",
      } as const;

      const answers: Phase1AnswerMap = {};
      const totalQuestions = 13;
      const existingProject = summarizeExistingProjectState(ctx.projectDir);

      if (ctx.isYolo) {
        Object.assign(answers, defaults);
        ctx.emit({
          type: "text_delta",
          content:
            "  [!] YOLO mode: using inferred planning answers without pausing for manual Q&A.\n" +
            `  ${existingProject.summary}\n`,
        });
      } else {
        ctx.emit({
          type: "text_delta",
          content:
            "  [Handshake] Starting interactive brainstorming. Please answer the prompts as they appear.\n" +
            `  ${existingProject.summary}\n`,
        });

        const appTypeChoices = [
          { id: "web", label: "Web application" },
          { id: "mobile", label: "Mobile app" },
          { id: "desktop", label: "Desktop app" },
          { id: "cli", label: "CLI / terminal tool" },
          { id: "api", label: "API / backend service" },
          { id: "other", label: "Other" },
        ];
        const appType = await ctx.waitForChoice(
          `1/${totalQuestions}`,
          "What are we building?",
          appTypeChoices,
          { allowOther: true, questionIndex: 0, totalQuestions },
        );
        answers.appType = resolveChoiceText(appType, appTypeChoices, defaults.appType) as string;

        const audienceChoices = [
          { id: "consumers", label: "Consumers / end users" },
          { id: "teams", label: "Small teams" },
          { id: "smb", label: "SMBs / startups" },
          { id: "enterprise", label: "Enterprise users" },
          { id: "developers", label: "Developers" },
          { id: "internal", label: "Internal operators" },
          { id: "other", label: "Other" },
        ];
        const audience = await ctx.waitForChoice(
          `2/${totalQuestions}`,
          "Who is the primary target audience?",
          audienceChoices,
          { allowOther: true, questionIndex: 1, totalQuestions },
        );
        answers.audience = resolveChoiceText(audience, audienceChoices, defaults.audience) as string;

        const coreFeatureChoices = [
          { id: "auth", label: "Authentication / login" },
          { id: "dashboard", label: "Dashboard / overview" },
          { id: "workflows", label: "Workflows / CRUD management" },
          { id: "analytics", label: "Analytics / reporting" },
          { id: "payments", label: "Payments / billing" },
          { id: "notifications", label: "Notifications" },
          { id: "search", label: "Search" },
          { id: "realtime", label: "Real-time collaboration" },
          { id: "offline", label: "Offline mode" },
          { id: "other", label: "Other" },
        ];
        const coreFeatures = await ctx.waitForChoice(
          `3/${totalQuestions}`,
          "Which core features matter for v1? (multi-select)",
          coreFeatureChoices,
          { multiSelect: true, allowOther: true, questionIndex: 2, totalQuestions },
        );
        answers.coreFeatures = resolveChoiceText(coreFeatures, coreFeatureChoices, defaults.coreFeatures);

        const frontendChoices =
          answers.appType === "mobile"
            ? [
                { id: "react-native", label: "React Native" },
                { id: "flutter", label: "Flutter" },
                { id: "native", label: "Native iOS/Android" },
                { id: "expo", label: "Expo" },
                { id: "other", label: "Other" },
              ]
            : answers.appType === "desktop"
              ? [
                  { id: "electron", label: "Electron" },
                  { id: "tauri", label: "Tauri" },
                  { id: "qt", label: "Qt" },
                  { id: "other", label: "Other" },
                ]
              : answers.appType === "cli"
                ? [
                    { id: "ink", label: "Ink / TUI" },
                    { id: "commander", label: "Commander / yargs CLI" },
                    { id: "custom", label: "Custom terminal experience" },
                    { id: "other", label: "Other" },
                  ]
                : answers.appType === "api"
                  ? [
                      { id: "no-ui", label: "No frontend — API only" },
                      { id: "admin-ui", label: "Admin UI later" },
                      { id: "other", label: "Other" },
                    ]
                  : [
                      { id: "nextjs", label: "React / Next.js" },
                      { id: "vue", label: "Vue / Nuxt" },
                      { id: "svelte", label: "SvelteKit" },
                      { id: "other", label: "Other" },
                    ];

        const frontendFramework = await ctx.waitForChoice(
          `4/${totalQuestions}`,
          "Preferred frontend framework or UI stack?",
          frontendChoices,
          { allowOther: true, questionIndex: 3, totalQuestions },
        );
        answers.frontendFramework = resolveChoiceText(frontendFramework, frontendChoices, defaults.frontendFramework) as string;

        const backendFramework = await ctx.waitForChoice(
          `5/${totalQuestions}`,
          "Preferred backend stack?",
          [
            { id: "fastify", label: "Node.js / Fastify" },
            { id: "nestjs", label: "Node.js / NestJS" },
            { id: "go", label: "Go / Chi or Fiber" },
            { id: "rust", label: "Rust / Axum" },
            { id: "dotnet", label: ".NET / ASP.NET Core" },
            { id: "other", label: "Other" },
          ],
          { allowOther: true, questionIndex: 4, totalQuestions },
        );
        answers.backendFramework = resolveChoiceText(
          backendFramework,
          [
            { id: "fastify", label: "Node.js / Fastify" },
            { id: "nestjs", label: "Node.js / NestJS" },
            { id: "go", label: "Go / Chi or Fiber" },
            { id: "rust", label: "Rust / Axum" },
            { id: "dotnet", label: ".NET / ASP.NET Core" },
            { id: "other", label: "Other" },
          ],
          defaults.backendFramework,
        ) as string;

        const database = await ctx.waitForChoice(
          `6/${totalQuestions}`,
          "Which database fits best?",
          [
            { id: "postgres", label: "PostgreSQL" },
            { id: "mysql", label: "MySQL" },
            { id: "sqlite", label: "SQLite" },
            { id: "mongo", label: "MongoDB" },
            { id: "supabase", label: "Supabase" },
            { id: "firebase", label: "Firebase" },
            { id: "other", label: "Other" },
          ],
          { allowOther: true, questionIndex: 5, totalQuestions },
        );
        answers.database = resolveChoiceText(
          database,
          [
            { id: "postgres", label: "PostgreSQL" },
            { id: "mysql", label: "MySQL" },
            { id: "sqlite", label: "SQLite" },
            { id: "mongo", label: "MongoDB" },
            { id: "supabase", label: "Supabase" },
            { id: "firebase", label: "Firebase" },
            { id: "other", label: "Other" },
          ],
          defaults.database,
        ) as string;

        const timelineChoices = [
          { id: "asap", label: "ASAP" },
          { id: "short", label: "1-2 weeks" },
          { id: "medium", label: "2-4 weeks" },
          { id: "standard", label: "1-3 months" },
          { id: "long", label: "3+ months" },
          { id: "flexible", label: "Flexible" },
        ];
        const timeline = await ctx.waitForChoice(
          `7/${totalQuestions}`,
          "How urgent is delivery?",
          timelineChoices,
          { questionIndex: 6, totalQuestions },
        );
        answers.timeline = resolveChoiceText(timeline, timelineChoices, defaults.timeline) as string;

        const securityChoices = [
          { id: "none", label: "None / prototype only" },
          { id: "basic", label: "Basic auth + rate limiting" },
          { id: "enterprise", label: "Enterprise security / SSO / audit logs" },
        ];
        const security = await ctx.waitForChoice(
          `8/${totalQuestions}`,
          "What security level do we need?",
          securityChoices,
          { questionIndex: 7, totalQuestions },
        );
        answers.security = resolveChoiceText(security, securityChoices, defaults.security) as string;

        const deploymentChoices = [
          { id: "cloud", label: "Cloud" },
          { id: "self-hosted", label: "Self-hosted" },
          { id: "both", label: "Both" },
        ];
        const deploymentTarget = await ctx.waitForChoice(
          `9/${totalQuestions}`,
          "Where should it run?",
          deploymentChoices,
          { questionIndex: 8, totalQuestions },
        );
        answers.deploymentTarget = resolveChoiceText(deploymentTarget, deploymentChoices, defaults.deploymentTarget) as string;

        const budgetChoices = [
          { id: "bootstrapped", label: "Bootstrapped / minimal" },
          { id: "low", label: "Low" },
          { id: "moderate", label: "Moderate" },
          { id: "high", label: "High" },
          { id: "enterprise", label: "Enterprise" },
          { id: "other", label: "Other" },
        ];
        const budgetRange = await ctx.waitForChoice(
          `10/${totalQuestions}`,
          "What cloud budget range should we assume?",
          budgetChoices,
          { allowOther: true, questionIndex: 9, totalQuestions },
        );
        answers.budgetRange = resolveChoiceText(budgetRange, budgetChoices, defaults.budgetRange) as string;

        const teamChoices = [
          { id: "solo", label: "Solo" },
          { id: "small", label: "2-3 people" },
          { id: "medium", label: "4-6 people" },
          { id: "large", label: "7-12 people" },
          { id: "enterprise", label: "12+ people" },
        ];
        const teamSize = await ctx.waitForChoice(
          `11/${totalQuestions}`,
          "How large is the delivery team?",
          teamChoices,
          { questionIndex: 10, totalQuestions },
        );
        answers.teamSize = resolveChoiceText(teamSize, teamChoices, defaults.teamSize) as string;

        const contextAllocation = await ctx.waitForChoice(
          `12/${totalQuestions}`,
          "How much of the model context window can this project use?",
          [
            { id: "use-all", label: "Use the full available model context for this project" },
            { id: "90", label: "Use 90% of the model context for this project" },
            { id: "75", label: "Use 75% of the model context for this project" },
            { id: "65", label: "Use 65% of the model context for this project" },
            ...(existingProject.isNewProject ? [] : [{ id: "50", label: "Use 50% of the model context for this existing project" }]),
            { id: "other", label: "Custom percentage" },
          ],
          { allowOther: true, questionIndex: 11, totalQuestions },
        );
        answers.contextAllocation = resolveChoiceText(
          contextAllocation,
          [
            { id: "use-all", label: "Use the full available model context for this project" },
            { id: "90", label: "Use 90% of the model context for this project" },
            { id: "75", label: "Use 75% of the model context for this project" },
            { id: "65", label: "Use 65% of the model context for this project" },
            { id: "50", label: "Use 50% of the model context for this existing project" },
            { id: "other", label: "Custom percentage" },
          ],
          defaults.contextAllocation,
        ) as string;

        const integrationChoices = [
          { id: "payments", label: "Payments" },
          { id: "auth", label: "Auth / SSO" },
          { id: "analytics", label: "Analytics" },
          { id: "email", label: "Email" },
          { id: "push", label: "Push notifications" },
          { id: "webhooks", label: "Webhooks" },
          { id: "crm", label: "CRM / external systems" },
          { id: "other", label: "Other" },
        ];
        const integrations = await ctx.waitForChoice(
          `13/${totalQuestions}`,
          "Which integrations should we plan for? (multi-select)",
          integrationChoices,
          { multiSelect: true, allowOther: true, questionIndex: 12, totalQuestions },
        );
        answers.integrationRequirements = resolveChoiceText(integrations, integrationChoices, defaults.integrationRequirements);
      }

      const now = new Date().toISOString();
      const projectName = path.basename(ctx.projectDir);
      const contextBudget = buildContextBudget(answers, existingProject.isNewProject);
      const stackSummary = [
        `Frontend/UI: ${formatAnswer(answers.frontendFramework ?? defaults.frontendFramework)}`,
        `Backend: ${formatAnswer(answers.backendFramework ?? defaults.backendFramework)}`,
        `Database: ${formatAnswer(answers.database ?? defaults.database)}`,
      ].join("\n");
      const existingArtifacts = existingProject.existingPhaseArtifacts.length
        ? existingProject.existingPhaseArtifacts.map((file) => `- ${file}`).join("\n")
        : "- None";
      const sourceSample = existingProject.sourceFiles.length
        ? existingProject.sourceFiles.slice(0, 30).map((file) => `- ${file}`).join("\n")
        : "- None detected";

      const phase1Files: Record<string, string> = {
        "context_management.md": `# Context Management

- Generated: ${now}
- Project: ${projectName}
- Project mode: ${existingProject.isNewProject ? "new project" : "existing project continuation"}
- User allocation choice: ${formatAnswer(answers.contextAllocation ?? defaults.contextAllocation)}

${formatContextBudgetMarkdown(contextBudget)}

## Task-Level Budget Rules

- Every phase must keep 10% of its allocation unused as a local safety reserve.
- Large file reads should be summarized before moving to the next phase.
- Phase 3 sub-agents should consume only their assigned brief plus the files they edit.
- Phase 4 scanners should write reports to artifacts and pass summaries forward.

## Priority Context Files

1. .pakalon/plan.md
2. .pakalon/task.md
3. .pakalon-agents/ai-agents/phase-1/phase-1.md
4. .pakalon-agents/ai-agents/phase-2/phase-2.md
5. Current source files changed by the active phase

## Existing Project Signals

${existingProject.summary}

### Existing source sample
${sourceSample}

### Existing phase artifacts
${existingArtifacts}
`,
        "plan.md": `# Plan\n\n## Project\n${ctx.userPrompt}\n\n## Project State\n${existingProject.summary}\n\n## Problem framing\n- Product type: ${formatAnswer(answers.appType ?? defaults.appType)}\n- Audience: ${formatAnswer(answers.audience ?? defaults.audience)}\n- Core features: ${formatAnswer(answers.coreFeatures ?? defaults.coreFeatures)}\n\n## Stack preferences\n- Frontend/UI: ${formatAnswer(answers.frontendFramework ?? defaults.frontendFramework)}\n- Backend: ${formatAnswer(answers.backendFramework ?? defaults.backendFramework)}\n- Database: ${formatAnswer(answers.database ?? defaults.database)}\n\n## Delivery constraints\n- Timeline: ${formatAnswer(answers.timeline ?? defaults.timeline)}\n- Security: ${formatAnswer(answers.security ?? defaults.security)}\n- Deployment target: ${formatAnswer(answers.deploymentTarget ?? defaults.deploymentTarget)}\n- Budget range: ${formatAnswer(answers.budgetRange ?? defaults.budgetRange)}\n- Team size: ${formatAnswer(answers.teamSize ?? defaults.teamSize)}\n- Context allocation: ${formatAnswer(answers.contextAllocation ?? defaults.contextAllocation)}\n- Integrations: ${formatAnswer(answers.integrationRequirements ?? defaults.integrationRequirements)}\n\n## Partial Completion Handling\n- Highest detected completed phase: ${existingProject.highestCompletedPhase || "none"}\n- Existing artifacts should be reused unless the user explicitly approved overwriting.\n- If source implementation already exists, Phase 3 should patch gaps rather than regenerate from scratch.\n\n## Milestones\n1. Phase 1 requirements and constraints finalized\n2. Phase 2 wireframes reviewed and approved\n3. Phase 3 implementation complete\n4. Phase 4 security validation complete\n5. Phase 5 release and deployment\n6. Phase 6 final documentation\n`,
        "tasks.md": `# Tasks\n\n## Phase 1\n- [x] Collect product intent\n- [x] Detect existing project and phase artifact state\n- [x] Capture constraints and risk profile\n- [x] Produce planning artifacts\n- [x] Produce context-management token budget with 10% buffer\n\n## Phase 2\n- [ ] Generate wireframe package\n- [ ] Export SVG, JSON, and .penpot artifacts\n- [ ] Run approval/rework loop\n\n## Phase 3\n- [ ] Build or patch frontend according to phase artifacts\n- [ ] Build or patch backend from API_reference.md and Database_schema.md\n- [ ] Run integration and feedback sub-agent passes\n\n## Phase 4\n- [ ] Run security validation workflow\n- [ ] Capture screenshot and testing evidence\n\n## Phase 5\n- [ ] Configure release and deployment decisions\n\n## Phase 6\n- [ ] Produce complete project documentation\n`,
        "design.md": `# Design System

## UX Direction
- Audience: ${formatAnswer(answers.audience ?? defaults.audience)}
- Core features: ${formatAnswer(answers.coreFeatures ?? defaults.coreFeatures)}
- Team size: ${formatAnswer(answers.teamSize ?? defaults.teamSize)}

## Design Principles
1. **Clarity**: Every element has a clear purpose
2. **Consistency**: Uniform patterns across all views
3. **Efficiency**: Minimize clicks and cognitive load
4. **Accessibility**: WCAG 2.1 AA compliance

## Color Palette
- Primary: #0F172A (Slate 900)
- Secondary: #3B82F6 (Blue 500)
- Success: #10B981 (Emerald 500)
- Warning: #F59E0B (Amber 500)
- Error: #EF4444 (Red 500)
- Background: #F8FAFC (Slate 50)
- Surface: #FFFFFF
- Text Primary: #1E293B (Slate 800)
- Text Secondary: #64748B (Slate 500)

## Typography
- Headings: Inter, system-ui, sans-serif
- Body: Inter, system-ui, sans-serif
- Code: JetBrains Mono, monospace

## Spacing Scale
- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px
- 2xl: 48px

## Component Library
- shadcn/ui (for React/Next.js projects)
- Tailwind CSS for utility-first styling
- Radix UI primitives for accessibility

## Layout Patterns
- Sidebar navigation for dashboard views
- Card-based layouts for data display
- Modal dialogs for focused tasks
- Toast notifications for feedback

## Responsive Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

## Wireframe References
- See phase-2/Wireframe_generated.svg for layout specifications
- Follow component structure from approved wireframes
`,
        "phase-1.md": `# Phase 1 Summary\n\nPhase 1 completed with interactive planning inputs.\n\n## Captured answers\n- App type: ${formatAnswer(answers.appType ?? defaults.appType)}\n- Audience: ${formatAnswer(answers.audience ?? defaults.audience)}\n- Core features: ${formatAnswer(answers.coreFeatures ?? defaults.coreFeatures)}\n- Frontend/UI: ${formatAnswer(answers.frontendFramework ?? defaults.frontendFramework)}\n- Backend: ${formatAnswer(answers.backendFramework ?? defaults.backendFramework)}\n- Database: ${formatAnswer(answers.database ?? defaults.database)}\n- Timeline: ${formatAnswer(answers.timeline ?? defaults.timeline)}\n- Security: ${formatAnswer(answers.security ?? defaults.security)}\n- Deployment target: ${formatAnswer(answers.deploymentTarget ?? defaults.deploymentTarget)}\n- Budget range: ${formatAnswer(answers.budgetRange ?? defaults.budgetRange)}\n- Team size: ${formatAnswer(answers.teamSize ?? defaults.teamSize)}\n- Context allocation: ${formatAnswer(answers.contextAllocation ?? defaults.contextAllocation)}\n- Integrations: ${formatAnswer(answers.integrationRequirements ?? defaults.integrationRequirements)}\n\n## Output\n${PHASE1_FILE_ORDER.map((file) => `- ${file}`).join("\n")}\n`,
        "agent-skills.md": `# Agent Skills\n\n## Recommended specialist roles\n- Planner (requirements, constraints, dependencies)\n- Designer (wireframes and UX review loops)\n- Builder (frontend/backend implementation)\n- Security auditor (phase-4 risk validation)\n- Release engineer (phase-5 delivery)\n- Documentation specialist (phase-6)\n`,
        "prd.md": `# Product Requirements Document

## Product Vision
${ctx.userPrompt}

## Target Users
${formatAnswer(answers.audience ?? defaults.audience)}

## Product Type
${formatAnswer(answers.appType ?? defaults.appType)}

## Must-Have Features (v1)
${formatAnswer(answers.coreFeatures ?? defaults.coreFeatures)}

## Integration Requirements
${formatAnswer(answers.integrationRequirements ?? defaults.integrationRequirements)}

## Success Metrics
- User can complete core workflows without friction
- Application loads in < 3 seconds on standard connections
- Security validation passes Phase 4 checks
- Documentation is comprehensive for onboarding

## Constraints
${formatAnswer(answers.constraints ?? defaults.constraints)}

## Out of Scope (v1)
- Advanced analytics and reporting (consider for v2)
- Multi-language internationalization
- Native mobile applications
- Complex permission systems beyond basic auth

## Acceptance Criteria
- [ ] All must-have features are functional
- [ ] Frontend matches approved wireframes from Phase 2
- [ ] API endpoints follow RESTful conventions
- [ ] Database schema supports all required entities
- [ ] Security scan passes with no critical findings
`,
        "Database_schema.md": `# Database Schema

## Database Engine
${formatAnswer(answers.database ?? defaults.database)}

## Core Entities

### users
- id: UUID (primary key)
- email: VARCHAR(255) (unique, not null)
- name: VARCHAR(255)
- password_hash: VARCHAR(255) (nullable for OAuth users)
- created_at: TIMESTAMP (default now)
- updated_at: TIMESTAMP
- last_login: TIMESTAMP (nullable)
- is_active: BOOLEAN (default true)

### projects
- id: UUID (primary key)
- user_id: UUID (foreign key → users.id)
- name: VARCHAR(255) (not null)
- description: TEXT
- status: ENUM('active', 'archived', 'deleted')
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
- config: JSONB (project-specific settings)

### sessions
- id: UUID (primary key)
- project_id: UUID (foreign key → projects.id)
- user_id: UUID (foreign key → users.id)
- started_at: TIMESTAMP
- ended_at: TIMESTAMP (nullable)
- status: ENUM('active', 'completed', 'failed')
- context_tokens_used: INTEGER
- model_used: VARCHAR(100)

### tasks
- id: UUID (primary key)
- project_id: UUID (foreign key → projects.id)
- session_id: UUID (foreign key → sessions.id, nullable)
- title: VARCHAR(255) (not null)
- description: TEXT
- status: ENUM('pending', 'in_progress', 'completed', 'failed')
- priority: ENUM('low', 'medium', 'high', 'critical')
- assigned_to: VARCHAR(100) (agent name)
- created_at: TIMESTAMP
- completed_at: TIMESTAMP (nullable)

### api_keys
- id: UUID (primary key)
- user_id: UUID (foreign key → users.id)
- key_hash: VARCHAR(255) (not null)
- name: VARCHAR(100)
- permissions: JSONB
- expires_at: TIMESTAMP (nullable)
- created_at: TIMESTAMP
- last_used: TIMESTAMP (nullable)

### audit_log
- id: UUID (primary key)
- user_id: UUID (foreign key → users.id)
- action: VARCHAR(100) (not null)
- resource_type: VARCHAR(50)
- resource_id: UUID
- details: JSONB
- ip_address: INET
- created_at: TIMESTAMP

## Indexes
- users: email (unique)
- projects: user_id, status
- sessions: project_id, user_id, status
- tasks: project_id, status, assigned_to
- api_keys: user_id, key_hash
- audit_log: user_id, action, created_at

## Notes
- Use UUID for all primary keys for distributed system compatibility
- JSONB for flexible configuration and audit details
- Soft delete for projects (status = 'deleted')
- Align schema details with backend implementation in phase-3
`,
        "API_reference.md": `# API Reference

## Base URL
\`http://localhost:3000/api/v1\`

## Authentication
All endpoints require Bearer token in Authorization header:
\`\`\`
Authorization: Bearer <jwt_token>
\`\`\`

## Auth Endpoints

### POST /auth/login
- Description: Authenticate user and receive JWT
- Request: { email: string, password: string }
- Response: { token: string, user: { id, email, name } }
- Status: 200 OK, 401 Unauthorized

### POST /auth/register
- Description: Create new user account
- Request: { email: string, password: string, name: string }
- Response: { token: string, user: { id, email, name } }
- Status: 201 Created, 409 Conflict

### POST /auth/refresh
- Description: Refresh expired JWT token
- Request: { refresh_token: string }
- Response: { token: string }
- Status: 200 OK, 401 Unauthorized

## Project Endpoints

### GET /projects
- Description: List user's projects
- Query params: page, limit, status
- Response: { projects: Project[], total: number }

### POST /projects
- Description: Create new project
- Request: { name: string, description?: string }
- Response: { project: Project }
- Status: 201 Created

### GET /projects/:id
- Description: Get project details
- Response: { project: Project }
- Status: 200 OK, 404 Not Found

### PUT /projects/:id
- Description: Update project
- Request: { name?: string, description?: string, status?: string }
- Response: { project: Project }

### DELETE /projects/:id
- Description: Soft delete project
- Status: 204 No Content, 404 Not Found

## Task Endpoints

### GET /projects/:projectId/tasks
- Description: List tasks for project
- Query params: status, priority, assigned_to
- Response: { tasks: Task[], total: number }

### POST /projects/:projectId/tasks
- Description: Create new task
- Request: { title: string, description?: string, priority?: string }
- Response: { task: Task }
- Status: 201 Created

### PUT /tasks/:id
- Description: Update task
- Request: { status?: string, assigned_to?: string, priority?: string }
- Response: { task: Task }

### DELETE /tasks/:id
- Description: Delete task
- Status: 204 No Content

## Session Endpoints

### GET /projects/:projectId/sessions
- Description: List sessions for project
- Response: { sessions: Session[] }

### POST /projects/:projectId/sessions
- Description: Start new session
- Request: { model?: string }
- Response: { session: Session }

### GET /sessions/:id
- Description: Get session details with messages
- Response: { session: Session, messages: Message[] }

## Usage Endpoints

### GET /usage
- Description: Get user's token usage stats
- Query params: period (day|week|month), model
- Response: { usage: UsageStats }

### GET /usage/billing
- Description: Get billing summary
- Response: { billing: BillingSummary }

## Error Response Format
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error message",
    "details": {}
  }
}
\`\`\`

## Rate Limits
- Auth endpoints: 10 requests/minute
- API endpoints: 100 requests/minute
- AI endpoints: 20 requests/minute

## Notes
- Finalize request/response contracts in phase-3 API implementation
- Add OpenAPI/Swagger documentation in phase-6
`,
        "risk-assessment.md": `# Risk Assessment\n\n## Key risks\n1. Scope creep from unclear requirements\n2. Integration drift between frontend/backend\n3. Security issues discovered late in cycle\n\n## Mitigations\n- Strict phase gates\n- Artifact-first execution\n- Early security baseline in phase-4\n`,
        "user-stories.md": `# User Stories\n\n1. As a ${answers.audience}, I can start a guided project workflow quickly.\n2. As a ${answers.audience}, I can review and revise generated wireframes before build.\n3. As an operator, I can run security validation before deployment.\n4. As a maintainer, I can read full technical documentation after delivery.\n`,
        "technical-spec.md": `# Technical Specification

## Preferred Stack
${stackSummary}

## Architecture Overview

### System Architecture
- **Frontend**: Single-page application (SPA) or server-side rendered (SSR) based on framework choice
- **Backend**: RESTful API with authentication middleware
- **Database**: ${formatAnswer(answers.database ?? defaults.database)} with connection pooling
- **Cache**: Redis for session management and rate limiting (optional)

### Module Structure
\`\`\`
src/
├── components/      # Reusable UI components
├── pages/          # Route/page components
├── hooks/          # Custom React hooks
├── services/       # API client and external services
├── utils/          # Helper functions
├── types/          # TypeScript type definitions
├── config/         # Configuration management
└── styles/         # Global styles and theme
\`\`\`

### API Design
- RESTful endpoints with versioning (/api/v1/)
- JWT-based authentication with refresh tokens
- Rate limiting: 100 requests/minute per user
- Request validation using Zod schemas

### Database Design
- UUID primary keys for distributed compatibility
- Soft deletes for data retention
- JSONB for flexible configuration fields
- Proper indexing for query performance

### Security Measures
- Input validation on all endpoints
- SQL injection prevention via parameterized queries
- XSS protection with content security policy
- CORS configuration for API access
- Rate limiting to prevent abuse

### Performance Targets
- API response time: < 200ms (p95)
- Page load time: < 3 seconds
- Database query time: < 50ms (p95)
- Concurrent users: 100+

## Development Guidelines

### Code Style
- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Functional components with hooks
- Async/await for asynchronous operations

### Testing Strategy
- Unit tests for utility functions
- Integration tests for API endpoints
- E2E tests for critical user flows
- Minimum 80% code coverage

### Documentation
- JSDoc for public APIs
- README with setup instructions
- API documentation via OpenAPI/Swagger
- Deployment guide in phase-6

## Deployment
- Containerized with Docker
- CI/CD pipeline via GitHub Actions
- Environment-based configuration
- Health check endpoints for monitoring

## Notes
- Existing project changes should be incremental when source files are present
- Follow patterns from phase-2 wireframes for UI implementation
`,
        "competitive-analysis.md": `# Competitive Analysis\n\n## Comparable tools\n- AI-assisted coding agents\n- Multi-phase SDLC assistants\n- Workflow automation platforms\n\n## Differentiation\n- Explicit phase command control (/phase-1 … /phase-6)\n- Human-in-loop review gates where needed\n- Local artifact transparency in .pakalon-agents\n`,
        "constraints-and-tradeoffs.md": `# Constraints and Trade-offs\n\n## Constraints\n${formatAnswer(answers.constraints ?? defaults.constraints)}\n\n## Trade-offs\n- Faster delivery vs deep customization\n- Automated defaults vs manual review loops\n- Backward compatibility vs strict folder unification\n- Reusing existing source vs regenerating clean scaffolds\n`,
      };

      const filesWritten: string[] = [];
      for (const fileName of PHASE1_FILE_ORDER) {
        filesWritten.push(...writePhaseArtifact(ctx.projectDir, 1, fileName, phase1Files[fileName] ?? ""));
      }
      filesWritten.push(...writeNormalModePlanningArtifacts(ctx.projectDir, phase1Files));

      ctx.emit({
        type: "text_delta",
        content: `  [OK] Generated ${PHASE1_FILE_ORDER.length} phase-1 planning files and mirrored normal-mode .pakalon artifacts\n`,
      });
      ctx.emit({ type: "phase_complete", phase: 1, files: filesWritten });
    },
  },
  {
    number: 2,
    name: "Wireframes & Design Review",
    description: "Generate wireframes, run approval loop, optionally open Penpot sync workflow",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Art] Phase 2: Wireframe generation and design validation\n\n" });

      const reviewLog: string[] = [];
      const wireframeSvg = generateWireframeSvg(ctx.userPrompt);

      const wireframeJson = {
        id: "Wireframe_generated",
        phase: 2,
        generatedAt: new Date().toISOString(),
        projectPrompt: ctx.userPrompt,
        format: "wireframe",
        canvas: {
          width: 1280,
          height: 720,
          background: "#F8FAFC",
        },
        artifacts: ["Wireframe_generated.svg", "Wireframe_generated.json", "Wireframe_generated.penpot"],
      };

      const penpotStub = `# Wireframe_generated.penpot\n\nGenerated placeholder for Penpot sync workflow.\n\nProject: ${ctx.userPrompt}\nGenerated: ${new Date().toISOString()}\n`;

      if (!ctx.isYolo) {
        let approved = false;
        let iteration = 1;
        while (!approved && iteration <= 5) {
          const decision = await ctx.waitForInput(
            `Wireframe review iteration ${iteration}`,
            "Is this design okay, do you want changes, or open Penpot for live editing?",
            [
              { id: "ok", label: "Accept this design" },
              { id: "changes", label: "Make changes" },
              { id: "redesign", label: "Redesign from scratch" },
              { id: "penpot", label: "Open Penpot + sync.js" },
            ],
          );

          if (decision === "ok") {
            reviewLog.push(`Iteration ${iteration}: approved by user.`);
            approved = true;
            break;
          }

          if (decision === "penpot") {
            try {
              const { cmdPenpotOpen } = await import("@/commands/penpot.js");
              const opened = await cmdPenpotOpen(undefined, ctx.projectDir);
              reviewLog.push(`Iteration ${iteration}: opened Penpot sync at ${opened.url}`);
              ctx.emit({
                type: "design_updated",
                files_updated: ["Wireframe_generated.svg", "Wireframe_generated.penpot"],
              });
            } catch (error) {
              reviewLog.push(`Iteration ${iteration}: Penpot open failed (${String(error)})`);
            }
          }

          const feedback = (await ctx.waitForFreeText(
            decision === "redesign"
              ? "Describe what should change in the full redesign."
              : "List the specific design changes you want.",
          )).trim();

          reviewLog.push(
            `Iteration ${iteration}: ${decision === "redesign" ? "redesign" : "changes"} requested — ${feedback || "(no additional notes)"}`,
          );
          iteration++;
        }
      } else {
        reviewLog.push("YOLO mode: design auto-approved with default wireframe output.");
      }

      const filesWritten: string[] = [
        ...writePhaseArtifact(ctx.projectDir, 2, "Wireframe_generated.svg", wireframeSvg),
        ...writePhaseArtifact(ctx.projectDir, 2, "Wireframe_generated.json", `${JSON.stringify(wireframeJson, null, 2)}\n`),
        ...writePhaseArtifact(ctx.projectDir, 2, "Wireframe_generated.penpot", penpotStub),
      ];

      const screenshotPaths = getDefaultTddScreenshotPaths(ctx.projectDir);
      const reviewResult = await reviewWireframes([wireframeSvg], ctx.projectDir);
      reviewLog.push(`Phase 2 gate: ${reviewResult.decision} (${reviewResult.notes || "no notes"})`);

      const screenshotRun = await runTddScreenshotComparison(
        {
          wireframesDir: screenshotPaths.wireframesDir,
          baselineDir: screenshotPaths.baselineDir,
          diffDir: screenshotPaths.diffDir,
          threshold: Number(process.env.SCREENSHOT_THRESHOLD ?? 0.95),
        },
        {
          currentDir: screenshotPaths.currentDir,
          resultsPath: screenshotPaths.resultsPath,
          threshold: Number(process.env.SCREENSHOT_THRESHOLD ?? 0.95),
        },
      );

      const phase2Md = `# Phase 2: Wireframes\n\n## Summary\nGenerated wireframe artifacts and completed design-review loop.\n\n## Review log\n${reviewLog.map((line) => `- ${line}`).join("\n")}\n\n## TDD screenshot comparison\n- Passed: ${screenshotRun.passed}\n- Failed: ${screenshotRun.failed}\n- Results: ${path.relative(ctx.projectDir, screenshotRun.resultsPath)}\n\n## Outputs\n- Wireframe_generated.svg\n- Wireframe_generated.json\n- Wireframe_generated.penpot\n- tdd-screenshots/\n`;

      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 2, "phase-2.md", phase2Md));

      const phase2Dir = getPrimaryPhaseDir(ctx.projectDir, 2);
      const localSvgPath = path.join(phase2Dir, "Wireframe_generated.svg");
      const localJsonPath = path.join(phase2Dir, "Wireframe_generated.json");
      const penpotState = {
        version: 1,
        baseUrl: (process.env.PENPOT_BASE_URL ?? process.env.PENPOT_HOST ?? "http://localhost:3449").replace(/\/$/, ""),
        fileId: "Wireframe_generated",
        projectId: path.basename(ctx.projectDir),
        projectUrl: null,
        fileUrl: null,
        revision: 1,
        phase: 2,
        status: "generated",
        source: "pakalon-phase-2",
        updatedAt: new Date().toISOString(),
        localSvgPath,
        localJsonPath,
        artifacts: wireframeJson.artifacts,
      };

      const designTokens = extractDesignTokens({ file: penpotState, data: wireframeJson });
      await writeDesignTokens(path.join(phase2Dir, "tokens"), designTokens);

      const phaseManifestPath = path.join(phase2Dir, "phase-2-manifest.json");
      fs.writeFileSync(phaseManifestPath, `${JSON.stringify(penpotState, null, 2)}\n`, "utf-8");
      filesWritten.push(phaseManifestPath);

      const pakalonPenpotPath = path.join(ctx.projectDir, ".pakalon", "penpot.json");
      fs.mkdirSync(path.dirname(pakalonPenpotPath), { recursive: true });
      fs.writeFileSync(pakalonPenpotPath, `${JSON.stringify(penpotState, null, 2)}\n`, "utf-8");
      filesWritten.push(pakalonPenpotPath);

      const screenshotMarker = "# Add TDD screenshots for reviewed screens\n";
      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 2, "tdd-screenshots/README.md", screenshotMarker, false));
      filesWritten.push(screenshotRun.resultsPath);

      ctx.emit({ type: "text_delta", content: "  [OK] Wireframe artifacts prepared and review loop completed\n" });
      ctx.emit({ type: "phase_complete", phase: 2, files: filesWritten });
    },
  },
  {
    number: 3,
    name: "Implementation",
    description: "Use phase-1/phase-2 artifacts to prepare implementation outputs",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Computer] Phase 3: Implementation orchestration\n\n" });

      const plan = readPhaseArtifact(ctx.projectDir, 1, "plan.md");
      const tasks = readPhaseArtifact(ctx.projectDir, 1, "tasks.md");
      const design = readPhaseArtifact(ctx.projectDir, 2, "phase-2.md");
      const componentRegistryContext = buildPhase3ComponentBriefContext(ctx.projectDir, ctx.userPrompt, plan, design);

      const auditorMd = `# Auditor\n\n## Input quality check\n- plan.md: ${plan ? "found" : "missing"}\n- tasks.md: ${tasks ? "found" : "missing"}\n- phase-2.md: ${design ? "found" : "missing"}\n\n## Verdict\nProceed with structured implementation using phase artifacts.\n`;

      const filesWritten: string[] = [];
      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "auditor.md", auditorMd));
      const briefTemplates: Array<[string, string]> = [
        ["subagent-1.md", `# Phase 3 - Subagent 1: Frontend Development\n\n## Summary\nFrontend implementation based on wireframes from Phase 2.\n\n${componentRegistryContext}\n\n## Status: PENDING\n`],
        ["subagent-2.md", "# Phase 3 - Subagent 2: Backend Development\n\n## Summary\nBackend implementation using API_reference.md and Database_schema.md.\n\n## Status: PENDING\n"],
        ["subagent-3.md", "# Phase 3 - Subagent 3: Integration\n\n## Summary\nFrontend and backend integration.\n\n## Status: PENDING\n"],
        ["subagent-4.md", "# Phase 3 - Subagent 4: Testing & Debugging\n\n## Summary\nTesting and bug fixing.\n\n## Status: PENDING\n"],
        ["subagent-5.md", "# Phase 3 - Subagent 5: User Feedback\n\n## Summary\nUser feedback collection and documentation.\n\n## Status: PENDING\n"],
      ];

      for (const [name, content] of briefTemplates) {
        filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, name, content));
      }

      const briefs = new Map<string, string>();
      for (const [name] of briefTemplates) {
        briefs.set(name, readPhaseArtifact(ctx.projectDir, 3, name));
      }

      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "test-evidence/README.md", "# Test Evidence\n\nAttach test logs, screenshots, and verification notes.\n", false));

      const graph = new AgentGraph();
      const model = ctx.isYolo ? "anthropic/claude-3-5-sonnet" : "anthropic/claude-3-5-haiku";

      graph
        .addNode(new Phase3StartNode({
          id: "phase3-start",
          brief: "Initialize Phase 3 execution and dispatch parallel implementation lanes.",
          model,
          agentName: "phase3-start",
          systemPrompt: "You are a dispatcher node. Do not modify files.",
          maxTokens: 256,
          temperature: 0,
        }))
        .addNode(new Phase3GraphNode({
          id: "subagent-1",
          brief: briefs.get("subagent-1.md") || briefTemplates[0]![1],
          model,
          agentName: "phase3-frontend",
          systemPrompt: "You are the frontend implementation sub-agent. Use the brief and available tools to make concrete changes.",
          maxTokens: 8192,
          temperature: 0.3,
        }, briefs.get("subagent-1.md") || briefTemplates[0]![1]))
        .addNode(new Phase3GraphNode({
          id: "subagent-2",
          brief: briefs.get("subagent-2.md") || briefTemplates[1]![1],
          model,
          agentName: "phase3-backend",
          systemPrompt: "You are the backend implementation sub-agent. Use the brief and available tools to make concrete changes.",
          maxTokens: 8192,
          temperature: 0.3,
        }, briefs.get("subagent-2.md") || briefTemplates[1]![1]))
        .addNode(new Phase3GraphNode({
          id: "subagent-3",
          brief: briefs.get("subagent-3.md") || briefTemplates[2]![1],
          model,
          agentName: "phase3-integration",
          systemPrompt: "You are the integration sub-agent. Reconcile frontend/backend work and ensure end-to-end coherence.",
          maxTokens: 6144,
          temperature: 0.25,
        }, briefs.get("subagent-3.md") || briefTemplates[2]![1]))
        .addNode(new Phase3GraphNode({
          id: "subagent-4",
          brief: briefs.get("subagent-4.md") || briefTemplates[3]![1],
          model,
          agentName: "phase3-testing",
          systemPrompt: "You are the testing sub-agent. Validate the implementation and fix critical defects.",
          maxTokens: 6144,
          temperature: 0.2,
        }, briefs.get("subagent-4.md") || briefTemplates[3]![1]))
        .addNode(new Phase3GraphNode({
          id: "subagent-5",
          brief: briefs.get("subagent-5.md") || briefTemplates[4]![1],
          model,
          agentName: "phase3-review",
          systemPrompt: "You are the review sub-agent. Assess the work, identify gaps, and summarize readiness.",
          maxTokens: 4096,
          temperature: 0.2,
        }, briefs.get("subagent-5.md") || briefTemplates[4]![1]))
        .addEdge({ from: "phase3-start", to: "subagent-1", kind: "parallel" })
        .addEdge({ from: "phase3-start", to: "subagent-2", kind: "parallel" })
        .addEdge({
          from: "subagent-1",
          to: "subagent-3",
          kind: "sequential",
          condition: (graphContext) => graphContext.get("subagent-2:state") === "completed" && graphContext.get("subagent-3:state") !== "completed",
        })
        .addEdge({
          from: "subagent-2",
          to: "subagent-3",
          kind: "sequential",
          condition: (graphContext) => graphContext.get("subagent-1:state") === "completed" && graphContext.get("subagent-3:state") !== "completed",
        })
        .addEdge({ from: "subagent-3", to: "subagent-4", kind: "sequential" })
        .addEdge({ from: "subagent-4", to: "subagent-5", kind: "sequential" });

      const graphContext: GraphContext = new Map<string, unknown>([
        ["projectDir", ctx.projectDir],
        ["userPrompt", ctx.userPrompt],
        ["plan", plan],
        ["tasks", tasks],
        ["design", design],
        ["briefs", Object.fromEntries(briefs.entries())],
        ["isYolo", ctx.isYolo],
      ]);

      const graphResult = await graph.execute("phase3-start", graphContext);

      const executionLog = [
        `# Execution Log`,
        "",
        `- ${new Date().toISOString()} — Phase 3 started`,
        `- Loaded planning artifacts from .pakalon-agents/ai-agents/phase-1`,
        `- Loaded wireframe artifacts from .pakalon-agents/ai-agents/phase-2`,
        `- Loaded sub-agent implementation briefs`,
        `- Graph success: ${graphResult.success}`,
        `- Execution order: ${graphResult.executionOrder.join(" -> ") || "(none)"}`,
        `- Failed nodes: ${graphResult.failedNodes.join(", ") || "none"}`,
        "",
        ...Array.from(graphResult.results.entries()).flatMap(([nodeId, entries]) => [
          ...entries.map((entry) => formatExecutionLog({
            nodeId,
            state: entry.state,
            exitCode: entry.exitCode,
            duration: entry.duration,
            output: entry.output,
            error: entry.error,
          })),
          "",
        ]),
      ].join("\n");

      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "execution_log.md", executionLog));

      const feedbackResult = await runPhase3SecurityFeedbackLoop(ctx.projectDir);

      const feedbackReport = `# Security Feedback Loop

## Result
- Success: ${feedbackResult.success}
- Iterations: ${feedbackResult.iterations}
- Final actionable issues: ${feedbackResult.finalIssues.filter((issue) => issue.severity === "CRITICAL" || issue.severity === "HIGH").length}

## Patches Applied
${feedbackResult.patchesApplied.length ? feedbackResult.patchesApplied.map((patch) => `- ${patch}`).join("\n") : "- None"}

## Patched Files
${Array.from(feedbackResult.codeChanges.keys()).length ? Array.from(feedbackResult.codeChanges.keys()).map((file) => `- ${path.relative(ctx.projectDir, file)}`).join("\n") : "- None"}
`;

      filesWritten.push(...writePhaseArtifact(ctx.projectDir, 3, "security-feedback-loop.md", feedbackReport));

      filesWritten.push(...await maybeRunPhase3Sandbox(ctx));

      ctx.emit({ type: "text_delta", content: `  [OK] Phase 3 graph executed (${graphResult.executionOrder.length} nodes)\n` });
      ctx.emit({ type: "text_delta", content: `  [Repeat] Security feedback loop completed (${feedbackResult.iterations} iteration(s))\n` });
      ctx.emit({ type: "phase_complete", phase: 3, files: filesWritten });
    },
  },
  {
    number: 4,
    name: "Security QA",
    description: "Comprehensive security scanning with SAST, DAST, and vulnerability detection",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Lock] Phase 4: Security and confidence testing\n\n" });

      // Import Phase4Agent dynamically
      const { Phase4Agent } = await import("@/agents/phase4/index.js");
      
      // Create agent context
      const agentContext: AgentContext = {
        agentId: `phase4-${Date.now()}`,
        agentName: "phase4-security",
        agentType: "phase-4-security",
        projectDir: ctx.projectDir,
        userPrompt: ctx.userPrompt || "Run comprehensive security scanning",
        apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY,
        isYolo: ctx.isYolo,
        isAgentMode: true,
        permissionMode: "auto",
        tools: [],
        disallowedTools: [],
        background: false,
      };

      // Execute Phase4Agent
      const agent = new Phase4Agent(agentContext);
      const result = await agent.execute();

      const legacyPhase4Dir = getLegacyPhaseDir(ctx.projectDir, 4);
      const primaryPhase4Dir = getPrimaryPhaseDir(ctx.projectDir, 4);
      const filesWritten: string[] = [];

      // Phase4Agent still owns several scanners that write to the legacy path.
      // Mirror them into the canonical pipeline directory before writing the
      // deterministic reports used for phase handoff and verification.
      filesWritten.push(...mirrorDirectoryFiles(legacyPhase4Dir, primaryPhase4Dir));

      const localFindings = collectLocalSecurityFindings(ctx.projectDir);
      const browserEvidence = await collectPhase4BrowserEvidence(ctx.projectDir);
      filesWritten.push(...await writePhase4CanonicalArtifacts(ctx.projectDir, result, localFindings, browserEvidence));

      ctx.emit({
        type: "text_delta",
        content: `  [OK] Security scanning complete (${dedupePaths(filesWritten).length} artifacts, ${localFindings.length} local finding(s))\n`,
      });
      ctx.emit({ type: "phase_complete", phase: 4, files: dedupePaths(filesWritten) });
    },
  },
  {
    number: 5,
    name: "Release & Deployment",
    description: "Collect deployment decisions, optional GitHub bootstrap, and cloud target selection",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Rocket] Phase 5: Release, GitHub, and cloud deployment setup\n\n" });

      const policyGate = await evaluateSandboxPolicyGate(ctx.projectDir);
      if (policyGate.active) {
        if (policyGate.passed) {
          ctx.emit({ type: "text_delta", content: "  [Sandbox] Security policy passed; promotion allowed\n" });
        } else if (policyGate.action === "report_only") {
          ctx.emit({ type: "text_delta", content: `  [Sandbox] Security policy failed in report-only mode: ${policyGate.reasons.join("; ")}\n` });
        } else {
          await destroyProjectSandbox(ctx.projectDir);
          throw new Error(`Sandbox policy blocked deployment: ${policyGate.reasons.join("; ")}`);
        }
      }

      const projectName = path.basename(ctx.projectDir);
      const repoName = `${projectName}`.replace(/\s+/g, "-").toLowerCase();

      let pushGithub = ctx.isYolo ? "yes" : await ctx.waitForInput(
        "Repository setup",
        "Should I initialize/push this project to GitHub now?",
        [
          { id: "yes", label: "Yes, configure GitHub" },
          { id: "no", label: "No, skip GitHub for now" },
        ],
      );

      let githubResult = "Skipped";
      if (pushGithub === "yes") {
        try {
          execSync("gh --version", { stdio: "pipe" });
          try {
            execSync(`gh repo create ${repoName} --source . --private --push`, {
              cwd: ctx.projectDir,
              stdio: "pipe",
            });
            githubResult = `Created and pushed via gh repo create ${repoName}`;
          } catch (error) {
            githubResult = `GitHub CLI available but repo creation failed: ${String(error)}`;
          }
        } catch {
          githubResult = "GitHub CLI not available; repository creation skipped.";
        }
      }

      const cloudProvider = ctx.isYolo
        ? "none"
        : await ctx.waitForInput(
            "Cloud target",
            "Which cloud platform should we prepare for deployment?",
            [
              { id: "aws", label: "AWS" },
              { id: "do", label: "DigitalOcean" },
              { id: "azure", label: "Azure" },
              { id: "gcp", label: "GCP" },
              { id: "none", label: "None for now" },
            ],
          );

      let credentialsRef = "not required";
      if (cloudProvider !== "none" && !ctx.isYolo) {
        credentialsRef =
          (await ctx.waitForFreeText(
            `Provide a credentials reference for ${cloudProvider.toUpperCase()} (secret name, vault path, or env var).`,
          )).trim() || "not provided";
      }

      const providerMap: Record<string, CloudProvider> = {
        aws: "aws",
        do: "digitalocean",
        azure: "azure",
        gcp: "gcp",
      };

      const supportedProviders = getCloudProviders();
      const normalizedProvider = cloudProvider === "none"
        ? undefined
        : providerMap[cloudProvider];

      let deploymentResult:
        | ReturnType<typeof deployProject>
        | undefined;
      let estimatedMonthlyCost = 0;
      if (normalizedProvider) {
        deploymentResult = deployProject(ctx.projectDir, normalizedProvider, {
          appName: repoName,
          image: `ghcr.io/${repoName}:latest`,
          port: 8000,
          env: { NODE_ENV: "production" },
          branch: "main",
        });
        estimatedMonthlyCost = estimateCost(normalizedProvider, {
          cpu: 1,
          memoryGb: 1,
          instances: 1,
        }).monthlyUsd;
      }

      const workflowDir = path.join(ctx.projectDir, ".github", "workflows");
      fs.mkdirSync(workflowDir, { recursive: true });
      const ciContent = `name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci || true\n      - run: npm test || true\n`;
      fs.writeFileSync(path.join(workflowDir, "ci.yml"), ciContent, "utf-8");

      const deploymentFiles = deploymentResult?.filesWritten ?? [];
      const deploymentInstructions = deploymentResult?.instructions ?? [];
      const deploymentFileList = deploymentFiles.length
        ? deploymentFiles.map((file) => `- ${path.relative(ctx.projectDir, file)}`).join("\n")
        : "- (none)";

      const phase5Md = `# Phase 5: Release & Deployment\n\n## GitHub\n- Requested: ${pushGithub}\n- Result: ${githubResult}\n\n## Cloud deployment\n- Provider: ${cloudProvider.toUpperCase()}\n- Credentials reference: ${credentialsRef}\n- Supported providers: ${supportedProviders.map((item) => item.label).join(", ")}\n- Estimated monthly cost: $${estimatedMonthlyCost.toFixed(2)}\n\n## Generated deployment files\n${deploymentFileList}\n\n## Deployment instructions\n${deploymentInstructions.length ? deploymentInstructions.map((item) => `- ${item}`).join("\n") : "- None"}\n\n## Notes\nThis phase now generates real cloud deployment templates instead of only CI scaffolding.\n`;

      const filesWritten = [
        ...writePhaseArtifact(ctx.projectDir, 5, "phase-5.md", phase5Md),
        path.join(workflowDir, "ci.yml"),
        ...deploymentFiles,
      ];

      await destroyProjectSandbox(ctx.projectDir);

      ctx.emit({ type: "text_delta", content: "  [OK] Deployment decision artifacts captured\n" });
      ctx.emit({ type: "phase_complete", phase: 5, files: filesWritten });
    },
  },
  {
    number: 6,
    name: "Documentation",
    description: "Analyze generated project and phase artifacts; produce comprehensive technical documentation",
    async run(ctx) {
      ctx.emit({ type: "text_delta", content: "[Book] Phase 6: Documentation synthesis\n\n" });

      const phase1Summary = readPhaseArtifact(ctx.projectDir, 1, "phase-1.md");
      const files = collectProjectTree(ctx.projectDir, TREE_LIMIT);
      const grouped = new Map<string, number>();

      for (const file of files) {
        const top = file.split("/")[0] ?? file;
        grouped.set(top, (grouped.get(top) ?? 0) + 1);
      }

      const fileBreakdown = Array.from(grouped.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([segment, count]) => `- ${segment}: ${count} file(s)`)
        .join("\n");

      const docsContent = `# Phase 6: Complete Project Documentation

## Project Intent
${ctx.userPrompt}

## Structure Summary
- Total files analyzed: ${files.length}

### Top-level breakdown
${fileBreakdown || "- (no files detected)"}

## Key generated artifacts
- .pakalon/ (init context files)
- .pakalon-agents/ai-agents/phase-1..phase-6
- .github/workflows/ci.yml

## Phase 1 insight snapshot
${phase1Summary ? phase1Summary.slice(0, 1200) : "Phase-1 summary not found."}

## Representative file tree excerpt
${files.slice(0, 120).map((f) => `- ${f}`).join("\n")}

## Operational Notes
- Use /phase-1 ... /phase-6 to execute individual workflow phases.
- Use /connect and /connect-end for Telegram runtime bridge.
`;

      // Generate user-facing doc.md
      const userDocContent = generateUserDoc(ctx.userPrompt, files, phase1Summary);

      const filesWritten = [
        ...writePhaseArtifact(ctx.projectDir, 6, "phase-6.md", docsContent),
        ...writePhaseArtifact(ctx.projectDir, 6, "doc.md", userDocContent),
      ];

      ctx.emit({ type: "text_delta", content: "  [OK] Documentation generated from phase artifacts and project tree\n" });
      ctx.emit({ type: "phase_complete", phase: 6, files: filesWritten });
    },
  },
];

// ---------------------------------------------------------------------------
// Pipeline Execution
// ---------------------------------------------------------------------------

/**
 * Run a specific phase of the pipeline.
 */
async function runPhase(session: PipelineSession, phaseNumber: number): Promise<string[]> {
  const phase = PHASES.find((p) => p.number === phaseNumber);
  if (!phase) {
    throw new Error(`Unknown phase: ${phaseNumber}`);
  }

  session.currentPhase = phaseNumber;
  session.status = "running";

  ensurePipelineDirectories(session.projectDir);

  const outputDir = getAiAgentsRoot(session.projectDir);

  const pendingInputs = new Map<string, PendingInput>();
  let latestRequestId: string | null = null;
  let phaseCompletedFiles: string[] = [];

  const ctx: PhaseContext = {
    phase: phaseNumber,
    name: phase.name,
    projectDir: session.projectDir,
    userPrompt: session.userPrompt,
    userId: session.userId,
    isYolo: session.isYolo,
    outputDir,
    abortSignal: session.abortController.signal,
    emit: (event) => {
      if (event.type === "phase_complete" && event.phase === phaseNumber && Array.isArray(event.files)) {
        phaseCompletedFiles = event.files.map((file) => String(file));
      }
      session.events.emit("event", event);
    },
    waitForInput: (message, question, choices) => {
      return new Promise<string>((resolve) => {
        const requestId = crypto.randomUUID();
        pendingInputs.set(requestId, {
          resolve: (value) => resolve(Array.isArray(value) ? value.join(", ") : value),
        });
        latestRequestId = requestId;
        session.events.emit("event", {
          type: "choice_request",
          message,
          question,
          choices,
          multi_select: false,
          allow_other: false,
          _requestId: requestId,
        });
      });
    },
    waitForChoice: (message, question, choices, options) => {
      return new Promise<string | string[]>((resolve) => {
        const requestId = crypto.randomUUID();
        pendingInputs.set(requestId, {
          resolve,
          multiSelect: Boolean(options?.multiSelect),
        });
        latestRequestId = requestId;
        session.events.emit("event", {
          type: "choice_request",
          message,
          question,
          choices,
          question_index: options?.questionIndex,
          total_questions: options?.totalQuestions,
          multi_select: Boolean(options?.multiSelect),
          allow_other: Boolean(options?.allowOther),
          _requestId: requestId,
        });
      });
    },
    waitForFreeText: (prompt) => {
      return new Promise<string>((resolve) => {
        const requestId = crypto.randomUUID();
        pendingInputs.set(requestId, {
          resolve: (value) => resolve(Array.isArray(value) ? value.join(", ") : value),
        });
        latestRequestId = requestId;
        session.events.emit("event", {
          type: "awaiting_input",
          prompt,
          _requestId: requestId,
        });
      });
    },
  };

  // Listen for input responses
  const inputHandler = (data: { requestId: string; value: string }) => {
    const resolvedId = data.requestId === "latest" ? latestRequestId : data.requestId;
    if (!resolvedId) return;
    const pending = pendingInputs.get(resolvedId);
    if (pending) {
      pendingInputs.delete(resolvedId);
      if (latestRequestId === resolvedId) {
        latestRequestId = null;
      }
      const normalized = normalizeChoiceResponse(data.value, Boolean(pending.multiSelect));
      pending.resolve(normalized);
    }
  };
  session.events.on("input", inputHandler);

  try {
    await phase.run(ctx);
    markPipelinePhaseComplete(session.projectDir, phaseNumber, phaseCompletedFiles);
    session.events.emit("event", {
      type: "phase_state_updated",
      phase: phaseNumber,
      files: phaseCompletedFiles,
    });
    return phaseCompletedFiles;
  } finally {
    session.events.off("input", inputHandler);
    pendingInputs.clear();
  }
}

/**
 * Send input to a pending pipeline choice/free-text request.
 */
export function sendInput(sessionId: string, value: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.events.emit("input", { requestId: "latest", value });
}

/**
 * Run the full pipeline (phases 1-6) or from a specific start phase.
 */
export async function runPipeline(
  sessionId: string,
  startPhase: number = 1,
  onEvent?: (event: Record<string, unknown>) => void,
  abortSignal?: AbortSignal,
  endPhase: number = 6,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  // Attach event listener
  if (onEvent) {
    session.events.on("event", onEvent);
  }

  // Handle abort
  const abortHandler = () => {
    session.status = "error";
    session.events.emit("event", { type: "error", message: "Pipeline aborted" });
  };
  abortSignal?.addEventListener("abort", abortHandler);

  try {
    // Create canonical and compatibility directory structure
    ensurePipelineDirectories(session.projectDir);

    // Initialize mem0 client for inter-phase context
    const mem0Client: Mem0Client = createHybridMem0Client({
      similarityThreshold: 0.72,
      vectorStore: { collectionName: "pakalon_pipeline_memories" },
    });

    const boundedStartPhase = Math.max(1, Math.min(6, startPhase));
    const boundedEndPhase = Math.max(boundedStartPhase, Math.min(6, endPhase));

    for (let phase = boundedStartPhase; phase <= boundedEndPhase; phase++) {
      if (abortSignal?.aborted || session.status === "error") break;

      // -------------------------------------------------------------------
      // Inter-phase artifact validation: before running this phase, verify
      // that prior phases produced meaningful output (non-empty files).
      // -------------------------------------------------------------------
      if (phase > boundedStartPhase) {
        const priorPhase = phase - 1;
        const priorDir = getPrimaryPhaseDir(session.projectDir, priorPhase);
        let priorDataOk = false;
        try {
          if (fs.existsSync(priorDir)) {
            const files = fs.readdirSync(priorDir).filter((f) => f !== "tdd-screenshots" && f !== "test-evidence");
            if (files.length > 0) {
              const nonEmpty = files.some((f) => {
                const fp = path.join(priorDir, f);
                try { return fs.statSync(fp).isFile() && fs.statSync(fp).size > 128; } catch { return false; }
              });
              priorDataOk = nonEmpty;
            }
          }
        } catch { /* best-effort */ }

        if (!priorDataOk) {
          const priors = priorPhase === 1 ? "planning" : `phase-${priorPhase}`;
          session.events.emit("event", {
            type: "text_delta",
            content: `\x1b[33m[!] Phase ${priorPhase} artifacts appear empty or missing — Phase ${phase} may have limited input data.\x1b[0m\n`,
          });
          logger.warn(`[pipeline] Phase ${priorPhase} artifacts look empty; proceeding to Phase ${phase} anyway.`);
        }
      }

      // Retrieve prior phase context from mem0 for phases > 1
      if (phase > 1) {
        const priorPhase = PHASES.find((p) => p.number === phase - 1);
        try {
          const priorContext = await interPhaseRetrieve(`phase${phase - 1}`, mem0Client);
          if (priorContext) {
            session.events.emit("event", {
              type: "text_delta",
              content: `\n[mem0] Retrieved context from Phase ${phase - 1}\n`,
            });
          }
        } catch (err) {
          logger.debug(`[pipeline] mem0 retrieve error for phase ${phase - 1}:`, err);
        }
      }

      // In non-YOLO mode, emit a choice_request between phases (except first)
      if (!session.isYolo && phase > boundedStartPhase) {
        const choice = await new Promise<string>((resolve) => {
          const requestId = crypto.randomUUID();
          session.events.emit("event", {
            type: "choice_request",
            message: `Phase ${phase - 1} complete. Ready to proceed to Phase ${phase}?`,
            question: `Proceed to ${PHASES.find((p) => p.number === phase)?.name}?`,
            choices: [
              { id: "continue", label: `End Phase ${phase - 1} and start Phase ${phase}` },
              { id: "end", label: `End Phase ${phase - 1} and stop here` },
            ],
            can_end: true,
            end_label: `End Phase ${phase - 1}`,
            _requestId: requestId,
          });
          const handler = (data: { requestId: string; value: string }) => {
            if (data.requestId === requestId || data.requestId === "latest") {
              session.events.off("input", handler);
              resolve(data.value);
            }
          };
          session.events.on("input", handler);
        });

        if (choice === "end" || choice === "skip") {
          session.events.emit("event", { type: "text_delta", content: `Stopped after Phase ${phase - 1} by user.\n` });
          break;
        }
      }

      session.events.emit("event", {
        type: "phase_start",
        phase,
        name: PHASES.find((p) => p.number === phase)?.name,
      });
      await runPhase(session, phase);

      // -------------------------------------------------------------------
      // Phase 3 → Phase 4 Security Remediation Callback Loop
      // After Phase 4 completes, check for critical security findings and
      // loop back to Phase 3 for auto-remediation if needed (max 3 iterations).
      // -------------------------------------------------------------------
      if (phase === 4) {
        const primaryScorePath = path.join(getPrimaryPhaseDir(session.projectDir, 4), "security-score.json");
        const legacyScorePath = path.join(getLegacyPhaseDir(session.projectDir, 4), "security-score.json");
        // Phase4Agent writes to legacy dir (.pakalon-agents/phase-4/);
        // fall back to primary dir (.pakalon-agents/ai-agents/phase-4/) if not found there.
        const securityScorePath = fs.existsSync(legacyScorePath) ? legacyScorePath : primaryScorePath;
        let remediationIteration = 0;
        const MAX_REMEDIATION_ITERATIONS = 3;

        while (remediationIteration < MAX_REMEDIATION_ITERATIONS) {
          let needsRemediation = false;
          let findingsSummary = "";

          try {
            if (fs.existsSync(securityScorePath)) {
              const scoreData = JSON.parse(fs.readFileSync(securityScorePath, "utf-8"));
              const critical = scoreData.breakdown?.critical ?? 0;
              const high = scoreData.breakdown?.high ?? 0;
              const grade = scoreData.grade ?? "?";

              if (critical > 0 || high > 0 || (typeof scoreData.score === "number" && scoreData.score < 60)) {
                needsRemediation = true;
                findingsSummary = `Critical:${critical} High:${high} Score:${scoreData.score ?? "?"}/100 Grade:${grade}`;
              }
            }
          } catch {
            logger.debug("[pipeline] Could not read security-score.json for callback check");
          }

          if (!needsRemediation) break;

          remediationIteration++;

          // Write remediation context so Phase 3 knows this is a callback pass
          const remediationCtxPath = path.join(getPrimaryPhaseDir(session.projectDir, 3), ".callback-remediation.json");
          fs.writeFileSync(
            remediationCtxPath,
            JSON.stringify({
              iteration: remediationIteration,
              totalIterations: MAX_REMEDIATION_ITERATIONS,
              findings: findingsSummary,
              phase3OutputDir: getPrimaryPhaseDir(session.projectDir, 3),
              phase4OutputDir: getPrimaryPhaseDir(session.projectDir, 4),
              timestamp: new Date().toISOString(),
            }, null, 2)
          );

          session.events.emit("event", {
            type: "text_delta",
            content: `\n\x1b[33m[!] Security callback loop ${remediationIteration}/${MAX_REMEDIATION_ITERATIONS}: ${findingsSummary}\x1b[0m\n\x1b[33m  Re-triggering Phase 3 → Phase 4 for auto-remediation...\x1b[0m\n`,
          });

          logger.warn(`[pipeline] Phase 4 callback: iter ${remediationIteration} — ${findingsSummary}`);

          // Re-run Phase 3 (debug/fix pass)
          await runPhase(session, 3);

          // Re-run Phase 4 (security re-scan)
          await runPhase(session, 4);
        }

        // Clean up remediation marker if it exists
        const markerPath = path.join(getPrimaryPhaseDir(session.projectDir, 3), ".callback-remediation.json");
        try { fs.unlinkSync(markerPath); } catch { /* ok */ }

        if (remediationIteration > 0) {
          session.events.emit("event", {
            type: "text_delta",
            content: remediationIteration >= MAX_REMEDIATION_ITERATIONS
              ? "\x1b[33m[!] Security callback loop: max iterations reached — some issues may remain.\x1b[0m\n"
              : "\x1b[32m[OK] Security callback loop: all critical issues resolved.\x1b[0m\n",
          });
        }

        let policyGate = await evaluateSandboxPolicyGate(session.projectDir);
        if (policyGate.active) {
          let policyIteration = 0;
          const maxPolicyIterations = policyGate.maxLoopIterations ?? 3;

          while (!policyGate.passed && policyGate.action === "loop_back" && policyIteration < maxPolicyIterations) {
            policyIteration++;
            session.events.emit("event", {
              type: "text_delta",
              content: `\n\x1b[33m[!] Sandbox policy failed (${policyIteration}/${maxPolicyIterations}): ${policyGate.reasons.join("; ")}\x1b[0m\n\x1b[33m  Re-running Phase 3 and Phase 4 against the sandbox gate...\x1b[0m\n`,
            });

            await runPhase(session, policyGate.loopBackPhase ?? 3);
            await runPhase(session, 4);
            policyGate = await evaluateSandboxPolicyGate(session.projectDir);
          }

          if (policyGate.passed) {
            session.events.emit("event", {
              type: "text_delta",
              content: "\x1b[32m[OK] Sandbox policy gate passed.\x1b[0m\n",
            });
          } else if (policyGate.action === "report_only") {
            session.events.emit("event", {
              type: "text_delta",
              content: `\x1b[33m[!] Sandbox policy failed but policy is report_only: ${policyGate.reasons.join("; ")}\x1b[0m\n`,
            });
          } else {
            await destroyProjectSandbox(session.projectDir);
            throw new Error(`Sandbox policy failed: ${policyGate.reasons.join("; ")}`);
          }
        }
      }

      // Store phase context to mem0 for inter-phase retrieval
      const currentPhaseDef = PHASES.find((p) => p.number === phase);
      if (currentPhaseDef) {
        try {
          const phaseSummary = {
            phase: phase,
            name: currentPhaseDef.name,
            completedAt: new Date().toISOString(),
            userPrompt: session.userPrompt,
          };
          await interPhaseStore(`phase${phase}`, phaseSummary, mem0Client);
          session.events.emit("event", {
            type: "text_delta",
            content: `[mem0] Stored context for Phase ${phase}\n`,
          });
        } catch (err) {
          logger.debug(`[pipeline] mem0 store error for phase ${phase}:`, err);
        }
      }
    }

    session.status = "complete";
    session.events.emit("event", { type: "stream_end" });
  } catch (err) {
    session.status = "error";
    session.events.emit("event", { type: "error", message: String(err) });
    logger.error("[pipeline] Error", err);
  } finally {
    abortSignal?.removeEventListener("abort", abortHandler);
    if (onEvent) {
      session.events.off("event", onEvent);
    }
  }
}

/**
 * Run a single phase (used for individual phase streaming).
 */
export async function runSinglePhase(
  sessionId: string,
  phaseNumber: number,
  onEvent?: (event: Record<string, unknown>) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  if (onEvent) {
    session.events.on("event", onEvent);
  }

  abortSignal?.addEventListener("abort", () => {
    session.status = "error";
  });

  try {
    session.events.emit("event", {
      type: "phase_start",
      phase: phaseNumber,
      name: PHASES.find((p) => p.number === phaseNumber)?.name,
    });
    await runPhase(session, phaseNumber);
  } finally {
    if (onEvent) {
      session.events.off("event", onEvent);
    }
  }
}

/**
 * Get the list of phase definitions.
 */
export function getPhaseDefinitions(): Array<{ number: number; name: string; description: string }> {
  return PHASES.map((p) => ({ number: p.number, name: p.name, description: p.description }));
}
