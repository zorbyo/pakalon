/**
 * XML Test File Generator - Generates validated XML test files
 * Produces whitebox_testing.xml and blackbox_testing.xml for Phase 4
 */

import * as path from "path";
import * as fs from "fs/promises";
import type {
  TestCase,
  TestSuite,
  TestSubsection,
  TestMetadata,
  TestSummary,
  XmlGenerationOptions,
  SecurityFinding,
} from "./testTypes.js";
import type { WhiteboxTestSuite } from "./whiteboxTests.js";
import type { BlackboxTestSuite } from "./blackboxTests.js";

const XML_SCHEMA_VERSION = "1.0";
const XML_ENCODING = "UTF-8";

export class XmlTestGenerator {
  private options: XmlGenerationOptions;

  constructor(options: XmlGenerationOptions) {
    this.options = options;
  }

  public async generateWhiteboxXml(suites: WhiteboxTestSuite[]): Promise<string> {
    const metadata = this.buildMetadata();
    const summary = this.calculateSummary(suites);

    const xmlParts: string[] = [];
    xmlParts.push(
      `<?xml version="${XML_SCHEMA_VERSION}" encoding="${XML_ENCODING}"?>`,
      `<!-- Pakalon Phase-4 White-Box Testing`,
      `     Tests examine internal structure, code paths, and architecture.`,
      `     Generated: ${metadata.timestamp}`,
      `     Schema Version: ${XML_SCHEMA_VERSION} -->`,
      `<whitebox-tests`,
      `  xmlns="https://pakalon.ai/schema/testing/whitebox"`,
      `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
      `  schemaVersion="${XML_SCHEMA_VERSION}">`,
    );

    xmlParts.push(this.serializeMetadata(metadata));
    const findingsXml = this.serializeSecurityFindings(2);
    if (findingsXml) {
      xmlParts.push(findingsXml);
    }

    for (const suite of suites) {
      xmlParts.push(this.serializeWhiteboxSuite(suite));
    }

    xmlParts.push(this.serializeSummary(summary));
    xmlParts.push("</whitebox-tests>");

    return xmlParts.join("\n");
  }

  public async generateBlackboxXml(suites: BlackboxTestSuite[]): Promise<string> {
    const metadata = this.buildMetadata();
    const summary = this.calculateSummary(suites);

    const xmlParts: string[] = [];
    xmlParts.push(
      `<?xml version="${XML_SCHEMA_VERSION}" encoding="${XML_ENCODING}"?>`,
      `<!-- Pakalon Phase-4 Black-Box Testing`,
      `     Tests validate the application from the user's perspective (user stories).`,
      `     Generated: ${metadata.timestamp}`,
      `     Schema Version: ${XML_SCHEMA_VERSION} -->`,
      `<blackbox-tests`,
      `  xmlns="https://pakalon.ai/schema/testing/blackbox"`,
      `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
      `  schemaVersion="${XML_SCHEMA_VERSION}">`,
    );

    xmlParts.push(this.serializeMetadata(metadata));
    const findingsXml = this.serializeSecurityFindings(2);
    if (findingsXml) {
      xmlParts.push(findingsXml);
    }

    for (const suite of suites) {
      xmlParts.push(this.serializeBlackboxSuite(suite));
    }

    xmlParts.push(this.serializeSummary(summary));
    xmlParts.push("</blackbox-tests>");

    return xmlParts.join("\n");
  }

  public async writeXmlFiles(
    whiteboxContent: string,
    blackboxContent: string,
  ): Promise<{ whiteboxPath: string; blackboxPath: string }> {
    const outputDir = this.options.outputDir;
    await fs.mkdir(outputDir, { recursive: true });

    const whiteboxPath = path.join(outputDir, "whitebox_testing.xml");
    const blackboxPath = path.join(outputDir, "blackbox_testing.xml");

    await fs.writeFile(whiteboxPath, whiteboxContent, "utf8");
    await fs.writeFile(blackboxPath, blackboxContent, "utf8");

    return { whiteboxPath, blackboxPath };
  }

  private buildMetadata(): TestMetadata {
    return {
      timestamp: new Date().toISOString(),
      project: this.options.projectDir,
      phase: 4,
      generator: "pakalon-cli/testing/xmlGenerator",
      schemaVersion: XML_SCHEMA_VERSION,
    };
  }

  private calculateSummary(suites: Array<WhiteboxTestSuite | BlackboxTestSuite>): TestSummary {
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let pending = 0;
    let error = 0;
    let criticalFailures = 0;
    let highFailures = 0;

    const countTests = (tests: TestCase[]) => {
      for (const test of tests) {
        totalTests++;
        switch (test.status) {
          case "passed":
            passed++;
            break;
          case "failed":
            failed++;
            if (test.severity === "critical") criticalFailures++;
            if (test.severity === "high") highFailures++;
            break;
          case "skipped":
            skipped++;
            break;
          case "pending":
            pending++;
            break;
          case "error":
            error++;
            break;
        }
      }
    };

    for (const suite of suites) {
      countTests(suite.tests);
      if ("subsections" in suite && suite.subsections) {
        for (const subsection of suite.subsections) {
          countTests(subsection.tests);
        }
      }
    }

    return {
      totalTests,
      passed,
      failed,
      skipped,
      pending,
      error,
      duration: 0,
      criticalFailures,
      highFailures,
    };
  }

  private serializeMetadata(metadata: TestMetadata): string {
    return [
      "  <metadata>",
      `    <timestamp>${this.escapeXml(metadata.timestamp)}</timestamp>`,
      `    <project>${this.escapeXml(metadata.project)}</project>`,
      `    <phase>${metadata.phase}</phase>`,
      `    <generator>${this.escapeXml(metadata.generator)}</generator>`,
      `    <schemaVersion>${metadata.schemaVersion}</schemaVersion>`,
      "  </metadata>",
    ].join("\n");
  }

  private serializeSecurityFindings(indent: number): string {
    const findings = this.options.securityFindings ?? [];
    if (findings.length === 0) return "";

    const pad = " ".repeat(indent);
    const childPad = " ".repeat(indent + 2);
    const fieldPad = " ".repeat(indent + 4);

    const entries = findings.map((finding, index) => {
      const id = finding.rule || `finding-${String(index + 1).padStart(3, "0")}`;
      return [
        `${childPad}<finding id="${this.escapeXml(id)}" tool="${this.escapeXml(finding.tool)}" severity="${this.escapeXml(finding.severity)}">`,
        `${fieldPad}<file>${this.escapeXml(finding.file)}</file>`,
        finding.line ? `${fieldPad}<line>${finding.line}</line>` : "",
        `${fieldPad}<message>${this.escapeXml(finding.message)}</message>`,
        finding.description ? `${fieldPad}<description>${this.escapeXml(finding.description)}</description>` : "",
        finding.recommendation ? `${fieldPad}<recommendation>${this.escapeXml(finding.recommendation)}</recommendation>` : "",
        `${childPad}</finding>`,
      ].filter(Boolean).join("\n");
    });

    return [
      `${pad}<findings count="${findings.length}">`,
      ...entries,
      `${pad}</findings>`,
    ].join("\n");
  }

  private serializeWhiteboxSuite(suite: WhiteboxTestSuite): string {
    const parts: string[] = [];
    parts.push(`  <test-suite id="${suite.id}" name="${this.escapeXml(suite.name)}" type="whitebox">`);
    parts.push(`    <description>${this.escapeXml(suite.description)}</description>`);

    if (suite.codeAnalysis && suite.codeAnalysis.staticAnalysis.length > 0) {
      parts.push("    <code-analysis>");
      parts.push("      <static-analysis>");
      for (const entry of suite.codeAnalysis.staticAnalysis) {
        parts.push(
          `        <analysis tool="${this.escapeXml(entry.tool)}" status="${entry.status}">`,
          `          <description>${this.escapeXml(entry.description)}</description>`,
          `          <issuesFound>${entry.issuesFound}</issuesFound>`,
          `          <rulesApplied>${entry.rulesApplied}</rulesApplied>`,
          "        </analysis>",
        );
      }
      parts.push("      </static-analysis>");

      if (suite.codeAnalysis.coverageTargets.length > 0) {
        parts.push("      <coverage-targets>");
        for (const target of suite.codeAnalysis.coverageTargets) {
          parts.push(
            `        <target module="${this.escapeXml(target.module)}" percentage="${target.targetPercentage}"${target.currentPercentage ? ` current="${target.currentPercentage}"` : ""} />`,
          );
        }
        parts.push("      </coverage-targets>");
      }
      parts.push("    </code-analysis>");
    }

    if (suite.dependencyAnalysis && suite.dependencyAnalysis.scans.length > 0) {
      parts.push("    <dependency-analysis>");
      for (const scan of suite.dependencyAnalysis.scans) {
        parts.push(
          `      <scan tool="${this.escapeXml(scan.tool)}" status="${scan.status}">`,
          `        <description>${this.escapeXml(scan.description)}</description>`,
          `        <vulnerabilities>${scan.vulnerabilities}</vulnerabilities>`,
          `        <outdatedPackages>${scan.outdatedPackages}</outdatedPackages>`,
          "      </scan>",
        );
      }
      parts.push("    </dependency-analysis>");
    }

    if (suite.architectureValidation && suite.architectureValidation.checks.length > 0) {
      parts.push("    <architecture-validation>");
      for (const check of suite.architectureValidation.checks) {
        parts.push(`      <check name="${this.escapeXml(check.name)}" status="${check.status}">`);
        parts.push(`        <description>${this.escapeXml(check.description)}</description>`);
        if (check.violations.length > 0) {
          parts.push("        <violations>");
          for (const violation of check.violations) {
            parts.push(`          <violation>${this.escapeXml(violation)}</violation>`);
          }
          parts.push("        </violations>");
        }
        parts.push("      </check>");
      }
      parts.push("    </architecture-validation>");
    }

    if ("subsections" in suite && suite.subsections && suite.subsections.length > 0) {
      for (const subsection of suite.subsections) {
        parts.push(
          `    <subsection id="${subsection.id}" name="${this.escapeXml(subsection.name)}">`,
        );
        parts.push(`      <description>${this.escapeXml(subsection.description)}</description>`);
        for (const test of subsection.tests) {
          parts.push(this.serializeTestCase(test, 6));
        }
        parts.push("    </subsection>");
      }
    }

    for (const test of suite.tests) {
      parts.push(this.serializeTestCase(test, 4));
    }

    parts.push("  </test-suite>");
    return parts.join("\n");
  }

  private serializeBlackboxSuite(suite: BlackboxTestSuite): string {
    const parts: string[] = [];
    parts.push(`  <test-suite id="${suite.id}" name="${this.escapeXml(suite.name)}" type="blackbox">`);
    parts.push(`    <description>${this.escapeXml(suite.description)}</description>`);

    if (suite.userStories.stories.length > 0) {
      parts.push("    <user-stories>");
      for (const story of suite.userStories.stories) {
        parts.push(
          `      <story id="${story.id}" title="${this.escapeXml(story.title)}">`,
          "        <acceptance-criteria>",
        );
        for (const criterion of story.acceptanceCriteria) {
          parts.push(`          <criterion>${this.escapeXml(criterion)}</criterion>`);
        }
        parts.push(
          "        </acceptance-criteria>",
          `        <test-count>${story.tests.length}</test-count>`,
          "      </story>",
        );
      }
      parts.push("    </user-stories>");
    }

    if (suite.apiTests.endpoints.length > 0) {
      parts.push("    <api-tests>");
      for (const endpoint of suite.apiTests.endpoints) {
        parts.push(
          `      <endpoint method="${endpoint.method}" path="${this.escapeXml(endpoint.path)}">`,
          `        <description>${this.escapeXml(endpoint.description)}</description>`,
          `        <test-count>${endpoint.tests.length}</test-count>`,
          "      </endpoint>",
        );
      }
      parts.push("    </api-tests>");
    }

    if (suite.integrationTests.flows.length > 0) {
      parts.push("    <integration-flows>");
      for (const flow of suite.integrationTests.flows) {
        parts.push(
          `      <flow name="${this.escapeXml(flow.name)}">`,
          `        <description>${this.escapeXml(flow.description)}</description>`,
          "        <steps>",
        );
        for (const step of flow.steps) {
          parts.push(
            `          <step testCaseId="${step.testCaseId}">`,
            `            <action>${this.escapeXml(step.action)}</action>`,
            `            <expectedOutcome>${this.escapeXml(step.expectedOutcome)}</expectedOutcome>`,
            "          </step>",
          );
        }
        parts.push("        </steps>", "      </flow>");
      }
      parts.push("    </integration-flows>");
    }

    for (const test of suite.tests) {
      parts.push(this.serializeTestCase(test, 4));
    }

    parts.push("  </test-suite>");
    return parts.join("\n");
  }

  private serializeTestCase(test: TestCase, indent: number): string {
    const pad = " ".repeat(indent);
    const parts: string[] = [];

    const attrs = [
      `id="${test.id}"`,
      `name="${this.escapeXml(test.name)}"`,
      `severity="${test.severity}"`,
      `status="${test.status}"`,
    ];

    if (test.component) attrs.push(`component="${this.escapeXml(test.component)}"`);
    if (test.userStory) attrs.push(`userStory="${this.escapeXml(test.userStory)}"`);
    if (test.codePath) attrs.push(`codePath="${this.escapeXml(test.codePath)}"`);

    parts.push(`${pad}<test ${attrs.join(" ")}>`);
    parts.push(`${pad}  <description>${this.escapeXml(test.description)}</description>`);

    if (test.preconditions && test.preconditions.length > 0) {
      parts.push(`${pad}  <preconditions>`);
      for (const pre of test.preconditions) {
        parts.push(`${pad}    <condition>${this.escapeXml(pre)}</condition>`);
      }
      parts.push(`${pad}  </preconditions>`);
    }

    if (test.steps && test.steps.length > 0) {
      parts.push(`${pad}  <steps>`);
      for (let i = 0; i < test.steps.length; i++) {
        parts.push(`${pad}    <step index="${i + 1}">${this.escapeXml(test.steps[i])}</step>`);
      }
      parts.push(`${pad}  </steps>`);
    }

    if (test.expectedResults && test.expectedResults.length > 0) {
      parts.push(`${pad}  <expected-results>`);
      for (let i = 0; i < test.expectedResults.length; i++) {
        parts.push(
          `${pad}    <result index="${i + 1}">${this.escapeXml(test.expectedResults[i])}</result>`,
        );
      }
      parts.push(`${pad}  </expected-results>`);
    }

    if (test.tags && test.tags.length > 0) {
      parts.push(`${pad}  <tags>`);
      for (const tag of test.tags) {
        parts.push(`${pad}    <tag>${this.escapeXml(tag)}</tag>`);
      }
      parts.push(`${pad}  </tags>`);
    }

    if (test.error) {
      parts.push(`${pad}  <error>${this.escapeXml(test.error)}</error>`);
    }

    if (test.duration) {
      parts.push(`${pad}  <duration>${test.duration}</duration>`);
    }

    parts.push(`${pad}</test>`);
    return parts.join("\n");
  }

  private serializeSummary(summary: TestSummary): string {
    return [
      "  <summary>",
      `    <totalTests>${summary.totalTests}</totalTests>`,
      `    <passed>${summary.passed}</passed>`,
      `    <failed>${summary.failed}</failed>`,
      `    <skipped>${summary.skipped}</skipped>`,
      `    <pending>${summary.pending}</pending>`,
      `    <error>${summary.error}</error>`,
      `    <criticalFailures>${summary.criticalFailures}</criticalFailures>`,
      `    <highFailures>${summary.highFailures}</highFailures>`,
      "  </summary>",
    ].join("\n");
  }

  private escapeXml(value: string | number | undefined | null): string {
    if (value === undefined || value === null) return "";
    const str = String(value);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

export async function generateTestingXmlFiles(options: XmlGenerationOptions): Promise<{
  whiteboxPath: string;
  blackboxPath: string;
  whiteboxContent: string;
  blackboxContent: string;
}> {
  const generator = new XmlTestGenerator(options);

  const { WhiteboxTestGenerator } = await import("./whiteboxTests.js");
  const { BlackboxTestGenerator } = await import("./blackboxTests.js");

  const metadata: TestMetadata = {
    timestamp: new Date().toISOString(),
    project: options.projectDir,
    phase: 4,
    generator: "pakalon-cli/testing/xmlGenerator",
    schemaVersion: XML_SCHEMA_VERSION,
  };

  const whiteboxGen = new WhiteboxTestGenerator(
    options.projectDir,
    metadata,
    options.securityFindings || [],
    options.scanResults || new Map(),
  );

  const blackboxGen = new BlackboxTestGenerator(
    options.projectDir,
    metadata,
    options.securityFindings || [],
  );

  const whiteboxSuites = await whiteboxGen.generate();
  const blackboxSuites = await blackboxGen.generate();

  const whiteboxContent = await generator.generateWhiteboxXml(whiteboxSuites);
  const blackboxContent = await generator.generateBlackboxXml(blackboxSuites);

  const paths = await generator.writeXmlFiles(whiteboxContent, blackboxContent);

  return {
    ...paths,
    whiteboxContent,
    blackboxContent,
  };
}
