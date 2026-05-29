import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { createSession, destroySession, runSinglePhase } from "@/pipeline/session.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-phase4-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("phase 4 security artifacts", () => {
  it("writes XML reports with deterministic local scan findings", async () => {
    const projectDir = makeProjectDir();
    fs.writeFileSync(
      path.join(projectDir, ".env"),
      "PAKALON_TEST_API_KEY='12345678901234567890'\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { "floating-version": "latest" } }, null, 2),
      "utf-8",
    );

    const session = createSession({
      projectDir,
      userPrompt: "Build a secure test app",
      userId: "test-user",
      userPlan: "free",
      isYolo: true,
    });

    try {
      await runSinglePhase(session.id, 4);

      const whiteboxPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-4", "whitebox_testing.xml");
      const phase4Path = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-4", "phase-4.md");
      const browserEvidencePath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-4", "browser-evidence", "browser-evidence.md");
      const whiteboxXml = fs.readFileSync(whiteboxPath, "utf-8");
      const phase4Md = fs.readFileSync(phase4Path, "utf-8");
      const browserEvidence = fs.readFileSync(browserEvidencePath, "utf-8");

      expect(whiteboxXml).toContain("<finding");
      expect(whiteboxXml).toContain("local-secret-scan");
      expect(whiteboxXml).toContain("local-dependency-scan");
      expect(phase4Md).toContain("Local Scan Summary");
      expect(phase4Md).toContain("Browser Evidence");
      expect(phase4Md).toContain("Hard-coded credential-like value detected");
      expect(browserEvidence).toContain("Status: skipped");
    } finally {
      destroySession(session.id);
    }
  });
});
