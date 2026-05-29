#!/usr/bin/env node
/**
 * postinstall.js — Pure TypeScript/Node.js runtime — no Python needed.
 *
 * Runs automatically after `npm install` / `bun install`.
 * This script now only performs runtime verification checks.
 * The Python bridge, LangChain, and LangGraph dependencies have been removed.
 *
 * Silently skips if:
 *  - PAKALON_SKIP_VERIFY=1 env var is set
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

// ── Skip checks ────────────────────────────────────────────────────────────
if (process.env.PAKALON_SKIP_VERIFY === "1") {
  process.exit(0);
}

// ── Verify Node.js version ─────────────────────────────────────────────────
const nodeVersion = process.versions.node;
const [major] = nodeVersion.split(".").map(Number);
if (major < 20) {
  console.warn(
    `[pakalon] Node.js ${nodeVersion} detected. Pakalon requires Node.js >= 20.0.0.`
  );
  process.exit(0);
}

console.log(`[pakalon] Node.js ${nodeVersion} detected. Runtime environment verified.`);
console.log("[pakalon] Pure TypeScript/Node.js runtime — no Python bridge required.");
