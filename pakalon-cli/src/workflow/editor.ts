/**
 * Workflow editor — pure TypeScript YAML generation + file I/O.
 * Replaces Python bridge /workflow/* endpoints.
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface WorkflowJob {
  name: string;
  runsOn: string;
  steps: WorkflowStep[];
  needs?: string[];
  env?: Record<string, string>;
}

export interface WorkflowConfig {
  name: string;
  on: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
  env?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new workflow config.
 */
export function createWorkflow(name: string, trigger?: { on?: Record<string, unknown> }): WorkflowConfig {
  return {
    name,
    on: trigger?.on ?? { push: { branches: ["main"] } } as Record<string, unknown>,
    jobs: {},
  };
}

/**
 * Add a job to a workflow.
 */
export function addJob(
  workflow: WorkflowConfig,
  jobId: string,
  job: WorkflowJob,
): WorkflowConfig {
  return {
    ...workflow,
    jobs: { ...workflow.jobs, [jobId]: job },
  };
}

/**
 * Add a step to a job.
 */
export function addStep(
  workflow: WorkflowConfig,
  jobId: string,
  step: WorkflowStep,
): WorkflowConfig {
  const job = workflow.jobs[jobId];
  if (!job) return workflow;

  return {
    ...workflow,
    jobs: {
      ...workflow.jobs,
      [jobId]: { ...job, steps: [...job.steps, step] },
    },
  };
}

/**
 * Delete a job from a workflow.
 */
export function deleteJob(workflow: WorkflowConfig, jobId: string): WorkflowConfig {
  const { [jobId]: _, ...rest } = workflow.jobs;
  return { ...workflow, jobs: rest };
}

/**
 * Validate a workflow config.
 */
export function validateWorkflow(workflow: WorkflowConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!workflow.name) errors.push("Workflow name is required");
  if (Object.keys(workflow.jobs).length === 0) errors.push("At least one job is required");

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (!job.runsOn) errors.push(`Job '${jobId}' is missing runsOn`);
    if (job.steps.length === 0) warnings.push(`Job '${jobId}' has no steps`);

    for (const step of job.steps) {
      if (!step.name) warnings.push(`Step in job '${jobId}' is missing a name`);
      if (!step.uses && !step.run) {
        errors.push(`Step '${step.name}' in job '${jobId}' must have 'uses' or 'run'`);
      }
    }

    // Check for circular dependencies
    if (job.needs) {
      for (const dep of job.needs) {
        if (!workflow.jobs[dep]) {
          errors.push(`Job '${jobId}' depends on '${dep}' which does not exist`);
        }
        if (workflow.jobs[dep]?.needs?.includes(jobId)) {
          errors.push(`Circular dependency between '${jobId}' and '${dep}'`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Convert workflow to YAML string.
 */
export function toYaml(workflow: WorkflowConfig): string {
  return yaml.dump(workflow, { noRefs: true, lineWidth: 120 });
}

/**
 * Parse workflow from YAML string.
 */
export function fromYaml(yamlStr: string): WorkflowConfig {
  return yaml.load(yamlStr) as WorkflowConfig;
}

/**
 * Write workflow to .github/workflows/ directory.
 */
export function writeWorkflow(projectDir: string, filename: string, workflow: WorkflowConfig): string {
  const workflowsDir = path.join(projectDir, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const filePath = path.join(workflowsDir, filename.endsWith(".yml") ? filename : `${filename}.yml`);
  fs.writeFileSync(filePath, toYaml(workflow), "utf-8");

  return filePath;
}

/**
 * Read workflow from .github/workflows/ directory.
 */
export function readWorkflow(projectDir: string, filename: string): WorkflowConfig | null {
  const filePath = path.join(projectDir, ".github", "workflows", filename.endsWith(".yml") ? filename : `${filename}.yml`);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return fromYaml(content);
  } catch {
    return null;
  }
}

/**
 * List all workflows in a project.
 */
export function listWorkflows(projectDir: string): string[] {
  const workflowsDir = path.join(projectDir, ".github", "workflows");
  try {
    if (!fs.existsSync(workflowsDir)) return [];
    return fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return [];
  }
}

/**
 * Dry-run a workflow (validate + show what would happen).
 */
export function dryRun(workflow: WorkflowConfig): ValidationResult & { yaml: string } {
  const validation = validateWorkflow(workflow);
  return { ...validation, yaml: toYaml(workflow) };
}
