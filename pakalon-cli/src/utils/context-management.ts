/**
 * Context Management Utility
 * Generates context management documentation for each phase.
 * Shows token allocation, usage, and recommendations.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface PhaseContextBudget {
  phase: number;
  phaseName: string;
  allocatedTokens: number;
  usedTokens: number;
  remainingTokens: number;
  bufferTokens: number;
  files: string[];
  recommendations: string[];
}

export interface ContextManagementReport {
  totalContextWindow: number;
  systemPromptTokens: number;
  bufferPercent: number;
  phases: PhaseContextBudget[];
  totalAllocated: number;
  totalUsed: number;
  totalRemaining: number;
  generatedAt: string;
}

const PHASE_NAMES: Record<number, string> = {
  1: "Planning & Requirements",
  2: "Wireframes & Design",
  3: "Development",
  4: "Security Scanning",
  5: "CI/CD & Deployment",
  6: "Documentation",
};

const DEFAULT_PHASE_ALLOCATIONS: Record<number, number> = {
  1: 0.10,
  2: 0.15,
  3: 0.40,
  4: 0.15,
  5: 0.10,
  6: 0.10,
};

export function calculateContextBudget(
  totalContextWindow: number,
  systemPromptTokens: number,
  bufferPercent = 0.10
): ContextManagementReport {
  const usableTokens = Math.floor(totalContextWindow * (1 - bufferPercent));

  const phases: PhaseContextBudget[] = [];

  for (let phase = 1; phase <= 6; phase++) {
    const allocation = DEFAULT_PHASE_ALLOCATIONS[phase] || 0.10;
    const allocatedTokens = Math.floor(usableTokens * allocation);

    phases.push({
      phase,
      phaseName: PHASE_NAMES[phase] || `Phase ${phase}`,
      allocatedTokens,
      usedTokens: 0,
      remainingTokens: allocatedTokens,
      bufferTokens: 0,
      files: [],
      recommendations: [],
    });
  }

  const totalAllocated = phases.reduce((sum, p) => sum + p.allocatedTokens, 0);
  const totalUsed = phases.reduce((sum, p) => sum + p.usedTokens, 0);
  const totalRemaining = phases.reduce((sum, p) => sum + p.remainingTokens, 0);

  return {
    totalContextWindow,
    systemPromptTokens,
    bufferPercent,
    phases,
    totalAllocated,
    totalUsed,
    totalRemaining,
    generatedAt: new Date().toISOString(),
  };
}

export function formatContextManagementMarkdown(report: ContextManagementReport): string {
  const lines: string[] = [
    "# Context Management Report",
    "",
    `**Generated:** ${report.generatedAt}`,
    `**Total Context Window:** ${report.totalContextWindow.toLocaleString()} tokens`,
    `**System Prompt:** ${report.systemPromptTokens.toLocaleString()} tokens`,
    `**Buffer:** ${(report.bufferPercent * 100).toFixed(0)}%`,
    "",
    "---",
    "",
    "## Phase Token Allocations",
    "",
    "| Phase | Name | Allocated | Used | Remaining |",
    "|-------|------|-----------|------|-----------|",
  ];

  for (const phase of report.phases) {
    const usagePct = phase.allocatedTokens > 0
      ? ((phase.usedTokens / phase.allocatedTokens) * 100).toFixed(1)
      : "0.0";
    lines.push(
      `| ${phase.phase} | ${phase.phaseName} | ${phase.allocatedTokens.toLocaleString()} | ` +
      `${phase.usedTokens.toLocaleString()} (${usagePct}%) | ${phase.remainingTokens.toLocaleString()} |`
    );
  }

  lines.push("", "| **Total** | | " +
    `${report.totalAllocated.toLocaleString()} | ` +
    `${report.totalUsed.toLocaleString()} | ` +
    `${report.totalRemaining.toLocaleString()} |`);

  lines.push("", "---", "", "## Token Budget Distribution");

  const chartWidth = 40;
  for (const phase of report.phases) {
    const pct = phase.allocatedTokens / report.totalAllocated;
    const filled = Math.round(pct * chartWidth);
    const bar = "█".repeat(filled) + "░".repeat(chartWidth - filled);
    lines.push(`| ${phase.phase} | ${bar} | ${(pct * 100).toFixed(1)}% |`);
  }

  lines.push("", "---", "", "## Phase Details");

  for (const phase of report.phases) {
    lines.push("");
    lines.push(`### Phase ${phase.phase}: ${phase.phaseName}`);
    lines.push("");
    lines.push(`- **Allocated:** ${phase.allocatedTokens.toLocaleString()} tokens`);
    lines.push(`- **Used:** ${phase.usedTokens.toLocaleString()} tokens`);
    lines.push(`- **Remaining:** ${phase.remainingTokens.toLocaleString()} tokens`);

    if (phase.files.length > 0) {
      lines.push("");
      lines.push("**Files in context:**");
      for (const file of phase.files.slice(0, 20)) {
        lines.push(`  - ${file}`);
      }
      if (phase.files.length > 20) {
        lines.push(`  - ... and ${phase.files.length - 20} more files`);
      }
    }

    if (phase.recommendations.length > 0) {
      lines.push("");
      lines.push("**Recommendations:**");
      for (const rec of phase.recommendations) {
        lines.push(`  - ${rec}`);
      }
    }
  }

  lines.push("", "---", "", "## Summary");

  const overallUsage = report.totalContextWindow > 0
    ? ((report.totalUsed / report.totalContextWindow) * 100).toFixed(1)
    : "0.0";

  lines.push("");
  lines.push(`Total context window utilization: **${overallUsage}%**`);
  lines.push("");

  if (report.totalRemaining < report.totalContextWindow * 0.1) {
    lines.push("Warning: **Warning:** Less than 10% context remaining. Consider compacting or starting a new session.");
  }

  return lines.join("\n");
}

export async function generateContextManagementFile(
  projectDir: string,
  report: ContextManagementReport
): Promise<string> {
  const outputPath = path.join(projectDir, ".pakalon-agents", "context-management.md");
  const markdown = formatContextManagementMarkdown(report);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, "utf-8");

  return outputPath;
}

export async function updatePhaseContextUsage(
  projectDir: string,
  phase: number,
  usedTokens: number,
  files: string[]
): Promise<void> {
  const reportPath = path.join(projectDir, ".pakalon-agents", "context-management.md");

  try {
    const existingContent = await fs.readFile(reportPath, "utf-8");
    const lines = existingContent.split("\n");

    const phaseIndex = lines.findIndex(
      (line) => line.startsWith(`| ${phase} |`) && line.includes(PHASE_NAMES[phase])
    );

    if (phaseIndex >= 0) {
      const phaseLine = lines[phaseIndex];
      const parts = phaseLine.split("|").map((s) => s.trim());

      if (parts.length >= 5) {
        const allocated = parseInt(parts[2].replace(/,/g, ""), 10);
        const remaining = Math.max(0, allocated - usedTokens);
        const usagePct = allocated > 0 ? ((usedTokens / allocated) * 100).toFixed(1) : "0.0";

        parts[3] = `${usedTokens.toLocaleString()} (${usagePct}%)`;
        parts[4] = remaining.toLocaleString();

        lines[phaseIndex] = parts.join(" | ");
        await fs.writeFile(reportPath, lines.join("\n"), "utf-8");
      }
    }

    const phaseDetailsIndex = lines.findIndex(
      (line) => line.startsWith(`### Phase ${phase}:`)
    );

    if (phaseDetailsIndex >= 0) {
      let insertIndex = phaseDetailsIndex + 1;
      while (insertIndex < lines.length && lines[insertIndex].startsWith("- **Used:**")) {
        insertIndex++;
      }

      if (insertIndex < lines.length) {
        const newLines = [
          "",
          `- **Used:** ${usedTokens.toLocaleString()} tokens`,
          `- **Remaining:** ${Math.max(0, (parseInt(parts?.[2]?.replace(/,/g, "") || "0", 10) || 0) - usedTokens).toLocaleString()} tokens`,
        ];

        if (files.length > 0) {
          newLines.push("");
          newLines.push("**Files in context:**");
          for (const file of files.slice(0, 20)) {
            newLines.push(`  - ${file}`);
          }
        }

        lines.splice(insertIndex, 0, ...newLines);
        await fs.writeFile(reportPath, lines.join("\n"), "utf-8");
      }
    }
  } catch {
    // File doesn't exist yet, will be created by generateContextManagementFile
  }
}

export default {
  calculateContextBudget,
  formatContextManagementMarkdown,
  generateContextManagementFile,
  updatePhaseContextUsage,
};