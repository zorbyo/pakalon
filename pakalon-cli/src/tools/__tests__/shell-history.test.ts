import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  expandShellAlias,
  recordShellHistory,
  suggestShellHistory,
} from "@/tools/shell-history.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-shell-history-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.PAKALON_CONFIG_DIR;
  delete process.env.PAKALON_SHELL_ALIASES;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shell history helpers", () => {
  it("expands project shell aliases before execution", () => {
    const projectDir = makeTempDir();
    const pakalonDir = path.join(projectDir, ".pakalon");
    fs.mkdirSync(pakalonDir, { recursive: true });
    fs.writeFileSync(
      path.join(pakalonDir, "shell-aliases.json"),
      JSON.stringify({ gst: "git status --short", runx: "bun run $@" }),
      "utf-8",
    );

    expect(expandShellAlias("gst", projectDir)).toMatchObject({
      expanded: true,
      alias: "gst",
      command: "git status --short",
    });
    expect(expandShellAlias("runx test src/foo.test.ts", projectDir).command)
      .toBe("bun run test src/foo.test.ts");
  });

  it("records de-duplicated shell history suggestions", () => {
    const configDir = makeTempDir();
    process.env.PAKALON_CONFIG_DIR = configDir;

    recordShellHistory({ shell: "bash", command: "pakalon-history-unique --short", cwd: "D:/repo", exitCode: 0 });
    recordShellHistory({ shell: "bash", command: "pakalon-history-unique --short", cwd: "D:/repo", exitCode: 0 });
    recordShellHistory({ shell: "powershell", command: "Get-ChildItem -Force", cwd: "D:/repo", exitCode: 0 });

    const suggestions = suggestShellHistory("pakalon-history-unique", 10);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.command).toBe("pakalon-history-unique --short");
  });
});
