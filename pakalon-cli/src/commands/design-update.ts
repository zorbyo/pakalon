import fs from "fs/promises";
import path from "path";
import type { Dirent } from "node:fs";
import { penpotSync } from "../ai/penpot-sync.js";
import { resolvePenpotProjectState } from "../utils/penpot-state.js";
import type { CommandContext, CommandDefinition, CommandResult } from "./types.js";

export type DesignRiskLevel = "low" | "medium" | "high";

export interface DesignWireframeTarget {
  name: string;
  filePath: string | null;
  before: string;
  after: string;
  svgHints: string[];
  reason: string;
}

export interface DesignUpdatePlan {
  instruction: string;
  createdAt: string;
  projectDir: string;
  riskLevel: DesignRiskLevel;
  riskReasons: string[];
  targetWireframes: DesignWireframeTarget[];
  sharedSvgHints: string[];
  penpotProjectId: string | null;
  penpotFileId: string | null;
  syncRunning: boolean;
}

const DESIGN_KEYWORDS = [
  "color",
  "colors",
  "palette",
  "layout",
  "component",
  "components",
  "spacing",
  "space",
  "font",
  "typography",
  "type",
  "header",
  "hero",
  "sidebar",
  "button",
  "card",
  "form",
  "grid",
  "radius",
  "shadow",
  "alignment",
  "responsive",
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inferRiskLevel(instruction: string): { level: DesignRiskLevel; reasons: string[] } {
  const low = normalize(instruction);
  const reasons: string[] = [];

  if (/remove|delete|destroy|wipe|replace all|rewrite/i.test(low)) reasons.push("Instruction implies destructive design changes");
  if (/layout|spacing|typography|font|grid|responsive/i.test(low)) reasons.push("Touches layout primitives");
  if (/color|palette|theme|brand/i.test(low)) reasons.push("Touches visual system tokens");
  if (/component|header|sidebar|navigation|card|form/i.test(low)) reasons.push("Touches reusable UI components");

  const level: DesignRiskLevel = reasons.length >= 3 ? "high" : reasons.length >= 1 ? "medium" : "low";
  return { level, reasons };
}

function inferChangeNarrative(instruction: string): { before: string; after: string; hints: string[] } {
  const low = normalize(instruction);
  const hints: string[] = [];

  if (/color|palette|theme|brand/.test(low)) {
    hints.push("Select fill/stroke attributes and update palette tokens");
    hints.push("Adjust contrast for text and iconography");
  }
  if (/layout|grid|responsive|spacing/.test(low)) {
    hints.push("Move or resize major containers (x/y/width/height)");
    hints.push("Tune margins, padding, and gap spacing");
  }
  if (/font|typography|type/.test(low)) {
    hints.push("Update font-family, font-size, font-weight, and line-height");
  }
  if (/component|header|sidebar|card|form|button/.test(low)) {
    hints.push("Target the named component subtree for localized edits");
  }

  return {
    before: "Current wireframe layout and styling remain unchanged.",
    after: "Wireframes reflect the requested design modifications with updated SVG guidance for regeneration.",
    hints,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function walkSvgFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg") {
        results.push(absolute);
      }
    }
  }

  await visit(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

function matchesInstruction(instruction: string, fileName: string): boolean {
  const low = normalize(instruction);
  const name = normalize(fileName);
  return DESIGN_KEYWORDS.some((keyword) => low.includes(keyword) && name.includes(keyword));
}

function buildTargetPlan(instruction: string, svgPaths: string[]): DesignWireframeTarget[] {
  const low = normalize(instruction);
  const narrative = inferChangeNarrative(instruction);
  const matched = svgPaths.filter((svgPath) => matchesInstruction(low, path.basename(svgPath, ".svg")));
  const chosen = matched.length > 0 ? matched : svgPaths;

  return chosen.map((svgPath) => {
    const name = path.basename(svgPath, path.extname(svgPath));
    return {
      name,
      filePath: svgPath,
      before: narrative.before,
      after: `${narrative.after} Target: ${name}.`,
      svgHints: narrative.hints.length > 0 ? narrative.hints : ["Refine container geometry and element attributes"],
      reason: matched.length > 0 ? "Matched design keywords from instruction" : "Fallback target: no exact keyword match found",
    };
  });
}

function buildMarkdown(plan: DesignUpdatePlan): string {
  const lines: string[] = [];
  lines.push("# Design Update Plan");
  lines.push("");
  lines.push(`- Instruction: ${plan.instruction}`);
  lines.push(`- Created at: ${plan.createdAt}`);
  lines.push(`- Risk level: ${plan.riskLevel}`);
  lines.push(`- Penpot project: ${plan.penpotProjectId ?? "n/a"}`);
  lines.push(`- Penpot file: ${plan.penpotFileId ?? "n/a"}`);
  lines.push(`- Sync running: ${plan.syncRunning ? "yes" : "no"}`);
  lines.push("");

  if (plan.riskReasons.length > 0) {
    lines.push("## Risk reasons");
    for (const reason of plan.riskReasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  lines.push("## Target wireframes");
  for (const target of plan.targetWireframes) {
    lines.push(`### ${target.name}`);
    lines.push(`- File: ${target.filePath ?? "n/a"}`);
    lines.push(`- Why: ${target.reason}`);
    lines.push(`- Before: ${target.before}`);
    lines.push(`- After: ${target.after}`);
    lines.push("- SVG hints:");
    for (const hint of target.svgHints) lines.push(`  - ${hint}`);
    lines.push("");
  }

  lines.push("## Shared SVG hints");
  for (const hint of plan.sharedSvgHints) lines.push(`- ${hint}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeDesignUpdatePlan(projectDir: string, plan: DesignUpdatePlan): Promise<string> {
  const outputDir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, "design-update-plan.md");
  await fs.writeFile(outputPath, buildMarkdown(plan), "utf8");
  return outputPath;
}

export async function createDesignUpdatePlan(instruction: string, projectDir: string): Promise<DesignUpdatePlan> {
  const state = resolvePenpotProjectState(projectDir);
  const wireframeRoots = [
    path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2"),
    path.join(projectDir, ".pakalon-agents", "wireframes"),
  ];

  const svgFiles = (await Promise.all(wireframeRoots.map(async (root) => walkSvgFiles(root).catch(() => [])))).flat();
  const targets = buildTargetPlan(instruction, svgFiles);
  const risk = inferRiskLevel(instruction);
  const narratives = inferChangeNarrative(instruction);
  const sharedHints = Array.from(new Set([
    ...narratives.hints,
    "Preserve semantic structure so TDD screenshot comparison can verify the result",
    "Regenerate SVG assets before syncing to Penpot",
  ]));

  return {
    instruction,
    createdAt: new Date().toISOString(),
    projectDir,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    targetWireframes: targets,
    sharedSvgHints: sharedHints,
    penpotProjectId: state?.projectId ?? null,
    penpotFileId: state?.fileId ?? null,
    syncRunning: false,
  };
}

export async function call(
  onDone: (message: string, options?: { display?: string }) => void,
  context: Pick<CommandContext, "cwd">,
  args: string,
): Promise<null> {
  const instruction = args.trim();
  if (!instruction) {
    onDone("Usage: /design-update <instruction>", { display: "system" });
    return null;
  }

  const projectDir = context.cwd ?? process.cwd();
  const plan = await createDesignUpdatePlan(instruction, projectDir);

  try {
    const syncResult = await penpotSync.startSync({
      outputDir: projectDir,
      fileId: plan.penpotFileId ?? undefined,
      cooldownPeriod: Number(process.env.PENPOT_SYNC_COOLDOWN_MS ?? 30000),
    });
    plan.syncRunning = syncResult;
  } catch {
    plan.syncRunning = false;
  }

  const planPath = await writeDesignUpdatePlan(projectDir, plan);

  const summary = [
    `Design update plan created (${plan.riskLevel}).`,
    `Targets: ${plan.targetWireframes.map((target) => target.name).join(", ") || "none"}.`,
    `Plan file: ${planPath}`,
    plan.syncRunning ? "Penpot sync bridge is running." : "Penpot sync bridge could not be started.",
  ].join(" ");

  onDone(summary, { display: "system" });
  return null;
}

export const designUpdateCommand: CommandDefinition = {
  name: "design-update",
  description: "Apply a targeted wireframe/design update",
  usage: "/design-update <instruction>",
  category: "advanced",
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const instruction = args.join(" ").trim();
    if (!instruction) {
      return {
        success: false,
        message: "Usage: /design-update <instruction>",
      };
    }

    const projectDir = context.cwd ?? process.cwd();
    const plan = await createDesignUpdatePlan(instruction, projectDir);

    try {
      const syncResult = await penpotSync.startSync({
        outputDir: projectDir,
        fileId: plan.penpotFileId ?? undefined,
        cooldownPeriod: Number(process.env.PENPOT_SYNC_COOLDOWN_MS ?? 30000),
      });
      plan.syncRunning = syncResult;
    } catch {
      plan.syncRunning = false;
    }

    const planPath = await writeDesignUpdatePlan(projectDir, plan);
    return {
      success: true,
      message: [
        `Design update plan created (${plan.riskLevel}).`,
        `Targets: ${plan.targetWireframes.map((target) => target.name).join(", ") || "none"}.`,
        `Plan file: ${planPath}`,
        plan.syncRunning ? "Penpot sync bridge is running." : "Penpot sync bridge could not be started.",
      ].join(" "),
      data: {
        plan,
        planPath,
      },
    };
  },
};

export default designUpdateCommand;
