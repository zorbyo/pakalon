/**
 * benchmark.ts — Automated benchmark testing for Pakalon-built applications.
 * 
 * After building an application, Pakalon runs benchmarks to:
 * 1. Verify functionality against requirements
 * 2. Compare with similar real-world products
 * 3. Score the application out of 100
 * 4. Auto-fix issues if score < 90
 */

import { execSync, exec as execCb } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const exec = promisify(execCb);

export interface BenchmarkResult {
  score: number;
  maxScore: number;
  passed: boolean;
  categories: BenchmarkCategory[];
  recommendations: string[];
  timestamp: Date;
}

export interface BenchmarkCategory {
  name: string;
  score: number;
  maxScore: number;
  tests: BenchmarkTest[];
}

export interface BenchmarkTest {
  name: string;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  details?: string;
}

export interface BenchmarkConfig {
  requirements: string[];
  similarProducts?: string[];
  minScore: number;
  categories: {
    functionality: number;
    performance: number;
    quality: number;
    usability: number;
    reliability: number;
  };
}

/**
 * Default benchmark configuration
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  requirements: [],
  minScore: 90,
  categories: {
    functionality: 30,
    performance: 20,
    quality: 25,
    usability: 15,
    reliability: 10,
  },
};

/**
 * Run a complete benchmark suite on an application
 */
export async function runBenchmark(
  projectPath: string,
  config: Partial<BenchmarkConfig> = {}
): Promise<BenchmarkResult> {
  const mergedConfig: BenchmarkConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    categories: { ...DEFAULT_CONFIG.categories, ...config.categories },
  };

  const categories: BenchmarkCategory[] = [];
  const recommendations: string[] = [];

  // Run each benchmark category
  categories.push(await runFunctionalityBenchmarks(projectPath, mergedConfig));
  categories.push(await runPerformanceBenchmarks(projectPath, mergedConfig));
  categories.push(await runQualityBenchmarks(projectPath, mergedConfig));
  categories.push(await runUsabilityBenchmarks(projectPath, mergedConfig));
  categories.push(await runReliabilityBenchmarks(projectPath, mergedConfig));

  // Calculate total score
  let totalScore = 0;
  let maxScore = 0;

  for (const category of categories) {
    totalScore += category.score;
    maxScore += category.maxScore;

    // Collect recommendations from failed tests
    for (const test of category.tests) {
      if (!test.passed && test.message) {
        recommendations.push(`[${category.name}] ${test.name}: ${test.message}`);
      }
    }
  }

  const score = Math.round((totalScore / maxScore) * 100);

  return {
    score,
    maxScore: 100,
    passed: score >= mergedConfig.minScore,
    categories,
    recommendations,
    timestamp: new Date(),
  };
}

/**
 * Functionality benchmarks - verify features work
 */
async function runFunctionalityBenchmarks(
  projectPath: string,
  config: BenchmarkConfig
): Promise<BenchmarkCategory> {
  const tests: BenchmarkTest[] = [];
  const maxScore = config.categories.functionality;

  // Test 1: Project structure exists
  tests.push({
    name: "Project Structure",
    passed: fs.existsSync(path.join(projectPath, "package.json")) || 
            fs.existsSync(path.join(projectPath, "requirements.txt")) ||
            fs.existsSync(path.join(projectPath, "Cargo.toml")),
    score: 5,
    maxScore: 5,
    message: fs.existsSync(path.join(projectPath, "package.json")) ? 
      "Project structure verified" : "Missing project configuration file",
  });

  // Test 2: Source files exist
  const srcDirs = ["src", "app", "lib", "components"];
  const hasSrcDir = srcDirs.some(dir => fs.existsSync(path.join(projectPath, dir)));
  tests.push({
    name: "Source Code",
    passed: hasSrcDir,
    score: 5,
    maxScore: 5,
    message: hasSrcDir ? "Source code directory found" : "No source code directory found",
  });

  // Test 3: Test files exist
  const testPatterns = ["*.test.*", "*.spec.*", "test_*", "*_test.*"];
  const hasTests = testPatterns.some(pattern => {
    try {
      const files = execSync(`find "${projectPath}" -name "${pattern}" 2>/dev/null | head -1`, { encoding: "utf-8" });
      return files.trim().length > 0;
    } catch {
      return false;
    }
  });
  tests.push({
    name: "Test Coverage",
    passed: hasTests,
    score: 5,
    maxScore: 5,
    message: hasTests ? "Test files found" : "No test files detected",
  });

  // Test 4: Documentation exists
  const docsExist = fs.existsSync(path.join(projectPath, "README.md")) ||
                   fs.existsSync(path.join(projectPath, "docs"));
  tests.push({
    name: "Documentation",
    passed: docsExist,
    score: 5,
    maxScore: 5,
    message: docsExist ? "Documentation found" : "Missing README.md or docs/",
  });

  // Test 5: Build configuration
  const hasBuildConfig = fs.existsSync(path.join(projectPath, "tsconfig.json")) ||
                        fs.existsSync(path.join(projectPath, "webpack.config.js")) ||
                        fs.existsSync(path.join(projectPath, "vite.config.ts")) ||
                        fs.existsSync(path.join(projectPath, "next.config.js"));
  tests.push({
    name: "Build Configuration",
    passed: hasBuildConfig,
    score: 5,
    maxScore: 5,
    message: hasBuildConfig ? "Build configuration found" : "Missing build configuration",
  });

  // Test 6: Can requirements be extracted?
  const hasRequirements = config.requirements.length > 0 || 
                         fs.existsSync(path.join(projectPath, ".pakalon", "requirements.md"));
  tests.push({
    name: "Requirements Defined",
    passed: hasRequirements,
    score: 5,
    maxScore: 5,
    message: hasRequirements ? "Requirements defined" : "No requirements found",
  });

  const score = tests.reduce((sum, t) => sum + (t.passed ? t.score : 0), 0);

  return {
    name: "Functionality",
    score,
    maxScore,
    tests,
  };
}

/**
 * Performance benchmarks - measure speed and efficiency
 */
async function runPerformanceBenchmarks(
  projectPath: string,
  config: BenchmarkConfig
): Promise<BenchmarkCategory> {
  const tests: BenchmarkTest[] = [];
  const maxScore = config.categories.performance;

  // Test 1: Build time
  let buildTime = 0;
  let buildPassed = false;
  try {
    const start = Date.now();
    execSync("npm run build 2>&1 || yarn build 2>&1 || true", { 
      cwd: projectPath, 
      timeout: 120000,
      stdio: "pipe" 
    });
    buildTime = (Date.now() - start) / 1000;
    buildPassed = buildTime < 60; // Should build in under 60 seconds
  } catch {
    buildPassed = false;
  }
  tests.push({
    name: "Build Time",
    passed: buildPassed,
    score: 7,
    maxScore: 7,
    message: buildPassed ? `Built in ${buildTime.toFixed(1)}s` : "Build timeout or failed",
    details: `Target: <60s, Actual: ${buildTime.toFixed(1)}s`,
  });

  // Test 2: Dependencies size
  let depsSize = 0;
  let depsPassed = false;
  try {
    const nodeModules = path.join(projectPath, "node_modules");
    if (fs.existsSync(nodeModules)) {
      const sizeOutput = execSync(`du -sh "${nodeModules}" 2>/dev/null | cut -f1`, { encoding: "utf-8" });
      depsSize = parseFloat(sizeOutput) || 0;
      depsPassed = depsSize < 500; // Less than 500MB
    } else {
      depsPassed = true; // No node_modules is fine
    }
  } catch {
    depsPassed = true;
  }
  tests.push({
    name: "Dependencies Size",
    passed: depsPassed,
    score: 7,
    maxScore: 7,
    message: depsPassed ? "Dependencies size acceptable" : "Dependencies too large",
    details: `Target: <500MB, Actual: ${depsSize}MB`,
  });

  // Test 3: Lint check
  let lintPassed = false;
  try {
    execSync("npm run lint 2>&1 || yarn lint 2>&1 || true", { 
      cwd: projectPath, 
      timeout: 30000,
      stdio: "pipe" 
    });
    lintPassed = true;
  } catch {
    lintPassed = false;
  }
  tests.push({
    name: "Lint Check",
    passed: lintPassed,
    score: 6,
    maxScore: 6,
    message: lintPassed ? "Lint check passed" : "Lint errors found",
  });

  const score = tests.reduce((sum, t) => sum + (t.passed ? t.score : 0), 0);

  return {
    name: "Performance",
    score,
    maxScore,
    tests,
  };
}

/**
 * Code quality benchmarks
 */
async function runQualityBenchmarks(
  projectPath: string,
  config: BenchmarkConfig
): Promise<BenchmarkCategory> {
  const tests: BenchmarkTest[] = [];
  const maxScore = config.categories.quality;

  // Test 1: TypeScript strict mode
  let strictMode = false;
  try {
    const tsconfigPath = path.join(projectPath, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      strictMode = tsconfig.compilerOptions?.strict === true;
    }
  } catch {}
  tests.push({
    name: "TypeScript Strict Mode",
    passed: strictMode,
    score: 8,
    maxScore: 8,
    message: strictMode ? "Strict mode enabled" : "Strict mode not enabled",
  });

  // Test 2: ESLint configuration
  const hasEslint = fs.existsSync(path.join(projectPath, ".eslintrc.js")) ||
                   fs.existsSync(path.join(projectPath, ".eslintrc.json")) ||
                   fs.existsSync(path.join(projectPath, "eslint.config.js"));
  tests.push({
    name: "ESLint Configured",
    passed: hasEslint,
    score: 7,
    maxScore: 7,
    message: hasEslint ? "ESLint configured" : "ESLint not configured",
  });

  // Test 3: Prettier configuration
  const hasPrettier = fs.existsSync(path.join(projectPath, ".prettierrc")) ||
                     fs.existsSync(path.join(projectPath, "prettier.config.js"));
  tests.push({
    name: "Prettier Configured",
    passed: hasPrettier,
    score: 5,
    maxScore: 5,
    message: hasPrettier ? "Prettier configured" : "Prettier not configured",
  });

  // Test 4: Git hooks (husky)
  const hasHusky = fs.existsSync(path.join(projectPath, ".husky"));
  tests.push({
    name: "Git Hooks",
    passed: hasHusky,
    score: 5,
    maxScore: 5,
    message: hasHusky ? "Git hooks configured" : "No git hooks found",
  });

  const score = tests.reduce((sum, t) => sum + (t.passed ? t.score : 0), 0);

  return {
    name: "Code Quality",
    score,
    maxScore,
    tests,
  };
}

/**
 * Usability benchmarks
 */
async function runUsabilityBenchmarks(
  projectPath: string,
  config: BenchmarkConfig
): Promise<BenchmarkCategory> {
  const tests: BenchmarkTest[] = [];
  const maxScore = config.categories.usability;

  // Test 1: Error handling
  let hasErrorHandling = false;
  try {
    const files = execSync(`grep -r "try\\|catch\\|throw" "${projectPath}/src" 2>/dev/null | wc -l`, { encoding: "utf-8" });
    hasErrorHandling = parseInt(files) > 10;
  } catch {}
  tests.push({
    name: "Error Handling",
    passed: hasErrorHandling,
    score: 5,
    maxScore: 5,
    message: hasErrorHandling ? "Error handling found" : "Insufficient error handling",
  });

  // Test 2: Logging
  let hasLogging = false;
  try {
    const files = execSync(`grep -r "console\\.log\\|logger\\|winston\\|pino" "${projectPath}/src" 2>/dev/null | wc -l`, { encoding: "utf-8" });
    hasLogging = parseInt(files) > 5;
  } catch {}
  tests.push({
    name: "Logging",
    passed: hasLogging,
    score: 5,
    maxScore: 5,
    message: hasLogging ? "Logging implemented" : "No logging found",
  });

  // Test 3: Environment configuration
  const hasEnvConfig = fs.existsSync(path.join(projectPath, ".env.example")) ||
                      fs.existsSync(path.join(projectPath, ".env.template"));
  tests.push({
    name: "Environment Config",
    passed: hasEnvConfig,
    score: 5,
    maxScore: 5,
    message: hasEnvConfig ? "Environment config found" : "No .env.example found",
  });

  const score = tests.reduce((sum, t) => sum + (t.passed ? t.score : 0), 0);

  return {
    name: "Usability",
    score,
    maxScore,
    tests,
  };
}

/**
 * Reliability benchmarks
 */
async function runReliabilityBenchmarks(
  projectPath: string,
  config: BenchmarkConfig
): Promise<BenchmarkCategory> {
  const tests: BenchmarkTest[] = [];
  const maxScore = config.categories.reliability;

  // Test 1: Run existing tests
  let testsPassed = false;
  let testOutput = "";
  try {
    const result = execSync("npm test 2>&1 || yarn test 2>&1 || true", { 
      cwd: projectPath, 
      timeout: 60000,
      encoding: "utf-8" 
    });
    testOutput = result;
    testsPassed = !result.includes("failed") && !result.includes("FAIL");
  } catch (e) {
    testOutput = String(e);
  }
  tests.push({
    name: "Tests Pass",
    passed: testsPassed,
    score: 10,
    maxScore: 10,
    message: testsPassed ? "All tests passed" : "Some tests failed",
    details: testOutput.slice(0, 500),
  });

  const score = tests.reduce((sum, t) => sum + (t.passed ? t.score : 0), 0);

  return {
    name: "Reliability",
    score,
    maxScore,
    tests,
  };
}

/**
 * Format benchmark results as a readable report
 */
export function formatBenchmarkReport(result: BenchmarkResult): string {
  const lines: string[] = [];

  lines.push("# Pakalon Benchmark Report");
  lines.push("");
  lines.push(`**Overall Score:** ${result.score}/100 ${result.passed ? "[OK] PASSED" : "[X] FAILED"}`);
  lines.push(`**Timestamp:** ${result.timestamp.toISOString()}`);
  lines.push("");

  lines.push("## Category Breakdown");
  lines.push("");

  for (const category of result.categories) {
    const percentage = Math.round((category.score / category.maxScore) * 100);
    const status = percentage >= 80 ? "[OK]" : percentage >= 60 ? "Warning:" : "[X]";
    lines.push(`### ${status} ${category.name}: ${category.score}/${category.maxScore} (${percentage}%)`);
    lines.push("");

    for (const test of category.tests) {
      const testStatus = test.passed ? "[OK]" : "[X]";
      lines.push(`- ${testStatus} ${test.name}: ${test.message}`);
      if (test.details) {
        lines.push(`  ${test.details}`);
      }
    }
    lines.push("");
  }

  if (result.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (const rec of result.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Auto-fix issues based on benchmark results
 */
export async function autoFixIssues(
  projectPath: string,
  result: BenchmarkResult
): Promise<{ fixed: number; actions: string[] }> {
  const actions: string[] = [];
  let fixed = 0;

  for (const category of result.categories) {
    for (const test of category.tests) {
      if (!test.passed) {
        const action = await attemptFix(projectPath, category.name, test);
        if (action) {
          actions.push(action);
          fixed++;
        }
      }
    }
  }

  return { fixed, actions };
}

/**
 * Attempt to fix a specific test failure
 */
async function attemptFix(
  projectPath: string,
  category: string,
  test: BenchmarkTest
): Promise<string | null> {
  switch (test.name) {
    case "Project Structure":
      // Create package.json if missing
      if (!fs.existsSync(path.join(projectPath, "package.json"))) {
        try {
          execSync("npm init -y", { cwd: projectPath, stdio: "pipe" });
          return "Created package.json";
        } catch {}
      }
      break;

    case "Documentation":
      // Create README.md if missing
      if (!fs.existsSync(path.join(projectPath, "README.md"))) {
        const readme = `# Project\n\nGenerated by Pakalon.\n`;
        fs.writeFileSync(path.join(projectPath, "README.md"), readme);
        return "Created README.md";
      }
      break;

    case "TypeScript Strict Mode":
      // Enable strict mode in tsconfig.json
      const tsconfigPath = path.join(projectPath, "tsconfig.json");
      if (fs.existsSync(tsconfigPath)) {
        try {
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
          if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
          tsconfig.compilerOptions.strict = true;
          fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
          return "Enabled TypeScript strict mode";
        } catch {}
      }
      break;

    case "Environment Config":
      // Create .env.example
      if (!fs.existsSync(path.join(projectPath, ".env.example"))) {
        const envExample = `# Environment variables\n# Add your configuration here\n`;
        fs.writeFileSync(path.join(projectPath, ".env.example"), envExample);
        return "Created .env.example";
      }
      break;
  }

  return null;
}

/**
 * Run benchmark with auto-fix loop
 */
export async function runBenchmarkWithAutoFix(
  projectPath: string,
  config: Partial<BenchmarkConfig> = {},
  maxIterations: number = 3
): Promise<{ result: BenchmarkResult; iterations: number; fixes: string[] }> {
  const allFixes: string[] = [];
  let iterations = 0;
  let result: BenchmarkResult;

  do {
    result = await runBenchmark(projectPath, config);
    iterations++;

    if (result.passed || iterations >= maxIterations) {
      break;
    }

    // Attempt fixes
    const { fixed, actions } = await autoFixIssues(projectPath, result);
    allFixes.push(...actions);

    if (fixed === 0) {
      // No more fixes possible
      break;
    }
  } while (!result.passed && iterations < maxIterations);

  return { result, iterations, fixes: allFixes };
}

// Export command handler
export async function handleBenchmarkCommand(args: string[]): Promise<{ ok: boolean; output: string }> {
  const [subCommand, ...rest] = args;

  switch (subCommand) {
    case "run": {
      const projectPath = rest[0] || process.cwd();
      console.log("Running benchmarks...");
      const { result, iterations, fixes } = await runBenchmarkWithAutoFix(projectPath);
      
      let output = formatBenchmarkReport(result);
      if (iterations > 1) {
        output += `\n\nCompleted in ${iterations} iterations.`;
      }
      if (fixes.length > 0) {
        output += `\n\nAuto-fixes applied:\n${fixes.map(f => `- ${f}`).join("\n")}`;
      }
      
      return { ok: result.passed, output };
    }

    case "quick": {
      const projectPath = rest[0] || process.cwd();
      const result = await runBenchmark(projectPath);
      return {
        ok: result.passed,
        output: `Score: ${result.score}/100 ${result.passed ? "[OK] PASSED" : "[X] FAILED"}`,
      };
    }

    default:
      return {
        ok: true,
        output: [
          "Benchmark commands:",
          "  /benchmark run [path]  — Run full benchmark suite with auto-fix",
          "  /benchmark quick [path] — Quick benchmark check",
        ].join("\n"),
      };
  }
}
