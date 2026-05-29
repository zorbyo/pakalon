/**
 * Deepsec Scanner - Main entry point
 * Re-exports the scanning engine and matchers
 */

import * as path from "path";
import type { SecurityFinding, Severity } from "../core/types.js";
import { loadAllFileRecords } from "../core/utils.js";
import { scan } from "./engine.js";
import { createDefaultRegistry } from "./matchers/index.js";

export { scan, scanFiles, RegexScannerDriver, detectTech } from "./engine.js";
export { createDefaultRegistry } from "./matchers/index.js";

function projectIdForRoot(root: string): string {
  const base = path.basename(path.resolve(root)) || "project";
  return base.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function severityForSlug(slug: string): Severity {
  if (/secret|credential|rce|iam-wildcard/i.test(slug)) return "CRITICAL";
  if (/sql|xss|ssrf|path-traversal|auth|redirect|public-ingress/i.test(slug)) return "HIGH";
  if (/crypto|cors|dockerfile/i.test(slug)) return "MEDIUM";
  return "LOW";
}

/**
 * Phase 4 compatibility API.
 *
 * Runs the local DeepSec regex scanner and flattens persisted file candidates
 * into the lightweight SecurityFinding shape consumed by the Phase 4 agent.
 */
export async function scanForVulnerabilities(projectDir: string): Promise<SecurityFinding[]> {
  const root = path.resolve(projectDir);
  const projectId = projectIdForRoot(root);
  const matchers = createDefaultRegistry();

  await scan({
    projectId,
    root,
    matchers,
  });

  const records = await loadAllFileRecords(projectId, root);
  const findings: SecurityFinding[] = [];

  for (const record of records) {
    for (const candidate of record.candidates) {
      const firstMatch = candidate.matches[0];
      findings.push({
        tool: "deepsec",
        severity: severityForSlug(candidate.slug),
        file: record.filePath,
        line: firstMatch?.line,
        message: candidate.description ?? `${candidate.slug} pattern matched`,
        rule: candidate.slug,
        description: firstMatch?.text,
      });
    }
  }

  return findings;
}
