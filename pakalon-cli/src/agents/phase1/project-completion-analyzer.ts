/**
 * Project Completion Analyzer
 * 
 * Analyzes an existing project to determine how much of it is already complete.
 * Used in Phase 1 to detect partial completion and suggest whether to:
 * - Start fresh
 * - Resume from current state
 * - Supplement existing work
 * 
 * This addresses the MISSING requirement for "Partial completion detection".
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface ProjectAnalysisResult {
  isNewProject: boolean;
  completionPercentage: number;
  detectedTechStack: string[];
  existingFeatures: string[];
  missingFeatures: string[];
  phaseProgress: {
    phase1: { complete: boolean; files: string[] };
    phase2: { complete: boolean; files: string[] };
    phase3: { complete: boolean; files: string[] };
    phase4: { complete: boolean; files: string[] };
    phase5: { complete: boolean; files: string[] };
    phase6: { complete: boolean; files: string[] };
  };
  recommendations: string[];
}

export interface TechStackIndicator {
  pattern: RegExp;
  name: string;
  confidence: "high" | "medium" | "low";
}

const TECH_STACK_INDICATORS: TechStackIndicator[] = [
  { pattern: /package\.json$/, name: "Node.js", confidence: "high" },
  { pattern: /requirements\.txt$/, name: "Python", confidence: "high" },
  { pattern: /Cargo\.toml$/, name: "Rust", confidence: "high" },
  { pattern: /go\.mod$/, name: "Go", confidence: "high" },
  { pattern: /pom\.xml$/, name: "Java/Maven", confidence: "high" },
  { pattern: /build\.gradle$/, name: "Java/Gradle", confidence: "high" },
  { pattern: /composer\.json$/, name: "PHP/Composer", confidence: "high" },
  { pattern: /Gemfile$/, name: "Ruby", confidence: "high" },
  { pattern: /next\.config\.(js|ts|mjs)$/, name: "Next.js", confidence: "high" },
  { pattern: /nuxt\.config\.(js|ts)$/, name: "Nuxt.js", confidence: "high" },
  { pattern: /vite\.config\.(js|ts)$/, name: "Vite", confidence: "high" },
  { pattern: /webpack\.config\.js$/, name: "Webpack", confidence: "medium" },
  { pattern: /tsconfig\.json$/, name: "TypeScript", confidence: "high" },
  { pattern: /docker-compose\.ya?ml$/, name: "Docker", confidence: "high" },
  { pattern: /Dockerfile$/, name: "Docker", confidence: "high" },
  { pattern: /\.csproj$/, name: "C#/.NET", confidence: "high" },
  { pattern: /swiftpm\/Package\.swift$/, name: "Swift", confidence: "high" },
  { pattern: /pubspec\.yaml$/, name: "Dart/Flutter", confidence: "high" },
  { pattern: /angular\.json$/, name: "Angular", confidence: "high" },
  { pattern: /vue\.config\.js$/, name: "Vue.js", confidence: "medium" },
];

const PHASE_INDICATORS: Record<number, { files: string[]; dirs: string[]; keywords: string[] }> = {
  1: {
    files: ["plan.md", "tasks.md", "user-stories.md", "design.md", "prd.md"],
    dirs: [],
    keywords: ["architecture", "requirements", "planning"],
  },
  2: {
    files: ["wireframe", "design-system", "penpot", "figma"],
    dirs: ["wireframes", "designs", "assets"],
    keywords: ["wireframe", "mockup", "design"],
  },
  3: {
    files: ["index.", "main.", "app.", "src/"],
    dirs: ["src", "lib", "components", "pages", "api", "models"],
    keywords: ["import", "export", "function", "class", "interface"],
  },
  4: {
    files: ["security", "audit", "test", "spec", ".test.", ".spec."],
    dirs: ["tests", "test", "__tests__", "security"],
    keywords: ["describe", "test", "it(", "expect", "security"],
  },
  5: {
    files: [".github/workflows", "Jenkinsfile", ".gitlab-ci.yml", "deploy"],
    dirs: [".github", "ci", "cd"],
    keywords: ["github", "actions", "workflow", "deployment"],
  },
  6: {
    files: ["README.md", "CHANGELOG.md", "docs/", "API.md"],
    dirs: ["docs", "documentation"],
    keywords: ["documentation", "readme", "api", "guide"],
  },
};

export async function analyzeProjectCompletion(
  projectDir: string,
  targetFeatures?: string[]
): Promise<ProjectAnalysisResult> {
  const result: ProjectAnalysisResult = {
    isNewProject: true,
    completionPercentage: 0,
    detectedTechStack: [],
    existingFeatures: [],
    missingFeatures: targetFeatures ?? [],
    phaseProgress: {
      phase1: { complete: false, files: [] },
      phase2: { complete: false, files: [] },
      phase3: { complete: false, files: [] },
      phase4: { complete: false, files: [] },
      phase5: { complete: false, files: [] },
      phase6: { complete: false, files: [] },
    },
    recommendations: [],
  };

  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".git") continue;
      if (entry.isDirectory()) {
        dirs.push(entry.name);
      } else {
        files.push(entry.name);
      }
    }

    if (files.length > 0 || dirs.length > 0) {
      result.isNewProject = false;
    }

    const allFiles = await walkDir(projectDir);
    const fileSet = new Set(allFiles.map(f => path.relative(projectDir, f)));

    for (const indicator of TECH_STACK_INDICATORS) {
      for (const file of files) {
        if (indicator.pattern.test(file)) {
          if (!result.detectedTechStack.includes(indicator.name)) {
            result.detectedTechStack.push(indicator.name);
          }
        }
      }
    }

    for (const [phase, indicators] of Object.entries(PHASE_INDICATORS)) {
      const phaseNum = parseInt(phase);
      const foundFiles: string[] = [];

      for (const file of allFiles) {
        const relativePath = path.relative(projectDir, file);
        const fileName = path.basename(file);

        for (const keyword of indicators.files) {
          if (fileName.includes(keyword) || relativePath.includes(keyword)) {
            foundFiles.push(relativePath);
            break;
          }
        }

        for (const keyword of indicators.keywords) {
          try {
            const content = await fs.readFile(file, "utf8");
            if (content.toLowerCase().includes(keyword.toLowerCase())) {
              if (!foundFiles.includes(relativePath)) {
                foundFiles.push(relativePath);
              }
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      result.phaseProgress[`phase${phaseNum}` as keyof ProjectAnalysisResult["phaseProgress"]] = {
        complete: foundFiles.length >= 3,
        files: [...new Set(foundFiles)].slice(0, 20),
      };
    }

    const agentsDir = path.join(projectDir, ".pakalon-agents");
    if (await dirExists(agentsDir)) {
      for (let i = 1; i <= 6; i++) {
        const phaseDir = path.join(agentsDir, `phase-${i}`);
        if (await dirExists(phaseDir)) {
          result.phaseProgress[`phase${i}` as keyof ProjectAnalysisResult["phaseProgress"]].complete = true;
        }
      }
    }

    const pakalonDir = path.join(projectDir, ".pakalon");
    if (await dirExists(pakalonDir)) {
      const planFile = path.join(pakalonDir, "plan.md");
      const tasksFile = path.join(pakalonDir, "task.md");
      if (await fileExists(planFile) && await fileExists(tasksFile)) {
        result.phaseProgress.phase1.complete = true;
        result.existingFeatures.push("planning_docs");
      }
    }

    const completedPhases = Object.values(result.phaseProgress).filter(p => p.complete).length;
    result.completionPercentage = Math.round((completedPhases / 6) * 100);

    if (result.isNewProject) {
      result.recommendations.push("Starting fresh - no existing project detected");
    } else if (result.completionPercentage === 0) {
      result.recommendations.push("Project exists but no Pakalon phase structure found. Run /pakalon to start from Phase 1");
    } else if (result.completionPercentage < 50) {
      result.recommendations.push("Early stage project detected. Consider using --resume or completing remaining phases");
    } else if (result.completionPercentage < 100) {
      result.recommendations.push("Partially complete project. Use /pakalon --resume to continue from current phase");
    } else {
      result.recommendations.push("Project appears complete. Consider running /auditor to verify implementation");
    }

    if (result.detectedTechStack.length > 0) {
      result.recommendations.push(`Detected tech stack: ${result.detectedTechStack.join(", ")}`);
    }

    return result;
  } catch (error) {
    return {
      ...result,
      recommendations: [`Error analyzing project: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(current: string): Promise<void> {
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith("node_modules") && !entry.name.startsWith(".")) {
            await visit(fullPath);
          }
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await visit(dir);
  return results;
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function formatAnalysisReport(analysis: ProjectAnalysisResult): string {
  const lines: string[] = [];

  lines.push("## Project Analysis Report\n");

  lines.push(`**Status:** ${analysis.isNewProject ? "New Project" : "Existing Project"}`);
  lines.push(`**Completion:** ${analysis.completionPercentage}%`);
  lines.push("");

  if (analysis.detectedTechStack.length > 0) {
    lines.push("**Detected Tech Stack:**");
    for (const tech of analysis.detectedTechStack) {
      lines.push(`  - ${tech}`);
    }
    lines.push("");
  }

  lines.push("**Phase Progress:**");
  for (const [phase, progress] of Object.entries(analysis.phaseProgress)) {
    const status = progress.complete ? "[OK]" : "[Box]";
    lines.push(`  ${status} ${phase.charAt(0).toUpperCase() + phase.slice(1)}: ${progress.files.length} files`);
  }
  lines.push("");

  if (analysis.recommendations.length > 0) {
    lines.push("**Recommendations:**");
    for (const rec of analysis.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  return lines.join("\n");
}