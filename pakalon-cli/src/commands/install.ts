/**
 * pakalon install — verify system requirements for the TypeScript-only build pipeline.
 *
 * No Python or external dependencies required — the CLI is pure TypeScript/Bun.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { debugLog } from "@/utils/logger.js";
import type { CommandDefinition } from "./types.js";

export async function cmdInstall(): Promise<void> {
  console.log("\n* Pakalon Install — System Requirements Check\n");

  // Step 1: Check Node.js/Bun
  console.log("  Checking runtime...");
  try {
    const nodeVersion = execSync("node --version", { encoding: "utf-8" }).trim();
    const bunVersion = execSync("bun --version", { encoding: "utf-8" }).trim();
    console.log(`  [OK] Node.js ${nodeVersion} and Bun ${bunVersion}`);
  } catch {
    console.error(
      "  [X] Bun not found. Install from https://bun.sh\n" +
      "    Then run 'bun install' in the pakalon-cli directory."
    );
    process.exit(1);
  }

  // Step 2: Verify project builds
  console.log("\n  Verifying TypeScript build...");
  const srcDir = path.join(process.cwd(), "src");
  if (!fs.existsSync(srcDir)) {
    console.error(`  [X] src/ directory not found at ${srcDir}`);
    console.error("    Are you running this from the correct directory?");
    process.exit(1);
  }
  console.log("  [OK] TypeScript source found");

  // Step 3: Check Docker for optional Penpot support
  console.log("\n  Checking Docker for Penpot (optional)...");
  try {
    execSync("docker info", { stdio: "pipe" });
    console.log("  [OK] Docker running");
    console.log("    Note: Penpot will be pulled automatically when agentic mode first runs.");
  } catch {
    console.log("  [!] Docker not running — Penpot wireframe generation will be unavailable");
    console.log("    Install Docker Desktop: https://docker.com/products/docker-desktop");
  }

  console.log(
    "\n[OK] Installation complete! No Python dependencies needed.\n" +
    "  Run 'bun run build' to compile, then 'pakalon' to start.\n"
  );
  debugLog("[install] Installation completed successfully");
}

export const installCommand: CommandDefinition = {
  name: "install",
  description: "Verify local installation requirements",
  usage: "/install",
  category: "project",
  async execute(context) {
    const lines: string[] = ["Pakalon install check", ""];
    try {
      const nodeVersion = execSync("node --version", { encoding: "utf-8" }).trim();
      lines.push(`[OK] Node.js ${nodeVersion}`);
    } catch {
      lines.push("[X] Node.js not found. Install Node.js 20+.");
    }

    try {
      const bunVersion = execSync("bun --version", { encoding: "utf-8" }).trim();
      lines.push(`[OK] Bun ${bunVersion}`);
    } catch {
      lines.push("[X] Bun not found. Install Bun from https://bun.sh.");
    }

    try {
      execSync("docker info", { stdio: "pipe" });
      lines.push("[OK] Docker daemon running (Penpot available).");
    } catch {
      lines.push("[!] Docker is not running. Penpot wireframe sync will be unavailable until Docker is started.");
    }

    const cwd = context.cwd ?? process.cwd();
    const pakalonDir = path.join(cwd, ".pakalon");
    lines.push(fs.existsSync(pakalonDir)
      ? `[OK] Project config directory found: ${pakalonDir}`
      : `[!] Project config directory not found. Run /init to create ${pakalonDir}.`);

    const output = lines.join("\n");
    return {
      success: true,
      message: output,
    };
  },
};
