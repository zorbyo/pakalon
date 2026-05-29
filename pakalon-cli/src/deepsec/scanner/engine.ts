/**
 * Deepsec Scanner - Regex-based vulnerability detection
 * Implements the core scanning engine from deepsec
 */

import * as glob from "glob";
import * as path from "path";
import * as fs from "fs/promises";
import type {
  MatcherPlugin,
  CandidateMatch,
  FileRecord,
  ScannerDriver,
  ScanProgress,
  DetectedTech,
  LanguageStat,
} from "../core/types.js";
import {
  ensureProject,
  writeFileRecord,
  computeFileHash,
  generateRunId,
  shouldIgnoreFile,
  detectLanguage,
} from "../core/utils.js";
import logger from "@/utils/logger.js";

// Technology detection
export async function detectTech(rootPath: string): Promise<DetectedTech> {
  const tags: string[] = [];
  const frameworks: string[] = [];
  const languages: string[] = [];

  try {
    // Check for package.json
    try {
      const packageJson = await fs.readFile(
        path.join(rootPath, "package.json"),
        "utf8"
      );
      const pkg = JSON.parse(packageJson);
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      // Detect frameworks
      if (deps.next) frameworks.push("nextjs");
      if (deps.react) frameworks.push("react");
      if (deps.express) frameworks.push("express");
      if (deps.fastify) frameworks.push("fastify");
      if (deps.nestjs || deps["@nestjs/core"]) frameworks.push("nestjs");
      if (deps.hono) frameworks.push("hono");
      if (deps.vue) frameworks.push("vue");
      if (deps["@astrojs/core"]) frameworks.push("astro");
      if (deps["@remix-run/react"]) frameworks.push("remix");
      if (deps["@sveltejs/kit"]) frameworks.push("sveltekit");
      if (deps.drizzle) frameworks.push("drizzle");
      if (deps.prisma) frameworks.push("prisma");
      if (deps.trpc) frameworks.push("trpc");
      if (deps["@trpc/server"]) frameworks.push("trpc");

      // Detect languages
      if (deps.typescript) languages.push("typescript");
      languages.push("javascript");
    } catch {
      // Not a Node.js project
    }

    // Check for Python
    try {
      await fs.access(path.join(rootPath, "requirements.txt"));
      languages.push("python");
      frameworks.push("python");
    } catch {
      // Not a Python project
    }

    // Check for Go
    try {
      await fs.access(path.join(rootPath, "go.mod"));
      languages.push("go");
      frameworks.push("go");
    } catch {
      // Not a Go project
    }

    // Check for Rust
    try {
      await fs.access(path.join(rootPath, "Cargo.toml"));
      languages.push("rust");
      frameworks.push("rust");
    } catch {
      // Not a Rust project
    }

    // Check for Ruby
    try {
      await fs.access(path.join(rootPath, "Gemfile"));
      languages.push("ruby");
      frameworks.push("ruby");
    } catch {
      // Not a Ruby project
    }

    // Check for PHP
    try {
      await fs.access(path.join(rootPath, "composer.json"));
      languages.push("php");
      frameworks.push("php");
    } catch {
      // Not a PHP project
    }

    // Check for Java/Kotlin
    try {
      await fs.access(path.join(rootPath, "pom.xml"));
      languages.push("java");
      frameworks.push("java");
    } catch {
      // Not a Java project
    }

    // Check for Kubernetes
    try {
      const k8sFiles = await glob.glob("**/*.yaml", { cwd: rootPath });
      if (k8sFiles.some((f) => f.includes("deployment") || f.includes("service"))) {
        tags.push("kubernetes");
      }
    } catch {
      // Not a K8s project
    }

    // Check for Terraform
    try {
      const tfFiles = await glob.glob("**/*.tf", { cwd: rootPath });
      if (tfFiles.length > 0) {
        tags.push("terraform");
        languages.push("terraform");
      }
    } catch {
      // Not a Terraform project
    }

    // Check for Docker
    try {
      await fs.access(path.join(rootPath, "Dockerfile"));
      tags.push("docker");
    } catch {
      // Not a Docker project
    }
  } catch {
    // Ignore detection errors
  }

  // Remove duplicates
  const uniqueTags = [...new Set([...tags, ...frameworks, ...languages])];
  const uniqueFrameworks = [...new Set(frameworks)];
  const uniqueLanguages = [...new Set(languages)];

  return {
    tags: uniqueTags,
    frameworks: uniqueFrameworks,
    languages: uniqueLanguages,
    confidence: Math.min(uniqueTags.length / 5, 1),
  };
}

// Regex scanner driver
export class RegexScannerDriver implements ScannerDriver {
  name = "regex";

  async scan(params: {
    projectId: string;
    root: string;
    filePaths?: string[];
    matchers: MatcherPlugin[];
    onProgress?: (progress: ScanProgress) => void;
  }): Promise<{ runId: string; candidateCount: number }> {
    const { projectId, root, filePaths, matchers, onProgress } = params;
    const runId = generateRunId();
    let candidateCount = 0;
    let filesScanned = 0;

    // Ensure project structure
    await ensureProject(projectId, root);

    // Get files to scan
    let files: string[] = [];
    if (filePaths && filePaths.length > 0) {
      files = filePaths;
    } else {
      // Glob for files based on matcher patterns
      const patternSet = new Set<string>();
      for (const matcher of matchers) {
        for (const pattern of matcher.filePatterns) {
          patternSet.add(pattern);
        }
      }

      for (const pattern of patternSet) {
        try {
          const matches = await glob.glob(pattern, {
            cwd: root,
            ignore: ["node_modules/**", ".git/**", "dist/**", "build/**", ".next/**"],
          });
          files.push(...matches);
        } catch {
          // Continue with next pattern
        }
      }
    }

    // Remove duplicates
    const uniqueFiles = [...new Set(files)];

    // Scan each file
    for (const file of uniqueFiles) {
      const absolutePath = path.join(root, file);

      // Skip ignored files
      if (shouldIgnoreFile(absolutePath)) {
        continue;
      }

      try {
        const content = await fs.readFile(absolutePath, "utf8");
        const fileHash = computeFileHash(content);
        const fileCandidates: CandidateMatch[] = [];

        // Run each matcher
        for (const matcher of matchers) {
          try {
            const matches = matcher.match(content, absolutePath);
            if (matches && matches.length > 0) {
              fileCandidates.push(...matches);
            }
          } catch {
            // Skip matcher errors
          }
        }

        // Create file record
        if (fileCandidates.length > 0) {
          const fileRecord: FileRecord = {
            filePath: file,
            projectId,
            candidates: fileCandidates,
            lastScannedAt: new Date().toISOString(),
            lastScannedRunId: runId,
            fileHash,
            findings: [],
            analysisHistory: [],
            status: "pending",
          };

          await writeFileRecord(projectId, fileRecord, root);
          candidateCount += fileCandidates.length;
        }

        filesScanned++;

        // Report progress
        if (onProgress) {
          onProgress({
            filesScanned,
            totalFiles: uniqueFiles.length,
            currentFile: file,
            candidateCount,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    logger.info(`[Scanner] Scanned ${filesScanned} files, found ${candidateCount} candidates`);

    return { runId, candidateCount };
  }
}

// Main scan function
export async function scan(params: {
  projectId: string;
  root: string;
  matchers: MatcherPlugin[];
  filePaths?: string[];
  onProgress?: (progress: ScanProgress) => void;
}): Promise<{
  runId: string;
  candidateCount: number;
  detected: DetectedTech;
  activeMatchers: string[];
}> {
  const { projectId, root, matchers, filePaths, onProgress } = params;

  // Detect technology
  const detected = await detectTech(root);

  // Filter matchers based on detected tech (if they have requires)
  const activeMatchers = matchers.filter((matcher) => {
    if (!matcher.requires || matcher.requires.length === 0) {
      return true;
    }
    return matcher.requires.some((req) =>
      detected.tags.includes(req) ||
      detected.frameworks.includes(req) ||
      detected.languages.includes(req)
    );
  });

  // Create scanner and run
  const driver = new RegexScannerDriver();
  const result = await driver.scan({
    projectId,
    root,
    filePaths,
    matchers: activeMatchers,
    onProgress,
  });

  return {
    runId: result.runId,
    candidateCount: result.candidateCount,
    detected,
    activeMatchers: activeMatchers.map((m) => m.slug),
  };
}

// Scan specific files (for diff mode)
export async function scanFiles(params: {
  projectId: string;
  root: string;
  filePaths: string[];
  matchers: MatcherPlugin[];
  onProgress?: (progress: ScanProgress) => void;
}): Promise<{
  runId: string;
  filesScanned: number;
  candidateCount: number;
  detected: DetectedTech;
}> {
  const { projectId, root, filePaths, matchers, onProgress } = params;

  // Detect technology
  const detected = await detectTech(root);

  // Filter matchers
  const activeMatchers = matchers.filter((matcher) => {
    if (!matcher.requires || matcher.requires.length === 0) {
      return true;
    }
    return matcher.requires.some((req) =>
      detected.tags.includes(req) ||
      detected.frameworks.includes(req) ||
      detected.languages.includes(req)
    );
  });

  // Create scanner and run
  const driver = new RegexScannerDriver();
  const result = await driver.scan({
    projectId,
    root,
    filePaths,
    matchers: activeMatchers,
    onProgress,
  });

  return {
    runId: result.runId,
    filesScanned: filePaths.length,
    candidateCount: result.candidateCount,
    detected,
  };
}
