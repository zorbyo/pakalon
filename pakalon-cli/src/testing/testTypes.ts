/**
 * Testing Types - TypeScript type definitions for the XML test generation system
 */

export type TestSeverity = "critical" | "high" | "medium" | "low" | "info";

export type TestStatus = "passed" | "failed" | "skipped" | "pending" | "error";

export type TestType = "whitebox" | "blackbox";

export type XmlSchemaVersion = "1.0";

export interface TestMetadata {
  timestamp: string;
  project: string;
  phase: number;
  generator: string;
  schemaVersion: XmlSchemaVersion;
}

export interface TestAssertion {
  type: "equals" | "contains" | "matches" | "notNull" | "isNull" | "throws" | "notThrows" | "custom";
  expected?: string;
  message?: string;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  severity: TestSeverity;
  status: TestStatus;
  component?: string;
  userStory?: string;
  preconditions?: string[];
  steps?: string[];
  expectedResults?: string[];
  assertions?: TestAssertion[];
  codePath?: string;
  tags?: string[];
  duration?: number;
  error?: string;
  evidence?: string[];
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  type: TestType;
  tests: TestCase[];
  subsections?: TestSubsection[];
}

export interface TestSubsection {
  id: string;
  name: string;
  description: string;
  tests: TestCase[];
}

export interface TestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  error: number;
  duration: number;
  criticalFailures: number;
  highFailures: number;
}

export interface WhiteboxTestSuite extends TestSuite {
  type: "whitebox";
  codeAnalysis: CodeAnalysisSection;
  dependencyAnalysis: DependencyAnalysisSection;
  architectureValidation: ArchitectureValidationSection;
}

export interface BlackboxTestSuite extends TestSuite {
  type: "blackbox";
  userStories: UserStorySection;
  apiTests: ApiTestSection;
  integrationTests: IntegrationTestSection;
}

export interface CodeAnalysisSection {
  staticAnalysis: StaticAnalysisEntry[];
  complexityMetrics: ComplexityMetric[];
  coverageTargets: CoverageTarget[];
}

export interface StaticAnalysisEntry {
  tool: string;
  status: TestStatus;
  description: string;
  issuesFound: number;
  rulesApplied: number;
}

export interface ComplexityMetric {
  file: string;
  cyclomaticComplexity: number;
  linesOfCode: number;
  functionCount: number;
}

export interface CoverageTarget {
  module: string;
  targetPercentage: number;
  currentPercentage?: number;
}

export interface DependencyAnalysisSection {
  scans: DependencyScanEntry[];
}

export interface DependencyScanEntry {
  tool: string;
  status: TestStatus;
  description: string;
  vulnerabilities: number;
  outdatedPackages: number;
}

export interface ArchitectureValidationSection {
  checks: ArchitectureCheck[];
}

export interface ArchitectureCheck {
  name: string;
  description: string;
  status: TestStatus;
  violations: string[];
}

export interface UserStorySection {
  stories: UserStoryEntry[];
}

export interface UserStoryEntry {
  id: string;
  title: string;
  acceptanceCriteria: string[];
  tests: TestCase[];
}

export interface ApiTestSection {
  endpoints: ApiEndpointTest[];
}

export interface ApiEndpointTest {
  method: string;
  path: string;
  description: string;
  tests: TestCase[];
}

export interface IntegrationTestSection {
  flows: IntegrationFlow[];
}

export interface IntegrationFlow {
  name: string;
  description: string;
  steps: IntegrationStep[];
}

export interface IntegrationStep {
  action: string;
  expectedOutcome: string;
  testCaseId: string;
}

export interface TestReport {
  metadata: TestMetadata;
  whitebox: WhiteboxTestSuite[];
  blackbox: BlackboxTestSuite[];
  summary: TestSummary;
}

export interface XmlGenerationOptions {
  projectDir: string;
  outputDir: string;
  includeCodeAnalysis?: boolean;
  includeDependencyAnalysis?: boolean;
  includeArchitectureValidation?: boolean;
  includeUserStories?: boolean;
  includeApiTests?: boolean;
  includeIntegrationTests?: boolean;
  securityFindings?: SecurityFinding[];
  scanResults?: Map<string, { issues: number; error?: string }>;
}

export interface SecurityFinding {
  tool: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  file: string;
  line?: number;
  message: string;
  rule?: string;
  description?: string;
  recommendation?: string;
}

export interface TestRunnerConfig {
  projectDir: string;
  outputDir: string;
  whiteboxXmlPath: string;
  blackboxXmlPath: string;
  timeout?: number;
  parallel?: boolean;
}

export interface TestRunnerResult {
  success: boolean;
  whiteboxResults: TestSuiteResult[];
  blackboxResults: TestSuiteResult[];
  summary: TestSummary;
  duration: number;
  errors: string[];
}

export interface TestSuiteResult {
  suiteId: string;
  suiteName: string;
  results: TestCaseResult[];
  duration: number;
}

export interface TestCaseResult {
  testId: string;
  testName: string;
  status: TestStatus;
  duration?: number;
  error?: string;
  evidence?: string[];
}
