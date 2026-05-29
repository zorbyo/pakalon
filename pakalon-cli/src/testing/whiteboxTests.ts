/**
 * Whitebox Test Generation - Generates internal code structure tests
 * Tests examine code paths, architecture, complexity, and internal logic
 */

import * as path from "path";
import * as fs from "fs/promises";
import type {
  TestCase,
  TestSuite,
  TestSubsection,
  CodeAnalysisSection,
  DependencyAnalysisSection,
  ArchitectureValidationSection,
  StaticAnalysisEntry,
  ComplexityMetric,
  CoverageTarget,
  DependencyScanEntry,
  ArchitectureCheck,
  TestMetadata,
  SecurityFinding,
  TestSeverity,
} from "./testTypes.js";

interface ProjectStructure {
  files: string[];
  directories: string[];
  techStack: string[];
  entryPoints: string[];
}

export class WhiteboxTestGenerator {
  private projectDir: string;
  private metadata: TestMetadata;
  private securityFindings: SecurityFinding[];
  private scanResults: Map<string, { issues: number; error?: string }>;

  constructor(
    projectDir: string,
    metadata: TestMetadata,
    securityFindings: SecurityFinding[] = [],
    scanResults: Map<string, { issues: number; error?: string }> = new Map(),
  ) {
    this.projectDir = projectDir;
    this.metadata = metadata;
    this.securityFindings = securityFindings;
    this.scanResults = scanResults;
  }

  public async generate(): Promise<WhiteboxTestSuite[]> {
    const structure = await this.analyzeProjectStructure();
    const suites: WhiteboxTestSuite[] = [];

    suites.push(this.generateUnitTestSuite(structure));
    suites.push(this.generateIntegrationTestSuite(structure));
    suites.push(this.generateSecurityTestSuite());
    suites.push(this.generateArchitectureTestSuite(structure));
    suites.push(this.generateCodeQualityTestSuite(structure));

    return suites;
  }

  private async analyzeProjectStructure(): Promise<ProjectStructure> {
    const files: string[] = [];
    const directories: string[] = [];
    const techStack: string[] = [];
    const entryPoints: string[] = [];

    try {
      const packageJsonPath = path.join(this.projectDir, "package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

      if (packageJson.dependencies?.typescript || packageJson.devDependencies?.typescript) {
        techStack.push("typescript");
      }
      if (packageJson.dependencies?.react) techStack.push("react");
      if (packageJson.dependencies?.["next"]) techStack.push("nextjs");
      if (packageJson.dependencies?.express) techStack.push("express");
      if (packageJson.dependencies?.["fast-glob"]) techStack.push("fast-glob");
      if (packageJson.dependencies?.["better-sqlite3"]) techStack.push("sqlite");
      if (packageJson.dependencies?.["drizzle-orm"]) techStack.push("drizzle");
      if (packageJson.dependencies?.zod) techStack.push("zod");
      if (packageJson.dependencies?.zustand) techStack.push("zustand");
      if (packageJson.dependencies?.ink) techStack.push("ink");

      entryPoints.push("src/index.tsx", "src/cli.ts");
    } catch {
      techStack.push("unknown");
    }

    try {
      const srcDir = path.join(this.projectDir, "src");
      const entries = await fs.readdir(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          directories.push(entry.name);
          const subEntries = await fs.readdir(path.join(srcDir, entry.name));
          for (const sub of subEntries) {
            if (sub.endsWith(".ts") || sub.endsWith(".tsx")) {
              files.push(path.join("src", entry.name, sub));
            }
          }
        }
      }
    } catch {
      files.push("src/**/*.ts");
    }

    return { files, directories, techStack, entryPoints };
  }

  private generateUnitTestSuite(structure: ProjectStructure): WhiteboxTestSuite {
    const tests: TestCase[] = [];
    const subsections: TestSubsection[] = [];

    const coreModules = structure.directories.filter(
      (d) => !["__tests__", "node_modules", "dist"].includes(d),
    );

    for (const module of coreModules.slice(0, 15)) {
      const moduleTests: TestCase[] = [
        {
          id: `WT-${tests.length + subsections.reduce((a, s) => a + s.tests.length, 0) + 1}`,
          name: `${module} module exports`,
          description: `Verify ${module} module has valid exports`,
          severity: "high",
          status: "pending",
          component: module,
          codePath: `src/${module}/`,
          preconditions: ["Module directory exists"],
          steps: [
            `Import all exports from src/${module}/`,
            "Verify each export is defined",
            "Verify type signatures match declarations",
          ],
          expectedResults: ["All exports are defined", "Type signatures are correct"],
          tags: ["unit", "module", module],
        },
        {
          id: `WT-${tests.length + subsections.reduce((a, s) => a + s.tests.length, 0) + 2}`,
          name: `${module} error handling`,
          description: `Verify ${module} handles errors gracefully`,
          severity: "critical",
          status: "pending",
          component: module,
          codePath: `src/${module}/`,
          preconditions: ["Module is loaded"],
          steps: [
            "Invoke functions with invalid inputs",
            "Verify error objects are thrown/returned",
            "Verify error messages are descriptive",
          ],
          expectedResults: [
            "Errors are caught and handled",
            "Error messages are user-friendly",
            "No unhandled exceptions",
          ],
          tags: ["unit", "error-handling", module],
        },
        {
          id: `WT-${tests.length + subsections.reduce((a, s) => a + s.tests.length, 0) + 3}`,
          name: `${module} input validation`,
          description: `Verify ${module} validates all inputs`,
          severity: "high",
          status: "pending",
          component: module,
          codePath: `src/${module}/`,
          preconditions: ["Module is loaded"],
          steps: [
            "Pass null/undefined inputs",
            "Pass malformed data",
            "Pass boundary values",
          ],
          expectedResults: [
            "Invalid inputs are rejected",
            "Validation errors are clear",
            "No type coercion bugs",
          ],
          tags: ["unit", "validation", module],
        },
      ];

      subsections.push({
        id: `WB-${module.toUpperCase()}`,
        name: `${module} Unit Tests`,
        description: `Unit tests for the ${module} module`,
        tests: moduleTests,
      });
    }

    return {
      id: "WB-UNIT",
      name: "Unit Tests",
      description: "Internal code structure and logic tests",
      type: "whitebox",
      tests,
      subsections,
      codeAnalysis: this.generateCodeAnalysis(structure),
      dependencyAnalysis: this.generateDependencyAnalysis(),
      architectureValidation: this.generateArchitectureValidation(structure),
    };
  }

  private generateIntegrationTestSuite(structure: ProjectStructure): WhiteboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "WT-INT-001",
        name: "Module dependency graph",
        description: "Verify no circular dependencies exist between modules",
        severity: "critical",
        status: "pending",
        component: "architecture",
        preconditions: ["All modules are compiled"],
        steps: [
          "Build the dependency graph",
          "Detect cycles using DFS",
          "Report any circular references",
        ],
        expectedResults: ["No circular dependencies", "Clean DAG structure"],
        tags: ["integration", "architecture"],
      },
      {
        id: "WT-INT-002",
        name: "Cross-module type compatibility",
        description: "Verify types are compatible across module boundaries",
        severity: "high",
        status: "pending",
        component: "types",
        preconditions: ["TypeScript compiler is available"],
        steps: ["Run tsc --noEmit", "Check for type errors", "Verify interface contracts"],
        expectedResults: ["Zero type errors", "All interfaces satisfied"],
        tags: ["integration", "types"],
      },
      {
        id: "WT-INT-003",
        name: "Event flow integrity",
        description: "Verify event emitters and listeners are properly connected",
        severity: "high",
        status: "pending",
        component: "events",
        preconditions: ["Event system is initialized"],
        steps: [
          "Register event listeners",
          "Emit events from producers",
          "Verify all listeners receive events",
        ],
        expectedResults: ["All events are received", "No orphaned listeners"],
        tags: ["integration", "events"],
      },
      {
        id: "WT-INT-004",
        name: "State management consistency",
        description: "Verify state transitions are valid and atomic",
        severity: "critical",
        status: "pending",
        component: "state",
        preconditions: ["State store is initialized"],
        steps: [
          "Trigger state transitions",
          "Verify intermediate states are valid",
          "Verify rollback on failure",
        ],
        expectedResults: [
          "State transitions are atomic",
          "No invalid intermediate states",
          "Rollback works correctly",
        ],
        tags: ["integration", "state"],
      },
      {
        id: "WT-INT-005",
        name: "Pipeline phase handoff",
        description: "Verify data flows correctly between pipeline phases",
        severity: "critical",
        status: "pending",
        component: "pipeline",
        preconditions: ["Pipeline is configured"],
        steps: [
          "Execute Phase 1, capture output",
          "Pass output to Phase 2",
          "Verify Phase 2 consumes correctly",
          "Repeat for all phases",
        ],
        expectedResults: [
          "All phase outputs are valid inputs for next phase",
          "No data loss between phases",
        ],
        tags: ["integration", "pipeline"],
      },
    ];

    return {
      id: "WB-INT",
      name: "Integration Tests",
      description: "Cross-module integration and data flow tests",
      type: "whitebox",
      tests,
      codeAnalysis: {
        staticAnalysis: [],
        complexityMetrics: [],
        coverageTargets: [],
      },
      dependencyAnalysis: { scans: [] },
      architectureValidation: { checks: [] },
    };
  }

  private generateSecurityTestSuite(): WhiteboxTestSuite {
    const tests: TestCase[] = [];

    const severityMap: Record<string, TestSeverity> = {
      CRITICAL: "critical",
      HIGH: "high",
      MEDIUM: "medium",
      LOW: "low",
      INFO: "info",
    };

    for (const finding of this.securityFindings.slice(0, 50)) {
      tests.push({
        id: `WT-SEC-${String(tests.length + 1).padStart(3, "0")}`,
        name: `Security: ${finding.rule || finding.tool}`,
        description: finding.message,
        severity: severityMap[finding.severity] || "medium",
        status: "failed",
        component: finding.file,
        codePath: finding.file,
        preconditions: [`File ${finding.file} exists`],
        steps: [
          `Locate issue at ${finding.file}${finding.line ? `:${finding.line}` : ""}`,
          "Analyze the vulnerability pattern",
          "Apply remediation",
          "Re-run security scan",
        ],
        expectedResults: ["Vulnerability is patched", "No regression introduced"],
        error: finding.message,
        tags: ["security", finding.tool, finding.severity.toLowerCase()],
      });
    }

    const defaultSecurityTests: TestCase[] = [
      {
        id: "WT-SEC-DEFAULT-001",
        name: "Input sanitization",
        description: "Verify all user inputs are sanitized before processing",
        severity: "critical",
        status: "pending",
        component: "security",
        preconditions: ["Application is running"],
        steps: [
          "Inject XSS payloads",
          "Inject SQL injection patterns",
          "Inject path traversal sequences",
        ],
        expectedResults: ["All payloads are sanitized", "No injection succeeds"],
        tags: ["security", "sanitization"],
      },
      {
        id: "WT-SEC-DEFAULT-002",
        name: "Secret management",
        description: "Verify no hardcoded secrets in source code",
        severity: "critical",
        status: "pending",
        component: "security",
        preconditions: ["Source code is accessible"],
        steps: [
          "Scan for API keys patterns",
          "Scan for password literals",
          "Scan for token patterns",
        ],
        expectedResults: ["No hardcoded secrets", "All secrets use env vars"],
        tags: ["security", "secrets"],
      },
      {
        id: "WT-SEC-DEFAULT-003",
        name: "Dependency vulnerabilities",
        description: "Verify dependencies have no known vulnerabilities",
        severity: "high",
        status: "pending",
        component: "dependencies",
        preconditions: ["package.json exists"],
        steps: ["Run npm audit", "Check for critical vulnerabilities", "Verify patches available"],
        expectedResults: ["No critical vulnerabilities", "All deps are up to date"],
        tags: ["security", "dependencies"],
      },
    ];

    return {
      id: "WB-SEC",
      name: "Security Tests",
      description: "Internal security analysis and vulnerability tests",
      type: "whitebox",
      tests: [...defaultSecurityTests, ...tests],
      codeAnalysis: {
        staticAnalysis: this.generateSecurityAnalysis(),
        complexityMetrics: [],
        coverageTargets: [],
      },
      dependencyAnalysis: this.generateDependencyAnalysis(),
      architectureValidation: { checks: [] },
    };
  }

  private generateArchitectureTestSuite(structure: ProjectStructure): WhiteboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "WT-ARCH-001",
        name: "Layered architecture compliance",
        description: "Verify code follows layered architecture pattern",
        severity: "medium",
        status: "pending",
        component: "architecture",
        preconditions: ["Source code is structured"],
        steps: [
          "Identify presentation layer imports",
          "Identify business logic layer imports",
          "Identify data access layer imports",
          "Verify no cross-layer violations",
        ],
        expectedResults: [
          "Presentation only imports from business logic",
          "Business logic only imports from data access",
          "No circular layer dependencies",
        ],
        tags: ["architecture", "layers"],
      },
      {
        id: "WT-ARCH-002",
        name: "Module boundary enforcement",
        description: "Verify modules respect their public API boundaries",
        severity: "high",
        status: "pending",
        component: "architecture",
        preconditions: ["Module boundaries are defined"],
        steps: [
          "Identify internal vs exported symbols",
          "Check for internal symbol access from outside",
          "Verify barrel exports are correct",
        ],
        expectedResults: [
          "No internal symbol leakage",
          "Public API is stable",
          "Barrel exports are intentional",
        ],
        tags: ["architecture", "boundaries"],
      },
      {
        id: "WT-ARCH-003",
        name: "Dependency inversion principle",
        description: "Verify high-level modules don't depend on low-level modules",
        severity: "medium",
        status: "pending",
        component: "architecture",
        preconditions: ["Dependency graph is built"],
        steps: [
          "Identify high-level modules",
          "Identify low-level modules",
          "Check for direct dependencies",
          "Verify abstraction layers exist",
        ],
        expectedResults: [
          "High-level modules depend on abstractions",
          "Low-level modules implement abstractions",
          "No direct high-to-low dependencies",
        ],
        tags: ["architecture", "dip"],
      },
    ];

    return {
      id: "WB-ARCH",
      name: "Architecture Tests",
      description: "Structural architecture validation tests",
      type: "whitebox",
      tests,
      codeAnalysis: { staticAnalysis: [], complexityMetrics: [], coverageTargets: [] },
      dependencyAnalysis: { scans: [] },
      architectureValidation: this.generateArchitectureValidation(structure),
    };
  }

  private generateCodeQualityTestSuite(structure: ProjectStructure): WhiteboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "WT-QUAL-001",
        name: "TypeScript strict mode compliance",
        description: "Verify code compiles with strict TypeScript settings",
        severity: "high",
        status: "pending",
        component: "types",
        preconditions: ["tsconfig.json exists"],
        steps: ["Run tsc --strict --noEmit", "Check for any type errors", "Verify no implicit any"],
        expectedResults: ["Zero strict mode errors", "No implicit any usage"],
        tags: ["quality", "typescript"],
      },
      {
        id: "WT-QUAL-002",
        name: "Code complexity limits",
        description: "Verify functions don't exceed complexity thresholds",
        severity: "medium",
        status: "pending",
        component: "quality",
        preconditions: ["Source code is accessible"],
        steps: [
          "Calculate cyclomatic complexity per function",
          "Flag functions with complexity > 10",
          "Flag functions with > 50 lines",
        ],
        expectedResults: [
          "No function exceeds complexity 10",
          "No function exceeds 50 lines",
          "Complex functions are documented",
        ],
        tags: ["quality", "complexity"],
      },
      {
        id: "WT-QUAL-003",
        name: "Test coverage thresholds",
        description: "Verify test coverage meets minimum thresholds",
        severity: "high",
        status: "pending",
        component: "testing",
        preconditions: ["Tests exist and can run"],
        steps: [
          "Run test coverage analysis",
          "Check line coverage >= 80%",
          "Check branch coverage >= 70%",
          "Check function coverage >= 85%",
        ],
        expectedResults: [
          "Line coverage >= 80%",
          "Branch coverage >= 70%",
          "Function coverage >= 85%",
        ],
        tags: ["quality", "coverage"],
      },
      {
        id: "WT-QUAL-004",
        name: "Documentation coverage",
        description: "Verify public APIs have JSDoc documentation",
        severity: "low",
        status: "pending",
        component: "documentation",
        preconditions: ["Source code is accessible"],
        steps: [
          "Identify all exported functions/classes",
          "Check for JSDoc comments",
          "Verify parameter documentation",
          "Verify return type documentation",
        ],
        expectedResults: [
          "All exports have JSDoc",
          "Parameters are documented",
          "Return types are documented",
        ],
        tags: ["quality", "documentation"],
      },
    ];

    return {
      id: "WB-QUAL",
      name: "Code Quality Tests",
      description: "Code quality, complexity, and coverage validation",
      type: "whitebox",
      tests,
      codeAnalysis: { staticAnalysis: [], complexityMetrics: [], coverageTargets: [] },
      dependencyAnalysis: { scans: [] },
      architectureValidation: { checks: [] },
    };
  }

  private generateCodeAnalysis(structure: ProjectStructure): CodeAnalysisSection {
    const staticAnalysis: StaticAnalysisEntry[] = [];

    for (const [tool, result] of Array.from(this.scanResults.entries())) {
      staticAnalysis.push({
        tool,
        status: result.error ? "error" : "passed",
        description: `${tool} security analysis`,
        issuesFound: result.issues,
        rulesApplied: 1,
      });
    }

    if (staticAnalysis.length === 0) {
      staticAnalysis.push(
        {
          tool: "eslint",
          status: "pending",
          description: "ESLint static analysis",
          issuesFound: 0,
          rulesApplied: 0,
        },
        {
          tool: "typescript",
          status: "pending",
          description: "TypeScript type checking",
          issuesFound: 0,
          rulesApplied: 0,
        },
      );
    }

    const coverageTargets: CoverageTarget[] = structure.directories
      .filter((d) => !["__tests__", "node_modules", "dist"].includes(d))
      .slice(0, 10)
      .map((dir) => ({
        module: dir,
        targetPercentage: 80,
      }));

    return {
      staticAnalysis,
      complexityMetrics: [],
      coverageTargets,
    };
  }

  private generateDependencyAnalysis(): DependencyAnalysisSection {
    const scans: DependencyScanEntry[] = [
      {
        tool: "npm-audit",
        status: "pending",
        description: "NPM dependency vulnerability scan",
        vulnerabilities: 0,
        outdatedPackages: 0,
      },
      {
        tool: "depcheck",
        status: "pending",
        description: "Unused dependency detection",
        vulnerabilities: 0,
        outdatedPackages: 0,
      },
    ];

    return { scans };
  }

  private generateArchitectureValidation(structure: ProjectStructure): ArchitectureValidationSection {
    const checks: ArchitectureCheck[] = [
      {
        name: "No circular dependencies",
        description: "Verify the module dependency graph has no cycles",
        status: "pending",
        violations: [],
      },
      {
        name: "Layer separation",
        description: "Verify UI, business logic, and data layers are separated",
        status: "pending",
        violations: [],
      },
      {
        name: "Interface contracts",
        description: "Verify all interface contracts are satisfied",
        status: "pending",
        violations: [],
      },
      {
        name: "Entry point isolation",
        description: "Verify entry points don't expose internal modules",
        status: "pending",
        violations: [],
      },
    ];

    return { checks };
  }

  private generateSecurityAnalysis(): StaticAnalysisEntry[] {
    const entries: StaticAnalysisEntry[] = [];

    const toolCounts = new Map<string, number>();
    for (const finding of this.securityFindings) {
      toolCounts.set(finding.tool, (toolCounts.get(finding.tool) || 0) + 1);
    }

    for (const entry of Array.from(toolCounts.entries())) {
      const [tool, count] = entry;
      entries.push({
        tool,
        status: count > 0 ? "failed" : "passed",
        description: `${tool} security analysis`,
        issuesFound: count,
        rulesApplied: 1,
      });
    }

    return entries;
  }
}

export interface WhiteboxTestSuite {
  id: string;
  name: string;
  description: string;
  type: "whitebox";
  tests: TestCase[];
  subsections?: TestSubsection[];
  codeAnalysis: CodeAnalysisSection;
  dependencyAnalysis: DependencyAnalysisSection;
  architectureValidation: ArchitectureValidationSection;
}
