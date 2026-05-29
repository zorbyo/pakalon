import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import SandboxedExecutor, {
  createSandboxSession,
  destroySandboxSession,
  executeInSandbox,
} from "./sandbox-execution.js";

const createdPaths: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pakalon-sandbox-test-"));
  createdPaths.push(workspace);
  await fs.writeFile(path.join(workspace, "input.txt"), "hello", "utf8");
  return workspace;
}

afterEach(async () => {
  while (createdPaths.length > 0) {
    const dir = createdPaths.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("sandbox-execution", () => {
  it("exposes sane defaults", () => {
    const config = SandboxedExecutor.getDefaultConfig();

    expect(config.timeout).toBe(30000);
    expect(config.memoryLimit).toBeGreaterThan(0);
    expect(config.security.maxFileSize).toBeGreaterThan(0);
  });

  it("creates and destroys sandbox sessions", async () => {
    const workspaceDir = await makeTempWorkspace();
    const session = await createSandboxSession(workspaceDir, {
      security: {
        allowedCommands: [process.execPath],
        disallowedPatterns: ["blocked-pattern"],
        maxFileSize: 1024 * 1024,
      },
    });

    expect(session.sandboxId).toBeTruthy();
    expect(session.tempDir).toContain(session.sandboxId);

    const destroyed = await destroySandboxSession(session.sandboxId);
    expect(destroyed).toBe(true);
  });

  it("executes a command in the sandbox", async () => {
    const workspaceDir = await makeTempWorkspace();
    const session = await createSandboxSession(workspaceDir);

    try {
      const result = await executeInSandbox(
        session.sandboxId,
        process.execPath,
        ["-e", "process.stdout.write('sandbox-ok')"],
        { timeout: 5000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("sandbox-ok");
      expect(result.stderr).toBe("");
      expect(result.sandboxId).toBe(session.sandboxId);
    } finally {
      await destroySandboxSession(session.sandboxId);
    }
  });

  it("blocks disallowed commands", async () => {
    const workspaceDir = await makeTempWorkspace();
    const session = await createSandboxSession(workspaceDir, {
      security: {
        allowedCommands: [process.execPath],
        disallowedPatterns: ["blocked-pattern"],
        maxFileSize: 1024 * 1024,
      },
    });

    try {
      const executor = new SandboxedExecutor();

      const result = await executor.executeInSandbox(session.sandboxId, process.execPath, ["-e", "console.log('x')"]);
      expect(result.exitCode).toBe(0);

      const blocked = await executor.executeInSandbox(session.sandboxId, "blocked-pattern", []);
      expect(blocked.exitCode).toBe(126);
      expect(blocked.error).toBeTruthy();
    } finally {
      await destroySandboxSession(session.sandboxId);
    }
  });
});
