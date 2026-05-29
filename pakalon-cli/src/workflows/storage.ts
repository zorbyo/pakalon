/**
 * Workflow Persistence Layer
 * Handles reading/writing workflows to JSON file and SQLite database.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { debugLog } from "@/utils/logger.js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.js";
import { workflows as workflowsTable } from "@/db/schema.js";
import type { Workflow, WorkflowStep, StepType } from "./types.js";

function workflowsPath(): string {
  return path.join(os.homedir(), ".config", "pakalon", "workflows.json");
}

function migrateWorkflow(wf: Workflow): Workflow {
  if (!wf.steps?.length && wf.prompts?.length) {
    return {
      ...wf,
      steps: wf.prompts.map((p) => ({
        type: "prompt" as StepType,
        content: p,
        label: p.slice(0, 60),
      })),
    };
  }
  return wf;
}

export function readWorkflows(): Workflow[] {
  try {
    const raw = fs.readFileSync(workflowsPath(), "utf-8");
    const list = JSON.parse(raw) as Workflow[];
    return list.map(migrateWorkflow);
  } catch {
    return [];
  }
}

export function writeWorkflows(workflows: Workflow[]): void {
  const filePath = workflowsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(workflows, null, 2), "utf-8");
}

export function getWorkflow(name: string): Workflow | null {
  const workflows = readWorkflows();
  return workflows.find((w) => w.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export function saveWorkflow(workflow: Workflow): void {
  const workflows = readWorkflows();
  const existing = workflows.findIndex((w) => w.name.toLowerCase() === workflow.name.toLowerCase());

  if (existing >= 0) {
    workflows[existing] = workflow;
  } else {
    workflows.push(workflow);
  }

  writeWorkflows(workflows);
  syncWorkflowToDb(workflow);
  debugLog(`[workflows] Saved workflow: ${workflow.name}`);
}

export function deleteWorkflow(name: string): boolean {
  const workflows = readWorkflows();
  const idx = workflows.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;

  workflows.splice(idx, 1);
  writeWorkflows(workflows);
  debugLog(`[workflows] Deleted workflow: ${name}`);
  return true;
}

export function markWorkflowUsed(name: string): void {
  const workflows = readWorkflows();
  const idx = workflows.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    workflows[idx]!.lastUsedAt = new Date().toISOString();
    writeWorkflows(workflows);
    syncWorkflowToDb(workflows[idx]!);
  }
}

function syncWorkflowToDb(wf: Workflow): void {
  try {
    const db = getDb();
    db.insert(workflowsTable)
      .values({
        id: wf.id,
        name: wf.name,
        description: wf.description ?? "",
        steps: JSON.stringify(wf.steps ?? []),
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt ?? new Date().toISOString(),
        lastUsedAt: wf.lastUsedAt ?? null,
        schedule: wf.schedule ? JSON.stringify(wf.schedule) : "",
        tags: JSON.stringify(wf.tags ?? []),
        prompts: JSON.stringify(wf.prompts ?? []),
      })
      .onConflictDoUpdate({
        target: workflowsTable.id,
        set: {
          name: wf.name,
          description: wf.description ?? "",
          steps: JSON.stringify(wf.steps ?? []),
          updatedAt: wf.updatedAt ?? new Date().toISOString(),
          lastUsedAt: wf.lastUsedAt ?? null,
          schedule: wf.schedule ? JSON.stringify(wf.schedule) : "",
          tags: JSON.stringify(wf.tags ?? []),
          prompts: JSON.stringify(wf.prompts ?? []),
        },
      })
      .run();
    debugLog(`[workflows] SQLite upsert: ${wf.name}`);
  } catch (err: any) {
    debugLog(`[workflows] SQLite sync failed (non-fatal): ${err?.message}`);
  }
}

export function getWorkflowsByTag(tag: string): Workflow[] {
  return readWorkflows().filter((wf) => wf.tags?.includes(tag));
}

export function getScheduledWorkflows(): Workflow[] {
  return readWorkflows().filter((wf) => wf.schedule?.enabled);
}

export function markScheduleRun(name: string): void {
  const workflows = readWorkflows();
  const idx = workflows.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0 && workflows[idx]!.schedule) {
    workflows[idx]!.schedule!.lastRun = new Date().toISOString();
    writeWorkflows(workflows);
  }
}
