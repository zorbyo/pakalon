/**
 * Sandbox Types — Shared types and interfaces for the AIO Sandbox integration
 *
 * These types model the full sandbox lifecycle:
 *   provision → deploy → test → scan → evaluate → teardown
 */

// ---------------------------------------------------------------------------
// Core enum
// ---------------------------------------------------------------------------

export type SandboxStatus =
  | 'provisioning'
  | 'running'
  | 'deploying'
  | 'deployed'
  | 'testing'
  | 'tested'
  | 'scanning'
  | 'evaluating'
  | 'promoting'
  | 'loop_back'
  | 'destroying'
  | 'destroyed'
  | 'failed';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SandboxSession {
  sandboxId: string;
  containerId: string;
  containerName?: string;
  image?: string;
  url: string;
  mcpUrl: string;
  appUrl?: string;
  mcpHostPort: number;
  appPort: number;
  appHostPort: number;
  provisionedAt: string;
  updatedAt?: string;
  status: SandboxStatus;
  deployStatus?: DeployResult;
  testResults?: TestResults;
  policyResult?: PolicyEvaluation;
  iteration?: number;
  networkName?: string;
}

export interface SandboxStateFile {
  sandboxId: string;
  containerId: string;
  containerName?: string;
  image?: string;
  url: string;
  mcpUrl: string;
  appUrl?: string;
  mcpHostPort?: number;
  appPort?: number;
  appHostPort?: number;
  provisionedAt: string;
  updatedAt?: string;
  status: SandboxStatus;
  deployStatus?: DeployResult;
  testResults?: TestResults;
  policyResult?: PolicyEvaluation;
  iteration?: number;
  networkName?: string;
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

export interface DockerStatus {
  available: boolean;
  containerId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export interface DeployOptions {
  /** Directory of the built application */
  projectDir: string;
  /** Sandbox base URL */
  sandboxUrl: string;
  /** Build command to run inside sandbox (e.g. "npm run build") */
  buildCommand?: string;
  /** Start command to run the server (e.g. "npm start") */
  startCommand?: string;
  /** Health check path */
  healthEndpoint?: string;
  /** Port the application runs on inside the sandbox */
  appPort?: number;
  /** Extra environment variables to inject */
  env?: Record<string, string>;
}

export interface DeployResult {
  success: boolean;
  appUrl: string;
  serverPid?: string;
  message: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Testing
// ---------------------------------------------------------------------------

export interface TestOptions {
  sandboxUrl: string;
  projectDir: string;
  /** Test command to run (e.g. "npm test") */
  testCommand?: string;
  /** Specific test files or patterns */
  testPatterns?: string[];
  /** Timeout per test in ms */
  testTimeout?: number;
}

export interface TestResults {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResultItem[];
}

export interface TestResultItem {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface PromotionPolicy {
  promotion_criteria: {
    max_critical: number;
    max_high: number;
    max_medium: number;
    min_security_score: number;
    required_sast_coverage: number;
    require_sbom: boolean;
    require_dast: boolean;
  };
  actions: {
    on_failure: 'loop_back' | 'report_only' | 'block';
    loop_back_phase: number;
    max_loop_iterations: number;
  };
  sandbox?: {
    max_runtime_minutes: number;
    max_memory_mb: number;
    max_iterations: number;
    auto_cleanup: boolean;
  };
}

export interface PolicyEvaluation {
  passed: boolean;
  score: number;
  reasons: string[];
  details: PolicyCheckResult[];
}

export interface PolicyCheckResult {
  check: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  severity: 'error' | 'warning';
}

/** Default policy used when no security-policy.yml exists */
export const DEFAULT_POLICY: PromotionPolicy = {
  promotion_criteria: {
    max_critical: 0,
    max_high: 2,
    max_medium: 10,
    min_security_score: 70,
    required_sast_coverage: 80,
    require_sbom: true,
    require_dast: true,
  },
  actions: {
    on_failure: 'loop_back',
    loop_back_phase: 3,
    max_loop_iterations: 3,
  },
  sandbox: {
    max_runtime_minutes: 30,
    max_memory_mb: 1024,
    max_iterations: 5,
    auto_cleanup: true,
  },
};

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export type SandboxMcpTool =
  | 'browser_navigate'
  | 'browser_snapshot'
  | 'shell_exec'
  | 'file_read'
  | 'file_write';

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

export const SANDBOX_STATE_FILE = 'sandbox-state.json';
export const SANDBOX_STATE_DIR = '.pakalon-agents';
export const DEFAULT_SANDBOX_PORT = 8080;
export const DEFAULT_APP_PORT = 3000;
export const DEFAULT_SANDBOX_IMAGE = 'ghcr.io/agent-infra/sandbox:latest';
export const DEFAULT_CONTAINER_NAME = 'pakalon-sandbox';
export const MCP_ENDPOINT_PATH = '/mcp';
export const HEALTH_CHECK_TIMEOUT_MS = 120_000;
export const HEALTH_CHECK_INTERVAL_MS = 3_000;

/** Name of the shared Docker network for sandbox + DAST containers. */
export const PAKALON_SANDBOX_NETWORK = 'pakalon-sandbox-net';

export const SANDBOX_USABLE_STATUSES: readonly SandboxStatus[] = [
  'running',
  'deploying',
  'deployed',
  'testing',
  'tested',
  'scanning',
  'evaluating',
  'promoting',
];

export function isSandboxUsableStatus(status: SandboxStatus): boolean {
  return SANDBOX_USABLE_STATUSES.includes(status);
}
