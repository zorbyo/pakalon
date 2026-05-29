/**
 * SonarQube Integration
 *
 * Provides SonarQube Community Edition integration for code quality and security analysis.
 * Supports both local Docker and remote SonarQube instances.
 *
 * Features:
 * - Project analysis
 * - Issue retrieval
 * - Quality gate status
 * - Metrics extraction
 * - Docker-based local scanning
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SonarQubeConfig {
  /** SonarQube server URL */
  serverUrl: string;
  /** Authentication token */
  token?: string;
  /** Project key */
  projectKey: string;
  /** Project name */
  projectName?: string;
  /** Source directories */
  sources?: string[];
  /** Exclusions */
  exclusions?: string[];
}

export type IssueSeverity = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";

export type IssueType = "BUG" | "VULNERABILITY" | "CODE_SMELL";

export interface SonarIssue {
  /** Issue key */
  key: string;
  /** Rule */
  rule: string;
  /** Severity */
  severity: IssueSeverity;
  /** Type */
  type: IssueType;
  /** Message */
  message: string;
  /** Component (file) */
  component: string;
  /** Line number */
  line?: number;
  /** Status */
  status: string;
  /** Effort */
  effort?: string;
}

export interface SonarMetrics {
  /** Lines of code */
  lines: number;
  /** Lines to cover */
  linesToCover: number;
  /** Covered lines */
  coveredLines: number;
  /** Coverage percentage */
  coverage: number;
  /** Number of bugs */
  bugs: number;
  /** Number of vulnerabilities */
  vulnerabilities: number;
  /** Number of code smells */
  codeSmells: number;
  /** Number of duplications */
  duplications: number;
  /** Maintainability rating */
  maintainabilityRating: string;
  /** Security rating */
  securityRating: string;
  /** Reliability rating */
  reliabilityRating: string;
}

export interface SonarAnalysisResult {
  /** Whether analysis was successful */
  success: boolean;
  /** Project key */
  projectKey: string;
  /** Issues found */
  issues: SonarIssue[];
  /** Metrics */
  metrics: SonarMetrics;
  /** Quality gate status */
  qualityGateStatus: "PASSED" | "FAILED" | "WARN";
  /** Duration in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// SonarQube Client
// ---------------------------------------------------------------------------

class SonarQubeClient {
  private config: SonarQubeConfig;

  constructor(config: SonarQubeConfig) {
    this.config = config;
  }

  /**
   * Make API request to SonarQube
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.config.serverUrl}/api/${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.config.token) {
      headers.Authorization = `Basic ${Buffer.from(`${this.config.token}:`).toString("base64")}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`SonarQube API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get project issues
   */
  async getIssues(severities?: IssueSeverity[]): Promise<SonarIssue[]> {
    const issues: SonarIssue[] = [];
    let page = 1;
    const pageSize = 100;

    while (true) {
      const params: Record<string, string> = {
        componentKeys: this.config.projectKey,
        ps: String(pageSize),
        p: String(page),
        resolved: "false",
      };

      if (severities && severities.length > 0) {
        params.severities = severities.join(",");
      }

      const response = await this.request<{
        issues: SonarIssue[];
        total: number;
      }>("issues/search", params);

      issues.push(...response.issues);

      if (issues.length >= response.total || response.issues.length === 0) {
        break;
      }

      page++;
    }

    return issues;
  }

  /**
   * Get project metrics
   */
  async getMetrics(): Promise<SonarMetrics> {
    const metrics = [
      "lines",
      "lines_to_cover",
      "covered_lines",
      "coverage",
      "bugs",
      "vulnerabilities",
      "code_smells",
      "duplicated_lines_density",
      "maintainability_rating",
      "security_rating",
      "reliability_rating",
    ].join(",");

    const response = await this.request<{
      component: {
        measures: Array<{ metric: string; value: string }>;
      };
    }>("measures/component", {
      component: this.config.projectKey,
      metricKeys: metrics,
    });

    const measures = response.component.measures;
    const getMeasure = (key: string) =>
      measures.find((m) => m.metric === key)?.value || "0";

    return {
      lines: parseInt(getMeasure("lines")) || 0,
      linesToCover: parseInt(getMeasure("lines_to_cover")) || 0,
      coveredLines: parseInt(getMeasure("covered_lines")) || 0,
      coverage: parseFloat(getMeasure("coverage")) || 0,
      bugs: parseInt(getMeasure("bugs")) || 0,
      vulnerabilities: parseInt(getMeasure("vulnerabilities")) || 0,
      codeSmells: parseInt(getMeasure("code_smells")) || 0,
      duplications: parseFloat(getMeasure("duplicated_lines_density")) || 0,
      maintainabilityRating: getMeasure("maintainability_rating"),
      securityRating: getMeasure("security_rating"),
      reliabilityRating: getMeasure("reliability_rating"),
    };
  }

  /**
   * Get quality gate status
   */
  async getQualityGateStatus(): Promise<"PASSED" | "FAILED" | "WARN"> {
    try {
      const response = await this.request<{
        projectStatus: { status: string };
      }>("qualitygates/project_status", {
        projectKey: this.config.projectKey,
      });

      const status = response.projectStatus.status;
      if (status === "OK") return "PASSED";
      if (status === "ERROR") return "FAILED";
      return "WARN";
    } catch {
      return "WARN";
    }
  }

  /**
   * Run analysis using sonar-scanner
   */
  async runAnalysis(): Promise<void> {
    const sources = this.config.sources?.join(",") || ".";

    // Create sonar-project.properties
    const props = [
      `sonar.projectKey=${this.config.projectKey}`,
      `sonar.projectName=${this.config.projectName || this.config.projectKey}`,
      `sonar.sources=${sources}`,
      this.config.exclusions?.length
        ? `sonar.exclusions=${this.config.exclusions.join(",")}`
        : "",
      `sonar.host.url=${this.config.serverUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    const propsPath = path.join(process.cwd(), "sonar-project.properties");
    fs.writeFileSync(propsPath, props, "utf-8");

    try {
      // Run sonar-scanner
      const { execSync } = await import("child_process");
      execSync("sonar-scanner", {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 300000, // 5 minutes
      });
    } finally {
      // Cleanup
      if (fs.existsSync(propsPath)) {
        fs.unlinkSync(propsPath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Run SonarQube analysis
 */
export async function runSonarAnalysis(
  config: SonarQubeConfig
): Promise<SonarAnalysisResult> {
  const startTime = Date.now();
  const client = new SonarQubeClient(config);

  logger.info(`[SonarQube] Starting analysis for project: ${config.projectKey}`);

  try {
    // Run scanner if server is local
    if (config.serverUrl.includes("localhost") || config.serverUrl.includes("127.0.0.1")) {
      logger.info("[SonarQube] Running local scanner...");
      await client.runAnalysis();
    }

    // Get results
    const [issues, metrics, qualityGateStatus] = await Promise.all([
      client.getIssues(),
      client.getMetrics(),
      client.getQualityGateStatus(),
    ]);

    const duration = Date.now() - startTime;
    logger.info(
      `[SonarQube] Analysis completed in ${duration}ms: ${issues.length} issues, ${qualityGateStatus}`
    );

    return {
      success: true,
      projectKey: config.projectKey,
      issues,
      metrics,
      qualityGateStatus,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    logger.error(`[SonarQube] Analysis failed: ${message}`);

    return {
      success: false,
      projectKey: config.projectKey,
      issues: [],
      metrics: {
        lines: 0,
        linesToCover: 0,
        coveredLines: 0,
        coverage: 0,
        bugs: 0,
        vulnerabilities: 0,
        codeSmells: 0,
        duplications: 0,
        maintainabilityRating: "E",
        securityRating: "E",
        reliabilityRating: "E",
      },
      qualityGateStatus: "FAILED",
      duration,
      error: message,
    };
  }
}

/**
 * Check if SonarQube is available
 */
export async function isSonarQubeAvailable(
  serverUrl: string
): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/api/system/ping`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
