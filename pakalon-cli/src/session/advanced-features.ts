/**
 * Advanced Features
 * 
 * Thinking budgets, prompt templates, and resource provenance
 * inspired by pi's implementation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Thinking Budgets
// ─────────────────────────────────────────────────────────────────────────────

export interface ThinkingBudgets {
  minimal: number;
  low: number;
  medium: number;
  high: number;
  xhigh: number;
}

export const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
  minimal: 128,
  low: 512,
  medium: 1024,
  high: 2048,
  xhigh: 4096,
};

export function getThinkingBudget(level: string, budgets: ThinkingBudgets = DEFAULT_THINKING_BUDGETS): number {
  switch (level) {
    case "minimal": return budgets.minimal;
    case "low": return budgets.low;
    case "medium": return budgets.medium;
    case "high": return budgets.high;
    case "xhigh": return budgets.xhigh;
    default: return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Templates
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptTemplate {
  name: string;
  description?: string;
  content: string;
}

export function formatPromptTemplateInvocation(template: PromptTemplate, args: string[]): string {
  let content = template.content;
  
  // Replace argument placeholders
  for (let i = 0; i < args.length; i++) {
    content = content.replace(`$${i + 1}`, args[i]);
  }
  
  // Replace named placeholders
  content = content.replace(/\{\{args\}\}/g, args.join(" "));
  
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill Formatting
// ─────────────────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

export function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string {
  let content = `<skill name="${skill.name}">\n${skill.content}\n</skill>`;
  
  if (additionalInstructions) {
    content += `\n\nAdditional instructions:\n${additionalInstructions}`;
  }
  
  return content;
}

export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  
  const skillBlocks = skills
    .map((skill) => `<skill name="${skill.name}" description="${skill.description}" />`)
    .join("\n");
  
  return `<available_skills>\n${skillBlocks}\n</available_skills>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Provenance
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceProvenance {
  source: "file" | "config" | "runtime" | "hook";
  filePath?: string;
  loadedAt: Date;
  metadata?: Record<string, unknown>;
}

export class ResourceManager {
  private resources = new Map<string, { resource: unknown; provenance: ResourceProvenance }>();

  register<T>(key: string, resource: T, provenance: ResourceProvenance): void {
    this.resources.set(key, { resource, provenance });
  }

  get<T>(key: string): T | undefined {
    const entry = this.resources.get(key);
    return entry?.resource as T | undefined;
  }

  getProvenance(key: string): ResourceProvenance | undefined {
    return this.resources.get(key)?.provenance;
  }

  has(key: string): boolean {
    return this.resources.has(key);
  }

  list(): Array<{ key: string; provenance: ResourceProvenance }> {
    return Array.from(this.resources.entries()).map(([key, { provenance }]) => ({
      key,
      provenance,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Summary
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionSummary {
  additions: number;
  deletions: number;
  files: number;
  diffs?: string[];
}

export function calculateSessionSummary(
  entries: Array<{ type: string; content?: string }>
): SessionSummary {
  let additions = 0;
  let deletions = 0;
  const files = new Set<string>();
  const diffs: string[] = [];

  for (const entry of entries) {
    if (entry.type === "message" && entry.content) {
      // Simple heuristic for code changes
      const lines = entry.content.split("\n");
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++;
        }
      }

      // Extract file references
      const fileMatches = entry.content.match(/(?:\/[\w\-\.\/]+)+\.\w+/g);
      if (fileMatches) {
        for (const file of fileMatches) {
          files.add(file);
        }
      }
    }
  }

  return {
    additions,
    deletions,
    files: files.size,
    diffs: diffs.length > 0 ? diffs : undefined,
  };
}
