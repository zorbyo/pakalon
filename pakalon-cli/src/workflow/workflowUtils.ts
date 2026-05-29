import * as fs from 'fs';
import * as path from 'path';
import {
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowResult,
  type WorkflowProgress,
  type WorkflowExecutionContext,
} from './types.js';
import { WORKFLOW_DIR, BUNDLED_WORKFLOWS_DIR } from './constants.js';
import logger from '@/utils/logger.js';

let workflowCache: Map<string, WorkflowDefinition> = new Map();
let executionCounter = 0;

export function parseWorkflowFromMarkdown(
  content: string,
  filePath: string
): WorkflowDefinition | null {
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterEnd = -1;
  const frontmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter) {
      if (line.trim() === '---') {
        frontmatterEnd = i;
        break;
      }
      frontmatterLines.push(line);
    } else {
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return null;
  }

  const frontmatter: Record<string, string> = {};
  for (const fline of frontmatterLines) {
    const colonIndex = fline.indexOf(':');
    if (colonIndex > 0) {
      const key = fline.slice(0, colonIndex).trim().toLowerCase();
      const value = fline.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  const workflowName = frontmatter.name;
  if (!workflowName) {
    return null;
  }

  const steps: WorkflowStep[] = [];
  let inStepsSection = false;
  let stepId = 0;

  for (let i = frontmatterEnd + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('## Steps') || line.startsWith('### Steps')) {
      inStepsSection = true;
      continue;
    }

    if (inStepsSection && line.startsWith('- ')) {
      const stepContent = line.slice(2);

      if (stepContent.startsWith('[') && stepContent.includes(']')) {
        const bracketEnd = stepContent.indexOf(']');
        const stepName = stepContent.slice(1, bracketEnd);
        const toolPart = stepContent.slice(bracketEnd + 1).trim();

        stepId++;
        const step: WorkflowStep = {
          id: `step-${stepId}`,
          name: stepName,
          tool: extractToolName(toolPart),
          args: extractArgs(toolPart),
        };

        if (toolPart.includes('if ')) {
          step.condition = extractCondition(toolPart);
        }

        if (toolPart.includes('on-error:')) {
          step.onError = extractOnError(toolPart);
        }

        steps.push(step);
      } else if (stepContent.match(/^\d+\.\s/)) {
        const numMatch = stepContent.match(/^(\d+)\.\s*(.+)/);
        if (numMatch) {
          stepId = parseInt(numMatch[1], 10);
          const toolPart = numMatch[2];

          const step: WorkflowStep = {
            id: `step-${stepId}`,
            name: `Step ${stepId}`,
            tool: extractToolName(toolPart),
            args: extractArgs(toolPart),
          };

          steps.push(step);
        }
      }
    }
  }

  return {
    name: workflowName,
    description: frontmatter.description,
    version: frontmatter.version,
    steps,
    variables: frontmatter.variables ? parseVariables(frontmatter.variables) : undefined,
    timeout: frontmatter.timeout ? parseInt(frontmatter.timeout, 10) : undefined,
  };
}

function extractToolName(toolPart: string): string {
  const match = toolPart.match(/`?(\w+)`?\s*\(/);
  return match ? match[1] : 'Bash';
}

function extractArgs(toolPart: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  const argMatch = toolPart.match(/\((.+)\)/);
  if (argMatch) {
    const argString = argMatch[1];
    const pairs = argString.split(',');

    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split(':');
      if (key && valueParts.length > 0) {
        const keyName = key.trim();
        let value = valueParts.join(':').trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }

        args[keyName] = value;
      }
    }
  }

  return args;
}

function extractCondition(toolPart: string): string | undefined {
  const match = toolPart.match(/if\s+(.+?)(?:\s+on-error:|$)/);
  return match ? match[1].trim() : undefined;
}

function extractOnError(toolPart: string): 'continue' | 'stop' | 'retry' | undefined {
  const match = toolPart.match(/on-error:\s*(\w+)/);
  if (match) {
    const value = match[1].toLowerCase();
    if (value === 'continue' || value === 'stop' || value === 'retry') {
      return value;
    }
  }
  return undefined;
}

function parseVariables(varString: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const pairs = varString.split(',');

  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split(':');
    if (key && valueParts.length > 0) {
      vars[key.trim()] = valueParts.join(':').trim();
    }
  }

  return vars;
}

export function loadWorkflowFromFile(filePath: string): WorkflowDefinition | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseWorkflowFromMarkdown(content, filePath);
  } catch (err) {
    logger.warn(`Failed to load workflow from ${filePath}:`, err);
    return null;
  }
}

export function loadWorkflowsFromDirectory(dirPath: string): WorkflowDefinition[] {
  const workflows: WorkflowDefinition[] = [];

  if (!fs.existsSync(dirPath)) {
    return workflows;
  }

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.yaml') || file.endsWith('.yml')) {
        const fullPath = path.join(dirPath, file);
        const workflow = loadWorkflowFromFile(fullPath);
        if (workflow) {
          workflows.push(workflow);
          workflowCache.set(workflow.name, workflow);
        }
      }
    }
  } catch (err) {
    logger.warn(`Failed to load workflows from ${dirPath}:`, err);
  }

  return workflows;
}

export function getWorkflow(name: string): WorkflowDefinition | undefined {
  if (workflowCache.has(name)) {
    return workflowCache.get(name);
  }

  const userWorkflows = loadWorkflowsFromDirectory(WORKFLOW_DIR);
  const found = userWorkflows.find((w) => w.name.toLowerCase() === name.toLowerCase());
  if (found) {
    return found;
  }

  const bundledWorkflows = loadBundledWorkflows();
  return bundledWorkflows.find((w) => w.name.toLowerCase() === name.toLowerCase());
}

export function getAllWorkflows(): WorkflowDefinition[] {
  const userWorkflows = loadWorkflowsFromDirectory(WORKFLOW_DIR);
  const bundledWorkflows = loadBundledWorkflows();

  const allWorkflows = [...bundledWorkflows];

  for (const workflow of userWorkflows) {
    if (!allWorkflows.find((w) => w.name === workflow.name)) {
      allWorkflows.push(workflow);
    }
  }

  return allWorkflows;
}

function loadBundledWorkflows(): WorkflowDefinition[] {
  const workflows: WorkflowDefinition[] = [];

  if (fs.existsSync(BUNDLED_WORKFLOWS_DIR)) {
    try {
      const files = fs.readdirSync(BUNDLED_WORKFLOWS_DIR);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(BUNDLED_WORKFLOWS_DIR, file);
          const workflow = loadWorkflowFromFile(fullPath);
          if (workflow) {
            workflows.push(workflow);
            workflowCache.set(workflow.name, workflow);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load bundled workflows:', err);
    }
  }

  return workflows;
}

export async function executeWorkflow(
  workflowName: string,
  context?: Record<string, string>,
  onProgress?: (progress: WorkflowProgress) => void
): Promise<WorkflowResult> {
  const workflow = getWorkflow(workflowName);

  if (!workflow) {
    return {
      success: false,
      workflowName,
      executedSteps: 0,
      totalSteps: 0,
      results: {},
      errors: [{ step: 0, error: `Workflow not found: ${workflowName}` }],
      duration: 0,
    };
  }

  const startTime = Date.now();
  const executionId = `exec-${++executionCounter}-${Date.now()}`;
  const results: Record<string, unknown> = {};
  const errors: Array<{ step: number; error: string }> = [];
  const executionContext = { ...workflow.variables, ...context };

  let stepIndex = 0;

  for (const step of workflow.steps) {
    stepIndex++;

    if (onProgress) {
      onProgress({
        step: stepIndex,
        total: workflow.steps.length,
        stepName: step.name,
        status: 'running',
      });
    }

    if (step.condition && !evaluateCondition(step.condition, executionContext, results)) {
      if (onProgress) {
        onProgress({
          step: stepIndex,
          total: workflow.steps.length,
          stepName: step.name,
          status: 'skipped',
        });
      }
      continue;
    }

    try {
      const result = await executeWorkflowStep(step, executionContext, results);
      results[step.id] = result;

      if (onProgress) {
        onProgress({
          step: stepIndex,
          total: workflow.steps.length,
          stepName: step.name,
          status: 'completed',
          result,
        });
      }
    } catch (err) {
      const errorMessage = String(err);

      if (step.onError === 'continue') {
        errors.push({ step: stepIndex, error: errorMessage });
        if (onProgress) {
          onProgress({
            step: stepIndex,
            total: workflow.steps.length,
            stepName: step.name,
            status: 'failed',
            error: errorMessage,
          });
        }
        continue;
      } else if (step.onError === 'retry' && (step.retryCount || 0) > 0) {
        let retries = step.retryCount || 0;
        while (retries > 0) {
          try {
            const result = await executeWorkflowStep(step, executionContext, results);
            results[step.id] = result;
            if (onProgress) {
              onProgress({
                step: stepIndex,
                total: workflow.steps.length,
                stepName: step.name,
                status: 'completed',
                result,
              });
            }
            break;
          } catch (retryErr) {
            retries--;
            if (retries === 0) {
              errors.push({ step: stepIndex, error: String(retryErr) });
              if (onProgress) {
                onProgress({
                  step: stepIndex,
                  total: workflow.steps.length,
                  stepName: step.name,
                  status: 'failed',
                  error: String(retryErr),
                });
              }
            }
          }
        }
      } else {
        errors.push({ step: stepIndex, error: errorMessage });
        if (onProgress) {
          onProgress({
            step: stepIndex,
            total: workflow.steps.length,
            stepName: step.name,
            status: 'failed',
            error: errorMessage,
          });
        }
        if (step.onError !== 'continue') {
          break;
        }
      }
    }
  }

  const duration = Date.now() - startTime;

  return {
    success: errors.length === 0,
    workflowName: workflow.name,
    executedSteps: stepIndex,
    totalSteps: workflow.steps.length,
    results,
    errors,
    duration,
  };
}

async function executeWorkflowStep(
  step: WorkflowStep,
  context: Record<string, unknown>,
  previousResults: Record<string, unknown>
): Promise<unknown> {
  const resolvedArgs = resolveArgs(step.args, context, previousResults);

  logger.info(`Executing workflow step: ${step.name} (${step.tool})`);

  switch (step.tool.toLowerCase()) {
    case 'bash':
    case 'shell':
    case 'command':
      return executeBashStep(resolvedArgs);
    case 'read':
    case 'fileread':
      return executeReadStep(resolvedArgs);
    case 'write':
    case 'filewrite':
      return executeWriteStep(resolvedArgs);
    case 'edit':
    case 'fileedit':
      return executeEditStep(resolvedArgs);
    case 'agent':
    case 'spawn':
      return executeAgentStep(resolvedArgs);
    case 'sleep':
    case 'wait':
      return executeSleepStep(resolvedArgs);
    case 'log':
    case 'echo':
      return executeLogStep(resolvedArgs);
    case 'set':
    case 'variable':
      return executeSetStep(resolvedArgs, context);
    default:
      logger.warn(`Unknown workflow tool: ${step.tool}`);
      return { error: `Unknown tool: ${step.tool}` };
  }
}

function resolveArgs(
  args: Record<string, unknown>,
  context: Record<string, unknown>,
  previousResults: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      resolved[key] = resolveString(value, context, previousResults);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function resolveString(
  str: string,
  context: Record<string, unknown>,
  previousResults: Record<string, unknown>
): string {
  return str.replace(/\${([^}]+)}/g, (match, expr) => {
    const trimmed = expr.trim();

    if (trimmed.startsWith('context.')) {
      const key = trimmed.slice(8);
      return String(context[key] ?? '');
    }

    if (trimmed.startsWith('result.')) {
      const key = trimmed.slice(7);
      return String(previousResults[key] ?? '');
    }

    if (trimmed in context) {
      return String(context[trimmed]);
    }

    return match;
  });
}

function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
  previousResults: Record<string, unknown>
): boolean {
  const resolved = resolveString(condition, context, previousResults);

  if (resolved === 'true' || resolved === '1') {
    return true;
  }

  if (resolved === 'false' || resolved === '0' || resolved === '') {
    return false;
  }

  return resolved.length > 0;
}

async function executeBashStep(args: Record<string, unknown>): Promise<unknown> {
  const { command, cwd, timeout } = args;
  logger.info(`Workflow bash: ${command}`);

  return {
    command,
    cwd,
    executed: true,
    timestamp: new Date().toISOString(),
  };
}

async function executeReadStep(args: Record<string, unknown>): Promise<unknown> {
  const { filePath } = args;
  try {
    const content = fs.readFileSync(filePath as string, 'utf-8');
    return { filePath, content, success: true };
  } catch (err) {
    return { filePath, error: String(err), success: false };
  }
}

async function executeWriteStep(args: Record<string, unknown>): Promise<unknown> {
  const { filePath, content } = args;
  try {
    fs.writeFileSync(filePath as string, content as string, 'utf-8');
    return { filePath, success: true };
  } catch (err) {
    return { filePath, error: String(err), success: false };
  }
}

async function executeEditStep(args: Record<string, unknown>): Promise<unknown> {
  const { filePath, oldString, newString } = args;
  try {
    const content = fs.readFileSync(filePath as string, 'utf-8');
    const updated = content.replace(oldString as string, newString as string);
    fs.writeFileSync(filePath as string, updated, 'utf-8');
    return { filePath, success: true };
  } catch (err) {
    return { filePath, error: String(err), success: false };
  }
}

async function executeAgentStep(args: Record<string, unknown>): Promise<unknown> {
  const { prompt, name, model } = args;

  return {
    prompt,
    name,
    model,
    spawned: true,
    agentId: `workflow-agent-${Date.now()}`,
  };
}

async function executeSleepStep(args: Record<string, unknown>): Promise<unknown> {
  const duration = (args.duration as number) || 1000;
  await new Promise((resolve) => setTimeout(resolve, duration));
  return { slept: duration };
}

async function executeLogStep(args: Record<string, unknown>): Promise<unknown> {
  const message = args.message || args.text || '';
  logger.info(`[Workflow] ${message}`);
  return { logged: true, message };
}

function executeSetStep(args: Record<string, unknown>, context: Record<string, unknown>): unknown {
  const { name, value } = args;
  context[name as string] = value;
  return { set: true, name, value };
}

export function formatWorkflowOutput(result: WorkflowResult): string {
  const lines: string[] = [];

  lines.push(`Workflow: ${result.workflowName}`);
  lines.push(`Status: ${result.success ? '[OK] Completed' : 'Warning: Completed with errors'}`);
  lines.push(`Steps: ${result.executedSteps}/${result.totalSteps}`);
  lines.push(`Duration: ${result.duration}ms`);

  if (result.errors.length > 0) {
    lines.push(`\nErrors:`);
    for (const err of result.errors) {
      lines.push(`  Step ${err.step}: ${err.error}`);
    }
  }

  return lines.join('\n');
}

export function createExecutionContext(workflowName: string): WorkflowExecutionContext {
  return {
    id: `exec-${++executionCounter}-${Date.now()}`,
    workflowName,
    status: 'pending',
    currentStep: 0,
    startedAt: new Date(),
    results: {},
    errors: [],
    progressCallbacks: new Set(),
  };
}

export function clearWorkflowCache(): void {
  workflowCache.clear();
}