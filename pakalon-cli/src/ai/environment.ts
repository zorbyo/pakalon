/**
 * Environment Abstraction — Decouples tool execution from direct fs/child_process calls.
 *
 * Provides FileSystem, Shell, and ExecutionEnv interfaces with:
 * - LiveFileSystem/LiveShell — wrap Node.js built-in modules (production)
 * - TestFileSystem/TestShell — in-memory implementations (testing)
 *
 * This enables:
 * - Unit testing tool logic without touching the filesystem
 * - Swapping implementations for different environments (local, remote, CI)
 * - Cleaner dependency injection in tool implementations
 *
 * Usage:
 *   import { createLiveEnv } from "@/ai/environment.js";
 *   const env = createLiveEnv();
 *   const files = await env.fs.readdir(".");
 *   const result = await env.shell.exec("node --version");
 */

import * as fs from "fs";
import * as path from "path";
import { execFile, spawn as spawnChild, type ChildProcess } from "child_process";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileSystem {
  /** Read file contents as UTF-8 string */
  readFile(filePath: string): Promise<string>;
  /** Write string content to a file (creates parent dirs if needed) */
  writeFile(filePath: string, content: string): Promise<void>;
  /** Delete a file */
  deleteFile(filePath: string): Promise<void>;
  /** List directory entries */
  readdir(dirPath: string): Promise<string[]>;
  /** Create directory (optionally recursive) */
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  /** Check if a path exists */
  exists(filePath: string): Promise<boolean>;
  /** Get file/directory stats */
  stat(filePath: string): Promise<{
    size: number;
    mtime: Date;
    isDirectory: boolean;
    isFile: boolean;
  }>;
  /** Rename/move a file or directory */
  rename(oldPath: string, newPath: string): Promise<void>;
  /** Copy a file from source to destination */
  copyFile(src: string, dest: string): Promise<void>;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnProcess {
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
  writeToStdin(data: string): void;
}

export interface Shell {
  /** Execute a command and wait for completion (captures all output) */
  exec(
    command: string,
    args?: string[],
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): Promise<ShellResult>;

  /** Spawn a process for interactive streaming */
  spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
    },
  ): SpawnProcess;

  /** Find the path to an executable */
  which(command: string): Promise<string | null>;
}

export interface ExecutionEnv {
  /** File system operations */
  fs: FileSystem;
  /** Shell/process operations */
  shell: Shell;
  /** Current working directory */
  cwd: string;
  /** Platform identifier */
  platform: NodeJS.Platform;
  /** Environment variables snapshot */
  env: Record<string, string | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Implementations (Production)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production FileSystem implementation wrapping `fs/promises`.
 */
export class LiveFileSystem implements FileSystem {
  async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, "utf-8");
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.promises.unlink(filePath);
  }

  async readdir(dirPath: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => e.name);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: options?.recursive ?? false });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(
    filePath: string,
  ): Promise<{ size: number; mtime: Date; isDirectory: boolean; isFile: boolean }> {
    const s = await fs.promises.stat(filePath);
    return {
      size: s.size,
      mtime: s.mtime,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
    };
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.promises.rename(oldPath, newPath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
  }
}

/**
 * Production Shell implementation wrapping `child_process`.
 */
export class LiveShell implements Shell {
  async exec(
    command: string,
    args: string[] = [],
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): Promise<ShellResult> {
    return new Promise((resolve) => {
      const child = execFile(
        command,
        args,
        {
          timeout: options?.timeout ?? 30000,
          cwd: options?.cwd,
          env: options?.env
            ? { ...process.env, ...options.env }
            : undefined,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error?.code ?? 0,
          });
        },
      );

      child.on("error", (err) => {
        resolve({
          stdout: "",
          stderr: err.message,
          exitCode: -1,
        });
      });
    });
  }

  spawn(
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
    },
  ): SpawnProcess {
    const child = spawnChild(command, args, {
      cwd: options?.cwd,
      env: options?.env
        ? { ...process.env, ...options.env }
        : undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const stderrHandlers: Array<(chunk: string) => void> = [];
    const exitHandlers: Array<(code: number) => void> = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      for (const handler of stdoutHandlers) {
        try {
          handler(text);
        } catch {
          // Swallow handler errors
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      for (const handler of stderrHandlers) {
        try {
          handler(text);
        } catch {
          // Swallow handler errors
        }
      }
    });

    child.on("exit", (code) => {
      const exitCode = code ?? -1;
      for (const handler of exitHandlers) {
        try {
          handler(exitCode);
        } catch {
          // Swallow handler errors
        }
      }
    });

    child.on("error", () => {
      for (const handler of exitHandlers) {
        try {
          handler(-1);
        } catch {
          // Swallow handler errors
        }
      }
    });

    return {
      onStdout(cb: (chunk: string) => void): void {
        stdoutHandlers.push(cb);
      },
      onStderr(cb: (chunk: string) => void): void {
        stderrHandlers.push(cb);
      },
      onExit(cb: (code: number) => void): void {
        exitHandlers.push(cb);
      },
      kill(): void {
        if (!child.killed) {
          child.kill();
        }
      },
      writeToStdin(data: string): void {
        child.stdin?.write(data);
      },
    };
  }

  async which(command: string): Promise<string | null> {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "where" : "which";
    const result = await this.exec(cmd, [command]);
    if (result.exitCode === 0) {
      const firstLine = result.stdout.split("\n")[0]?.trim();
      return firstLine ?? null;
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Implementations (In-Memory)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory FileSystem for testing.
 * Files stored in a Map<string, string>.
 */
export class TestFileSystem implements FileSystem {
  private files: Map<string, string>;
  private directories: Set<string>;

  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map();
    this.directories = new Set(["/"]);

    if (initialFiles) {
      for (const [filePath, content] of Object.entries(initialFiles)) {
        this.files.set(this.normalize(filePath), content);
        this.ensureParentDirs(filePath);
      }
    }
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/");
  }

  private ensureParentDirs(filePath: string): void {
    const dirs = path.dirname(filePath).split(/[\\/]/).filter(Boolean);
    let accumulated = "";
    for (const dir of dirs) {
      accumulated += "/" + dir;
      this.directories.add(accumulated);
    }
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(this.normalize(filePath));
    if (content === undefined) {
      throw new Error(`ENOENT: no such file '${filePath}'`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalized = this.normalize(filePath);
    this.files.set(normalized, content);
    this.ensureParentDirs(normalized);
  }

  async deleteFile(filePath: string): Promise<void> {
    const normalized = this.normalize(filePath);
    if (!this.files.has(normalized)) {
      throw new Error(`ENOENT: no such file '${filePath}'`);
    }
    this.files.delete(normalized);
  }

  async readdir(dirPath: string): Promise<string[]> {
    const normalized = this.normalize(dirPath).replace(/\/$/, "") || "/";
    const entries = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(normalized + "/")) {
        const relative = filePath.slice(normalized.length + 1);
        const top = relative.split("/")[0];
        if (top) entries.add(top);
      }
    }

    for (const dir of this.directories) {
      if (dir.startsWith(normalized + "/")) {
        const relative = dir.slice(normalized.length + 1);
        const top = relative.split("/")[0];
        if (top) entries.add(top + "/");
      }
    }

    return [...entries].sort();
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalize(dirPath);
    if (options?.recursive) {
      const parts = normalized.split("/").filter(Boolean);
      let accumulated = "";
      for (const part of parts) {
        accumulated += "/" + part;
        this.directories.add(accumulated);
      }
    } else {
      if (this.directories.has(normalized)) {
        throw new Error(`EEXIST: directory already exists '${dirPath}'`);
      }
      this.directories.add(normalized);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const normalized = this.normalize(filePath);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  async stat(
    filePath: string,
  ): Promise<{ size: number; mtime: Date; isDirectory: boolean; isFile: boolean }> {
    const normalized = this.normalize(filePath);
    const content = this.files.get(normalized);
    const isDir = this.directories.has(normalized);

    if (content !== undefined) {
      return {
        size: Buffer.byteLength(content, "utf-8"),
        mtime: new Date(),
        isDirectory: false,
        isFile: true,
      };
    }

    if (isDir) {
      return {
        size: 0,
        mtime: new Date(),
        isDirectory: true,
        isFile: false,
      };
    }

    throw new Error(`ENOENT: no such file or directory '${filePath}'`);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = this.normalize(oldPath);
    const normalizedNew = this.normalize(newPath);

    const content = this.files.get(normalizedOld);
    if (content !== undefined) {
      this.files.set(normalizedNew, content);
      this.files.delete(normalizedOld);
    } else if (this.directories.has(normalizedOld)) {
      this.directories.delete(normalizedOld);
      this.directories.add(normalizedNew);
    } else {
      throw new Error(`ENOENT: no such file or directory '${oldPath}'`);
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const normalizedSrc = this.normalize(src);
    const content = this.files.get(normalizedSrc);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file '${src}'`);
    }
    await this.writeFile(dest, content);
  }
}

/**
 * In-memory Shell for testing.
 * Pre-configured with canned responses for specific commands.
 */
export class TestShell implements Shell {
  private responses: Map<string, ShellResult>;
  private defaultResponse: ShellResult;
  private executedCommands: string[] = [];

  constructor(responses?: Record<string, Partial<ShellResult>>) {
    this.responses = new Map();
    this.defaultResponse = { stdout: "", stderr: "", exitCode: 0 };

    if (responses) {
      for (const [cmd, result] of Object.entries(responses)) {
        this.responses.set(cmd.toLowerCase(), {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? 0,
        });
      }
    }
  }

  /** Get the list of commands that were executed (for assertions) */
  getExecutedCommands(): string[] {
    return [...this.executedCommands];
  }

  /** Check if a specific command was executed */
  wasExecuted(command: string): boolean {
    return this.executedCommands.some((c) =>
      c.toLowerCase().startsWith(command.toLowerCase()),
    );
  }

  /** Add a canned response */
  addResponse(command: string, result: Partial<ShellResult>): void {
    this.responses.set(command.toLowerCase(), {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    });
  }

  /** Clear execution history */
  clearHistory(): void {
    this.executedCommands = [];
  }

  async exec(
    command: string,
    args: string[] = [],
    _options?: { timeout?: number; cwd?: string; env?: Record<string, string> },
  ): Promise<ShellResult> {
    const fullCommand = `${command} ${args.join(" ")}`.trim();
    this.executedCommands.push(fullCommand);

    const canned = this.responses.get(fullCommand.toLowerCase());
    if (canned) return canned;

    // Try matching by command only
    const byCommand = this.responses.get(command.toLowerCase());
    if (byCommand) return byCommand;

    return this.defaultResponse;
  }

  spawn(
    _command: string,
    _args?: string[],
    _options?: { cwd?: string; env?: Record<string, string> },
  ): SpawnProcess {
    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const stderrHandlers: Array<(chunk: string) => void> = [];
    const exitHandlers: Array<(code: number) => void> = [];

    // Simulate successful spawn with empty output
    process.nextTick(() => {
      for (const handler of exitHandlers) {
        handler(0);
      }
    });

    return {
      onStdout(cb: (chunk: string) => void): void {
        stdoutHandlers.push(cb);
      },
      onStderr(cb: (chunk: string) => void): void {
        stderrHandlers.push(cb);
      },
      onExit(cb: (code: number) => void): void {
        exitHandlers.push(cb);
      },
      kill(): void {
        // No-op for test
      },
      writeToStdin(_data: string): void {
        // No-op for test
      },
    };
  }

  async which(command: string): Promise<string | null> {
    const fullCommand = `which ${command}`;
    this.executedCommands.push(fullCommand);

    const canned = this.responses.get(fullCommand.toLowerCase());
    if (canned) {
      return canned.exitCode === 0 ? `/usr/bin/${command}` : null;
    }

    return `/usr/bin/${command}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a production ExecutionEnv using real filesystem and shell.
 */
export function createLiveEnv(cwd?: string): ExecutionEnv {
  return {
    fs: new LiveFileSystem(),
    shell: new LiveShell(),
    cwd: cwd ?? process.cwd(),
    platform: process.platform,
    env: { ...process.env },
  };
}

/**
 * Create a test ExecutionEnv using in-memory filesystem and shell.
 *
 * @param files - Optional initial files for the in-memory filesystem
 * @param shellResponses - Optional canned shell responses
 */
export function createTestEnv(
  files?: Record<string, string>,
  shellResponses?: Record<string, Partial<ShellResult>>,
): ExecutionEnv {
  return {
    fs: new TestFileSystem(files),
    shell: new TestShell(shellResponses),
    cwd: "/test",
    platform: "linux" as NodeJS.Platform,
    env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" },
  };
}
