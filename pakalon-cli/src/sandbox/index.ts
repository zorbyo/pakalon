/**
 * Sandbox Module — Barrel Export
 *
 * Exports all sandbox-related classes, types, and utilities for the
 * AIO Sandbox integration in the Pakalon 6-phase agent pipeline.
 *
 * Usage:
 *   import { sandboxLifecycleManager, PolicyEvaluator, SandboxDeployer } from '@/sandbox/index.js';
 */

export { SandboxLifecycleManager, sandboxLifecycleManager } from './lifecycle-manager.js';
export { loadSandboxState, clearSandboxState, isDockerAvailable, countProjectFiles, countDependencies, isApplicationLargeEnough, findDockerCmd, runDockerCommand, prePullSandboxImage, ensureSandboxNetwork, removeSandboxNetwork } from './lifecycle-manager.js';
export { SandboxDeployer } from './sandbox-deployer.js';
export { SandboxTester } from './sandbox-tester.js';
export { PolicyEvaluator } from './policy-evaluator.js';
export { SandboxMcpClient } from './mcp-client.js';

export type {
  // Enums
  SandboxStatus,
  // Sessions
  SandboxSession,
  SandboxStateFile,
  // Docker
  DockerStatus,
  // Deploy
  DeployOptions,
  DeployResult,
  // Testing
  TestOptions,
  TestResults,
  TestResultItem,
  // Policy
  PromotionPolicy,
  PolicyEvaluation,
  PolicyCheckResult,
  // MCP
  SandboxMcpTool,
} from './types.js';

export {
  DEFAULT_POLICY,
  SANDBOX_STATE_FILE,
  SANDBOX_STATE_DIR,
  DEFAULT_SANDBOX_PORT,
  DEFAULT_APP_PORT,
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_CONTAINER_NAME,
  MCP_ENDPOINT_PATH,
  HEALTH_CHECK_TIMEOUT_MS,
  PAKALON_SANDBOX_NETWORK,
  isSandboxUsableStatus,
} from './types.js';
