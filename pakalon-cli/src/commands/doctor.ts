/**
 * pakalon doctor — check system requirements.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { loadCredentials } from "@/auth/storage.js";
import { debugLog } from "@/utils/logger.js";
import type { CommandDefinition } from "./types.js";

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  tool: string;
  ok: boolean;
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  json?: boolean;
  /**
   * When true, exits process with code 1 if any check fails.
   * Defaults to `!json` for backward compatibility.
   */
  exitOnFailure?: boolean;
}

async function checkBunVersion(): Promise<CheckResult> {
  try {
    const output = execSync("bun --version", { encoding: "utf-8" }).trim();
    const versionParts = output.replace("v", "").split(".");
    const major = parseInt(versionParts[0] ?? "0", 10);
    return {
      name: "Bun runtime",
      ok: major >= 1,
      message: `bun v${output}`,
      fix: major < 1 ? "Install Bun 1.x: https://bun.sh" : undefined,
    };
  } catch {
    return {
      name: "Bun runtime",
      ok: false,
      message: "Not found",
      fix: "Install Bun: https://bun.sh",
    };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const output = execSync("node --version", { encoding: "utf-8" }).trim();
    const major = parseInt((output.replace("v", "").split(".")[0]) ?? "0", 10);
    return {
      name: "Node.js",
      ok: major >= 20,
      message: `node ${output}`,
      fix: major < 20 ? "Install Node.js 20+: https://nodejs.org" : undefined,
    };
  } catch {
    return {
      name: "Node.js",
      ok: false,
      message: "Not found",
      fix: "Install Node.js 20+: https://nodejs.org",
    };
  }
}

async function checkDocker(): Promise<CheckResult> {
  try {
    execSync("docker info", { encoding: "utf-8", stdio: "pipe" });
    return {
      name: "Docker",
      ok: true,
      message: "Docker daemon running",
    };
  } catch {
    return {
      name: "Docker",
      ok: false,
      message: "Daemon not running or Docker not installed",
      fix: "Install Docker Desktop: https://docker.com/products/docker-desktop",
    };
  }
}

async function checkConfigDir(): Promise<CheckResult> {
  const configDir = path.join(os.homedir(), ".config", "pakalon");
  try {
    fs.mkdirSync(configDir, { recursive: true });
    const testFile = path.join(configDir, ".write-test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return { name: "Config directory", ok: true, message: configDir };
  } catch {
    return {
      name: "Config directory",
      ok: false,
      message: `Cannot write to ${configDir}`,
      fix: `Run: mkdir -p ${configDir} && chmod 755 ${configDir}`,
    };
  }
}

async function checkInternet(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://openrouter.ai/models", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      name: "Internet (OpenRouter)",
      ok: res.ok || res.status < 500,
      message: `Reachable (${res.status})`,
    };
  } catch {
    return {
      name: "Internet (OpenRouter)",
      ok: false,
      message: "Cannot reach openrouter.ai",
      fix: "Check your internet connection",
    };
  }
}

async function checkAuth(): Promise<CheckResult> {
  try {
    const creds = loadCredentials();
    const hasToken = Boolean(creds?.token);
    return {
      name: "Authentication",
      ok: hasToken,
      message: hasToken ? `Logged in (user: ${creds?.userId ?? "unknown"})` : "Not authenticated",
      fix: hasToken ? undefined : "Run: pakalon login",
    };
  } catch {
    return {
      name: "Authentication",
      ok: false,
      message: "Could not read credentials",
      fix: "Run: pakalon login",
    };
  }
}

export async function cmdDoctor(options: DoctorOptions = {}): Promise<DoctorResult[]> {
  console.log("\n* Pakalon Doctor — System Check\n");
  console.log("─".repeat(60));

  const checks = await Promise.all([
    checkBunVersion(),
    checkNodeVersion(),
    checkDocker(),
    checkConfigDir(),
    checkInternet(),
    checkAuth(),
  ]);

  const out: DoctorResult[] = [];
  let allOk = true;
  for (const check of checks) {
    const icon = check.ok ? "[OK]" : "[X]";
    const label = check.name.padEnd(25);
    console.log(`  ${icon} ${label} ${check.message}`);
    if (!check.ok && check.fix) {
      console.log(`      → Fix: ${check.fix}`);
    }
    out.push({
      tool: check.name,
      ok: check.ok,
      message: check.message,
      fix: check.fix,
    });
    if (!check.ok) allOk = false;
  }

  console.log("─".repeat(60));

  if (allOk) {
    console.log("\n[OK] All checks passed! Pakalon is ready.\n");
  } else {
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n[X] ${failed} check(s) failed. Address the issues above.\n`);
    const shouldExit = options.exitOnFailure ?? !options.json;
    if (shouldExit) {
      process.exit(1);
    }
  }

  debugLog("[doctor] System check complete");
  return out;
}

async function captureConsole(action: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  const collect = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(" "));
  };

  console.log = collect;
  console.error = collect;
  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return output.join("\n").trim();
}

export const doctorCommand: CommandDefinition = {
  name: "doctor",
  description: "Run environment diagnostics",
  usage: "/doctor",
  category: "project",
  async execute() {
    const output = await captureConsole(async () => {
      await cmdDoctor({ exitOnFailure: false });
    });

    return {
      success: true,
      message: output || "Doctor check complete.",
    };
  },
};
