import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentsFolderStructure } from "../agents-folder-structure.js";

describe("createAgentsFolderStructure", () => {
  const tempDirs: string[] = [];

  const makeTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-agents-structure-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the requested .pakalon-agents scaffold", () => {
    const projectDir = makeTempDir();

    createAgentsFolderStructure({
      projectDir,
      projectName: "demo-project",
    });

    const expected = [
      ".pakalon-agents/ai-agents/sync.js",
      ".pakalon-agents/ai-agents/phase-1/context_management.md",
      ".pakalon-agents/ai-agents/phase-1/plan.md",
      ".pakalon-agents/ai-agents/phase-1/tasks.md",
      ".pakalon-agents/ai-agents/phase-1/design.md",
      ".pakalon-agents/ai-agents/phase-1/phase-1.md",
      ".pakalon-agents/ai-agents/phase-1/agent-skills.md",
      ".pakalon-agents/ai-agents/phase-1/prd.md",
      ".pakalon-agents/ai-agents/phase-1/Database_schema.md",
      ".pakalon-agents/ai-agents/phase-1/API_reference.md",
      ".pakalon-agents/ai-agents/phase-1/risk-assessment.md",
      ".pakalon-agents/ai-agents/phase-1/user-stories.md",
      ".pakalon-agents/ai-agents/phase-1/technical-spec.md",
      ".pakalon-agents/ai-agents/phase-1/competitive-analysis.md",
      ".pakalon-agents/ai-agents/phase-1/constraints-and-tradeoffs.md",
      ".pakalon-agents/ai-agents/phase-2/Wireframe_generated.svg",
      ".pakalon-agents/ai-agents/phase-2/Wireframe_generated.penpot",
      ".pakalon-agents/ai-agents/phase-2/tdd-screenshots",
      ".pakalon-agents/ai-agents/phase-3/auditor.md",
      ".pakalon-agents/ai-agents/phase-3/subagent-1.md",
      ".pakalon-agents/ai-agents/phase-3/subagent-2.md",
      ".pakalon-agents/ai-agents/phase-3/subagent-3.md",
      ".pakalon-agents/ai-agents/phase-3/subagent-4.md",
      ".pakalon-agents/ai-agents/phase-3/subagent-5.md",
      ".pakalon-agents/ai-agents/phase-3/execution_log.md",
      ".pakalon-agents/ai-agents/phase-3/test-evidence",
      ".pakalon-agents/ai-agents/phase-4/blackbox_testing.xml",
      ".pakalon-agents/ai-agents/phase-4/whitebox_testing.xml",
      ".pakalon-agents/ai-agents/phase-5/phase-5.md",
      ".pakalon-agents/ai-agents/phase-6/phase-6.md",
      ".pakalon-agents/mcp-servers",
      ".pakalon-agents/wireframes",
      ".pakalon-agents/pakalon.db",
    ];

    for (const relativePath of expected) {
      expect(fs.existsSync(path.join(projectDir, relativePath))).toBe(true);
    }

    const syncJs = fs.readFileSync(path.join(projectDir, ".pakalon-agents/ai-agents/sync.js"), "utf8");
    expect(syncJs).toContain("dependency-free");
    expect(syncJs).not.toContain("python");

    const userStories = fs.readFileSync(path.join(projectDir, ".pakalon-agents/ai-agents/phase-1/user-stories.md"), "utf8");
    expect(userStories).toContain("US-001");
    expect(userStories).toContain("US-002");
  });
});
