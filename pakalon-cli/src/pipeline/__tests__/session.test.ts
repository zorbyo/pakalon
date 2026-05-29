import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, runSinglePhase, sendInput, destroySession } from "../session.js";
import { detectPipelineState } from "@/utils/pipeline-state.js";

describe("pipeline/session", () => {
  const tempDirs: string[] = [];

  const createTempProject = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-pipeline-test-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes phase-1 artifacts to .pakalon-agents/ai-agents/phase-1", async () => {
    const projectDir = createTempProject();
    const session = createSession({
      projectDir,
      userPrompt: "Build a collaborative todo app",
      userId: "test-user",
      userPlan: "free",
      isYolo: true,
    });

    await runSinglePhase(session.id, 1);

    const phaseDir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1");
    expect(fs.existsSync(path.join(phaseDir, "plan.md"))).toBe(true);
    expect(fs.existsSync(path.join(phaseDir, "tasks.md"))).toBe(true);
    expect(fs.existsSync(path.join(phaseDir, "phase-1.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".pakalon", "context-management.md"))).toBe(true);
    expect(fs.readFileSync(path.join(phaseDir, "context_management.md"), "utf8")).toContain("Safety buffer");
    expect(fs.readFileSync(path.join(phaseDir, "context_management.md"), "utf8")).toContain("Existing Project Signals");
    expect(fs.existsSync(path.join(projectDir, ".pakalon-agents", "pipeline-state.json"))).toBe(true);
    expect(detectPipelineState(projectDir).highestCompletedPhase).toBe(1);
    expect(detectPipelineState(projectDir).nextPhase).toBe(2);

    destroySession(session.id);
  });

  it("accepts latest-input replies for interactive phase decisions", async () => {
    const projectDir = createTempProject();
    const session = createSession({
      projectDir,
      userPrompt: "Build an analytics dashboard",
      userId: "test-user",
      userPlan: "free",
      isYolo: false,
    });

    const choiceResponses = ["ok"];
    const onEvent = (event: Record<string, unknown>) => {
      if (event.type === "choice_request") {
        const next = choiceResponses.shift() ?? "ok";
        sendInput(session.id, next);
      }
    };

    await runSinglePhase(session.id, 2, onEvent);

    const phaseDir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
    expect(fs.existsSync(path.join(phaseDir, "phase-2.md"))).toBe(true);
    expect(fs.existsSync(path.join(phaseDir, "Wireframe_generated.svg"))).toBe(true);
    expect(fs.existsSync(path.join(phaseDir, "phase-2-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".pakalon", "penpot.json"))).toBe(true);
    expect(detectPipelineState(projectDir).phases.find((phase) => phase.phase === 2)?.status).toBe("complete");

    destroySession(session.id);
  });
});
