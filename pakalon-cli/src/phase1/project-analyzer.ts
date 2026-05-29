/**
 * Partial Completion Detection - Phase 1 Project Analysis
 * 
 * Analyzes existing project structure to determine how much
 * of the project has already been built, for intelligent
 * phase skipping and context management.
 */

import fs from "fs/promises";
import path from "path";

export interface ProjectAnalysis {
  isExistingProject: boolean;
  completionPercentage: number;
  detectedFeatures: string[];
  missingFeatures: string[];
  partiallyImplemented: string[];
  projectType?: string;
  techStack: {
    frontend?: string[];
    backend?: string[];
    database?: string[];
    tools: string[];
  };
  lastModified: Date | null;
  fileStats: {
    totalFiles: number;
    totalLines: number;
    byType: Record<string, number>;
  };
  recommendations: string[];
}

export interface DetectionRule {
  pattern: RegExp | string;
  feature: string;
  weight: number;
  required?: boolean;
}

const FRONTEND_INDICATORS: DetectionRule[] = [
  { pattern: /index\.html$/, feature: "HTML entry point", weight: 5 },
  { pattern: /src\/index\.(js|jsx|ts|tsx)$/, feature: "React/Vue entry", weight: 10 },
  { pattern: /package\.json$/, feature: "Node.js project", weight: 10 },
  { pattern: /src\/components?\//, feature: "Components", weight: 15 },
  { pattern: /src\/pages?\//, feature: "Pages/Routes", weight: 10 },
  { pattern: /src\/styles?\//, feature: "Styling", weight: 5 },
  { pattern: /\.css$/, feature: "CSS", weight: 5 },
  { pattern: /\.scss$/, feature: "SCSS", weight: 5 },
  { pattern: /tailwind\.config\./, feature: "Tailwind CSS", weight: 10 },
  { pattern: /next\.config\./, feature: "Next.js", weight: 15 },
  { pattern: /vite\.config\./, feature: "Vite", weight: 10 },
  { pattern: /nuxt\.config\./, feature: "Nuxt", weight: 15 },
  { pattern: /angular\.json$/, feature: "Angular", weight: 15 },
  { pattern: /gatsby\./, feature: "Gatsby", weight: 15 },
  { pattern: /public\//, feature: "Static assets", weight: 5 },
];

const BACKEND_INDICATORS: DetectionRule[] = [
  { pattern: /server\.(js|ts)$/, feature: "Server entry", weight: 10 },
  { pattern: /app\.(js|ts)$/, feature: "Express/Fastify app", weight: 10 },
  { pattern: /routes?\//, feature: "API routes", weight: 15 },
  { pattern: /controllers?\//, feature: "Controllers", weight: 10 },
  { pattern: /models?\//, feature: "Models", weight: 10 },
  { pattern: /middleware\//, feature: "Middleware", weight: 5 },
  { pattern: /api\//, feature: "API structure", weight: 10 },
  { pattern: /\.env/, feature: "Environment config", weight: 5 },
  { pattern: /requirements\.txt$/, feature: "Python dependencies", weight: 10 },
  { pattern: /go\.mod$/, feature: "Go module", weight: 10 },
  { pattern: /Cargo\.toml$/, feature: "Rust project", weight: 10 },
  { pattern: /pom\.xml$/, feature: "Java/Maven", weight: 10 },
  { pattern: /build\.gradle$/, feature: "Java/Gradle", weight: 10 },
  { pattern: /docker-compose\.(yml|yaml)$/, feature: "Docker Compose", weight: 10 },
  { pattern: /Dockerfile$/, feature: "Docker", weight: 5 },
];

const DATABASE_INDICATORS: DetectionRule[] = [
  { pattern: /schema\.(sql|prisma)/, feature: "Database schema", weight: 15 },
  { pattern: /migrations?\//, feature: "Database migrations", weight: 10 },
  { pattern: /models?\//, feature: "ORM models", weight: 10 },
  { pattern: /\.db$/, feature: "SQLite database", weight: 5 },
  { pattern: /postgres|postgresql/i, feature: "PostgreSQL", weight: 10 },
  { pattern: /mongodb/i, feature: "MongoDB", weight: 10 },
  { pattern: /redis/i, feature: "Redis", weight: 5 },
];

const COMPLETION_WEIGHTS = {
  frontend: 40,
  backend: 30,
  database: 15,
  config: 15,
};

class PartialCompletionDetector {
  async analyze(projectDir: string): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
      isExistingProject: false,
      completionPercentage: 0,
      detectedFeatures: [],
      missingFeatures: [],
      partiallyImplemented: [],
      techStack: { tools: [] },
      lastModified: null,
      fileStats: { totalFiles: 0, totalLines: 0, byType: {} },
      recommendations: [],
    };

    try {
      await fs.access(projectDir);
    } catch {
      return analysis;
    }

    const allFiles = await this.walkDir(projectDir);
    
    if (allFiles.length === 0) {
      return analysis;
    }

    analysis.isExistingProject = true;
    analysis.fileStats = await this.getFileStats(projectDir, allFiles);
    analysis.lastModified = await this.getLastModified(allFiles);

    const frontendScore = this.scoreFiles(allFiles, FRONTEND_INDICATORS);
    const backendScore = this.scoreFiles(allFiles, BACKEND_INDICATORS);
    const databaseScore = this.scoreFiles(allFiles, DATABASE_INDICATORS);

    analysis.techStack = this.detectTechStack(allFiles, projectDir);

    const maxFrontend = FRONTEND_INDICATORS.reduce((sum, r) => sum + r.weight, 0);
    const maxBackend = BACKEND_INDICATORS.reduce((sum, r) => sum + r.weight, 0);
    const maxDatabase = DATABASE_INDICATORS.reduce((sum, r) => sum + r.weight, 0);
    const maxConfig = 20;

    const normalizedFrontend = (frontendScore / maxFrontend) * COMPLETION_WEIGHTS.frontend;
    const normalizedBackend = (backendScore / maxBackend) * COMPLETION_WEIGHTS.backend;
    const normalizedDatabase = (databaseScore / maxDatabase) * COMPLETION_WEIGHTS.database;
    const configScore = this.detectConfigCompletion(allFiles);
    const normalizedConfig = (configScore / maxConfig) * COMPLETION_WEIGHTS.config;

    analysis.completionPercentage = Math.min(
      100,
      Math.round(normalizedFrontend + normalizedBackend + normalizedDatabase + normalizedConfig)
    );

    analysis.detectedFeatures = [
      ...this.matchFeatures(allFiles, FRONTEND_INDICATORS),
      ...this.matchFeatures(allFiles, BACKEND_INDICATORS),
      ...this.matchFeatures(allFiles, DATABASE_INDICATORS),
    ];

    analysis.missingFeatures = this.detectMissingFeatures(
      analysis.detectedFeatures,
      frontendScore,
      backendScore,
      databaseScore
    );

    analysis.partiallyImplemented = this.detectPartialFeatures(
      allFiles,
      analysis.detectedFeatures
    );

    analysis.projectType = this.detectProjectType(
      analysis.detectedFeatures,
      analysis.techStack
    );

    analysis.recommendations = this.generateRecommendations(analysis);

    return analysis;
  }

  private async walkDir(dir: string, maxDepth = 5, currentDepth = 0): Promise<string[]> {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];
    const ignoreDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      "__pycache__",
      ".venv",
      "venv",
      "vendor",
      "target",
    ];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith(".")) {
            const subFiles = await this.walkDir(fullPath, maxDepth, currentDepth + 1);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch {
    }

    return files;
  }

  private async getFileStats(
    projectDir: string,
    files: string[]
  ): Promise<ProjectAnalysis["fileStats"]> {
    const byType: Record<string, number> = {};
    let totalLines = 0;

    const limitedFiles = files.slice(0, 1000);

    for (const file of limitedFiles) {
      const ext = path.extname(file).toLowerCase();
      byType[ext] = (byType[ext] || 0) + 1;

      try {
        const content = await fs.readFile(file, "utf-8");
        totalLines += content.split("\n").length;
      } catch {
      }
    }

    return {
      totalFiles: files.length,
      totalLines,
      byType,
    };
  }

  private async getLastModified(files: string[]): Promise<Date | null> {
    if (files.length === 0) return null;

    let latest: Date | null = null;

    for (const file of files.slice(0, 100)) {
      try {
        const stat = await fs.stat(file);
        if (!latest || stat.mtime > latest) {
          latest = stat.mtime;
        }
      } catch {
      }
    }

    return latest;
  }

  private scoreFiles(files: string[], rules: DetectionRule[]): number {
    let score = 0;

    for (const file of files) {
      const normalizedFile = file.replace(/\\/g, "/");

      for (const rule of rules) {
        if (typeof rule.pattern === "string") {
          if (normalizedFile.includes(rule.pattern)) {
            score += rule.weight;
          }
        } else if (rule.pattern.test(normalizedFile)) {
          score += rule.weight;
        }
      }
    }

    return score;
  }

  private matchFeatures(files: string[], rules: DetectionRule[]): string[] {
    const features: string[] = [];
    const found = new Set<string>();

    for (const file of files) {
      const normalizedFile = file.replace(/\\/g, "/");

      for (const rule of rules) {
        if (!found.has(rule.feature)) {
          if (typeof rule.pattern === "string") {
            if (normalizedFile.includes(rule.pattern)) {
              features.push(rule.feature);
              found.add(rule.feature);
            }
          } else if (rule.pattern.test(normalizedFile)) {
            features.push(rule.feature);
            found.add(rule.feature);
          }
        }
      }
    }

    return features;
  }

  private detectTechStack(
    files: string[],
    projectDir: string
  ): ProjectAnalysis["techStack"] {
    const techStack: Required<ProjectAnalysis["techStack"]> = {
      frontend: [],
      backend: [],
      database: [],
      tools: [],
    };

    for (const file of files) {
      const normalizedFile = file.replace(/\\/g, "/");
      const content = normalizedFile.toLowerCase();

      if (content.includes("react")) techStack.frontend.push("React");
      if (content.includes("vue")) techStack.frontend.push("Vue");
      if (content.includes("angular")) techStack.frontend.push("Angular");
      if (content.includes("svelte")) techStack.frontend.push("Svelte");
      if (content.includes("nextjs") || content.includes("next.")) techStack.frontend.push("Next.js");
      if (content.includes("nuxt")) techStack.frontend.push("Nuxt");
      if (content.includes("tailwind")) techStack.frontend.push("Tailwind CSS");
      if (content.includes("nodejs") || content.includes("node.js") || content.endsWith("package.json")) techStack.backend.push("Node.js");
      if (content.includes("express")) techStack.backend.push("Express");
      if (content.includes("fastify")) techStack.backend.push("Fastify");
      if (content.includes("django")) techStack.backend.push("Django");
      if (content.includes("flask")) techStack.backend.push("Flask");
      if (content.includes("rails") || content.includes("ruby on rails")) techStack.backend.push("Rails");
      if (content.includes("spring")) techStack.backend.push("Spring");
      if (content.includes("postgres")) techStack.database.push("PostgreSQL");
      if (content.includes("mysql")) techStack.database.push("MySQL");
      if (content.includes("mongodb")) techStack.database.push("MongoDB");
      if (content.includes("sqlite")) techStack.database.push("SQLite");
      if (content.includes("redis")) techStack.database.push("Redis");
      if (content.endsWith("dockerfile") || content.includes("docker-compose")) techStack.tools.push("Docker");
      if (content.includes(".github/workflows")) techStack.tools.push("GitHub Actions");
      if (content.includes("playwright")) techStack.tools.push("Playwright");
      if (content.includes("vitest")) techStack.tools.push("Vitest");
      if (content.includes("prisma")) techStack.tools.push("Prisma");
    }

    techStack.frontend = [...new Set(techStack.frontend)];
    techStack.backend = [...new Set(techStack.backend)];
    techStack.database = [...new Set(techStack.database)];
    techStack.tools = [...new Set(techStack.tools)];

    return techStack;
  }

  private detectConfigCompletion(files: string[]): number {
    const configFiles = [
      "tsconfig.json",
      "jsconfig.json",
      ".gitignore",
      "README.md",
      "package.json",
      "requirements.txt",
    ];

    let score = 0;
    for (const file of files) {
      const normalizedFile = (file.replace(/\\/g, "/")).toLowerCase();
      for (const config of configFiles) {
        if (normalizedFile.endsWith(config.toLowerCase())) {
          score += 3;
        }
      }
    }

    return score;
  }

  private detectMissingFeatures(
    detected: string[],
    frontendScore: number,
    backendScore: number,
    databaseScore: number
  ): string[] {
    const missing: string[] = [];

    if (frontendScore === 0 && backendScore === 0) {
      missing.push("No project structure detected");
    }

    if (frontendScore > 0 && backendScore === 0) {
      missing.push("Backend not detected (frontend-only)");
    }

    if (backendScore > 0 && frontendScore === 0) {
      missing.push("Frontend not detected (backend-only)");
    }

    if (databaseScore === 0 && backendScore > 0) {
      missing.push("Database not configured");
    }

    return missing;
  }

  private detectPartialFeatures(files: string[], detected: string[]): string[] {
    const partial: string[] = [];

    const hasModels = detected.some((f) => f.includes("Model"));
    const hasRoutes = detected.some((f) => f.includes("Route"));
    const hasComponents = detected.some((f) => f.includes("Component"));

    if (hasRoutes && !hasModels) partial.push("Routes defined but models incomplete");
    if (hasComponents && !hasRoutes) partial.push("Components defined but routing incomplete");

    return partial;
  }

  private detectProjectType(
    detected: string[],
    techStack: ProjectAnalysis["techStack"]
  ): string | undefined {
    const frontend = techStack.frontend || [];
    const backend = techStack.backend || [];
    const database = techStack.database || [];

    if (frontend.length > 0 && backend.length > 0 && database.length > 0) {
      return "Full-stack application";
    }
    if (frontend.length > 0 && backend.length > 0) {
      return "Web application (frontend + API)";
    }
    if (frontend.length > 0) {
      return "Single-page application (SPA)";
    }
    if (backend.length > 0) {
      return "Backend API service";
    }

    return undefined;
  }

  private generateRecommendations(analysis: ProjectAnalysis): string[] {
    const recs: string[] = [];

    if (analysis.completionPercentage < 30) {
      recs.push("Project is mostly empty. Recommend starting fresh with Phase 1 planning.");
    } else if (analysis.completionPercentage < 70) {
      recs.push("Project partially built. Phase 1 should analyze existing structure.");
      recs.push("Consider using Phase 2 to generate wireframes for missing UI.");
    } else {
      recs.push("Project well-established. Focus on completing missing features.");
    }

    if (analysis.detectedFeatures.includes("Docker") && !analysis.detectedFeatures.includes("CI/CD")) {
      recs.push("Docker detected but no CI/CD configuration found.");
    }

    if (analysis.missingFeatures.includes("Database not configured") && analysis.techStack.backend?.length) {
      recs.push("Backend detected without database. Consider adding persistence layer.");
    }

    return recs;
  }
}

let globalDetector: PartialCompletionDetector | null = null;

export async function analyzeProjectCompletion(projectDir: string): Promise<ProjectAnalysis> {
  globalDetector = new PartialCompletionDetector();
  return globalDetector.analyze(projectDir);
}

export function getProjectAnalysis(): PartialCompletionDetector | null {
  return globalDetector;
}
