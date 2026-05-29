/**
 * /security-scan command - Run security analysis with SonarQube
 *
 * Usage:
 *   /security-scan - Run analysis with default settings
 *   /security-scan --server http://localhost:9000 - Specify server
 *   /security-scan --project-key my-project - Specify project key
 */

import { runSonarAnalysis, isSonarQubeAvailable } from "@/deepsec/scanner/sonarqube.js";
import type { CommandDefinition } from "./types.js";
import logger from "@/utils/logger.js";

export const securityScanCommandDefinition: CommandDefinition = {
  name: "security-scan",
  description: "Run SonarQube security analysis on the codebase",
  usage: "/security-scan [--server <url>] [--project-key <key>]",
  category: "advanced",
  requiresAuth: false,
  async execute(_context, args) {
    // Parse arguments
    let serverUrl = process.env.SONAR_SERVER_URL || "http://localhost:9000";
    let projectKey = process.env.SONAR_PROJECT_KEY || "";
    let token = process.env.SONAR_TOKEN;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--server" && args[i + 1]) {
        serverUrl = args[++i];
      } else if (args[i] === "--project-key" && args[i + 1]) {
        projectKey = args[++i];
      } else if (args[i] === "--token" && args[i + 1]) {
        token = args[++i];
      }
    }

    // Auto-detect project key from directory name if not provided
    if (!projectKey) {
      const path = await import("path");
      projectKey = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9]/g, "_");
    }

    try {
      logger.info(`[security-scan] Checking SonarQube at ${serverUrl}...`);

      // Check if SonarQube is available
      const isAvailable = await isSonarQubeAvailable(serverUrl);
      if (!isAvailable) {
        return {
          success: false,
          message: [
            `SonarQube not available at ${serverUrl}`,
            "",
            "To use this command:",
            "1. Install SonarQube: https://www.sonarqube.org/downloads/",
            "2. Start SonarQube: sonarqube start",
            "3. Create a project in SonarQube web UI",
            "4. Set environment variables:",
            `   SONAR_SERVER_URL=${serverUrl}`,
            `   SONAR_PROJECT_KEY=${projectKey}`,
            "   SONAR_TOKEN=<your-token>",
          ].join("\n"),
        };
      }

      logger.info(`[security-scan] Running analysis for project: ${projectKey}`);

      const result = await runSonarAnalysis({
        serverUrl,
        projectKey,
        token,
        sources: ["."],
        exclusions: ["node_modules/**", "dist/**", "**/*.test.*"],
      });

      if (!result.success) {
        return {
          success: false,
          message: `Analysis failed: ${result.error}`,
        };
      }

      // Build report
      const lines = ["SonarQube Analysis Report", ""];

      // Metrics
      lines.push("Metrics:");
      lines.push(`  Lines of Code: ${result.metrics.lines}`);
      lines.push(`  Coverage: ${result.metrics.coverage}%`);
      lines.push(`  Bugs: ${result.metrics.bugs}`);
      lines.push(`  Vulnerabilities: ${result.metrics.vulnerabilities}`);
      lines.push(`  Code Smells: ${result.metrics.codeSmells}`);
      lines.push(`  Duplications: ${result.metrics.duplications}%`);
      lines.push("");

      // Quality Gate
      const gateIcon = result.qualityGateStatus === "PASSED" ? "✓" : "✗";
      lines.push(`Quality Gate: ${gateIcon} ${result.qualityGateStatus}`);
      lines.push("");

      // Issues summary
      if (result.issues.length > 0) {
        const critical = result.issues.filter((i) => i.severity === "CRITICAL").length;
        const major = result.issues.filter((i) => i.severity === "MAJOR").length;
        const minor = result.issues.filter((i) => i.severity === "MINOR").length;

        lines.push(`Issues: ${result.issues.length} total`);
        if (critical > 0) lines.push(`  Critical: ${critical}`);
        if (major > 0) lines.push(`  Major: ${major}`);
        if (minor > 0) lines.push(`  Minor: ${minor}`);
        lines.push("");

        // Top issues
        lines.push("Top Issues:");
        for (const issue of result.issues.slice(0, 5)) {
          const line = issue.line ? `:${issue.line}` : "";
          lines.push(`  [${issue.severity}] ${issue.component}${line} - ${issue.message.substring(0, 80)}`);
        }
        if (result.issues.length > 5) {
          lines.push(`  ... and ${result.issues.length - 5} more`);
        }
      } else {
        lines.push("No issues found!");
      }

      lines.push("");
      lines.push(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

      return {
        success: true,
        message: lines.join("\n"),
        data: {
          metrics: result.metrics,
          qualityGateStatus: result.qualityGateStatus,
          issueCount: result.issues.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[security-scan] Error: ${message}`);
      return {
        success: false,
        message: `Security scan error: ${message}`,
      };
    }
  },
};
