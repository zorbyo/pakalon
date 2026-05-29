/**
 * Testing Module - XML test file generation and execution for Phase 4
 *
 * Exports:
 * - WhiteboxTestGenerator: Generates internal code structure tests
 * - BlackboxTestGenerator: Generates user story behavioral tests
 * - XmlTestGenerator: Produces validated XML test files
 * - TestRunner: Executes and validates XML test definitions
 * - generateTestingXmlFiles: One-shot XML generation function
 * - runTests: Execute tests from XML files
 * - validateTestFiles: Validate XML schema compliance
 */

export { WhiteboxTestGenerator } from "./whiteboxTests.js";
export { BlackboxTestGenerator } from "./blackboxTests.js";
export { XmlTestGenerator, generateTestingXmlFiles } from "./xmlGenerator.js";
export { TestRunner, runTests, validateTestFiles } from "./testRunner.js";

export type {
  TestSeverity,
  TestStatus,
  TestType,
  XmlSchemaVersion,
  TestMetadata,
  TestAssertion,
  TestCase,
  TestSuite,
  TestSubsection,
  TestSummary,
  WhiteboxTestSuite,
  BlackboxTestSuite,
  CodeAnalysisSection,
  StaticAnalysisEntry,
  ComplexityMetric,
  CoverageTarget,
  DependencyAnalysisSection,
  DependencyScanEntry,
  ArchitectureValidationSection,
  ArchitectureCheck,
  UserStorySection,
  UserStoryEntry,
  ApiTestSection,
  ApiEndpointTest,
  IntegrationTestSection,
  IntegrationFlow,
  IntegrationStep,
  TestReport,
  XmlGenerationOptions,
  SecurityFinding,
  TestRunnerConfig,
  TestRunnerResult,
  TestSuiteResult,
  TestCaseResult,
} from "./testTypes.js";
