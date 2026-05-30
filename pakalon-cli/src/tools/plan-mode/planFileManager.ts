/**
 * Plan File Manager
 *
 * Manages plan files for the planning system - creating, reading,
 * updating, and organizing plan documents.
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '@/utils/logger.js';

/**
 * Plan phase.
 */
export interface PlanPhase {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description: string;
}

/**
 * Plan file.
 */
export interface PlanFile {
  id: string;
  name: string;
  content: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  createdAt: number;
  updatedAt: number;
  phases: PlanPhase[];
}

/**
 * Manages plan files for project planning.
 */
export class PlanFileManager {
  private plansDir: string;

  constructor(projectDir?: string) {
    this.plansDir = path.join(projectDir ?? process.cwd(), '.pakalon', 'plans');
    this.ensureDir();
  }

  /**
   * Create a new plan.
   */
  createPlan(name: string, content: string, phases?: PlanPhase[]): PlanFile {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const plan: PlanFile = {
      id,
      name,
      content,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      phases: phases ?? [],
    };

    this.savePlan(plan);
    logger.info('[PlanFileManager] Created plan', { id, name });
    return plan;
  }

  /**
   * Get a plan by ID.
   */
  getPlan(planId: string): PlanFile | null {
    const planPath = this.getPlanPath(planId);
    try {
      if (fs.existsSync(planPath)) {
        const data = fs.readFileSync(planPath, 'utf-8');
        return JSON.parse(data) as PlanFile;
      }
    } catch (err) {
      logger.warn('[PlanFileManager] Failed to load plan', { planId, error: String(err) });
    }
    return null;
  }

  /**
   * List all plans.
   */
  listPlans(): PlanFile[] {
    const plans: PlanFile[] = [];
    try {
      if (fs.existsSync(this.plansDir)) {
        const files = fs.readdirSync(this.plansDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const planPath = path.join(this.plansDir, file);
            const data = fs.readFileSync(planPath, 'utf-8');
            plans.push(JSON.parse(data) as PlanFile);
          }
        }
      }
    } catch (err) {
      logger.warn('[PlanFileManager] Failed to list plans', { error: String(err) });
    }
    return plans.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Update a plan.
   */
  updatePlan(planId: string, updates: Partial<PlanFile>): PlanFile | null {
    const existing = this.getPlan(planId);
    if (!existing) return null;

    const updated: PlanFile = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      updatedAt: Date.now(),
    };

    this.savePlan(updated);
    return updated;
  }

  /**
   * Delete a plan.
   */
  deletePlan(planId: string): boolean {
    try {
      const planPath = this.getPlanPath(planId);
      if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
        logger.info('[PlanFileManager] Deleted plan', { planId });
        return true;
      }
    } catch (err) {
      logger.warn('[PlanFileManager] Failed to delete plan', { planId, error: String(err) });
    }
    return false;
  }

  /**
   * Export a plan in the specified format.
   */
  exportPlan(planId: string, format: 'md' | 'json'): string | null {
    const plan = this.getPlan(planId);
    if (!plan) return null;

    if (format === 'json') {
      return JSON.stringify(plan, null, 2);
    }

    // Markdown format
    const lines: string[] = [
      `# ${plan.name}`,
      '',
      `**Status:** ${plan.status}`,
      `**Created:** ${new Date(plan.createdAt).toISOString()}`,
      `**Updated:** ${new Date(plan.updatedAt).toISOString()}`,
      '',
      '## Content',
      '',
      plan.content,
      '',
    ];

    if (plan.phases.length > 0) {
      lines.push('## Phases', '');
      for (const phase of plan.phases) {
        lines.push(`### ${phase.name} (${phase.status})`);
        lines.push('');
        lines.push(phase.description);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ── Internal helpers ──

  private savePlan(plan: PlanFile): void {
    this.ensureDir();
    const planPath = this.getPlanPath(plan.id);
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');
  }

  private getPlanPath(planId: string): string {
    return path.join(this.plansDir, `${planId}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.plansDir)) {
      fs.mkdirSync(this.plansDir, { recursive: true });
    }
  }
}

// Singleton instance
let _instance: PlanFileManager | null = null;

/**
 * Get the global plan file manager.
 */
export function getPlanFileManager(projectDir?: string): PlanFileManager {
  if (!_instance) {
    _instance = new PlanFileManager(projectDir);
  }
  return _instance;
}
