/**
 * /build command — Start the build pipeline by invoking Phase 1 of the TypeScript bridge.
 *
 * This command:
 * 1. Accepts a project description from the user
 * 2. Invokes the TypeScript bridge at port 7432 to run Phase 1 (Planning)
 * 3. Streams progress back to the CLI
 * 4. Creates the .pakalon/ directory with all planning documents
 *
 * NOTE: The TypeScript bridge is now the default - no Python dependency required.
 */
import path from "path";
import { fileURLToPath } from "url";
import { debugLog } from "@/utils/logger.js";
import { useStore } from "@/store/index.js";

const BRIDGE_URL = process.env.PAKALON_BRIDGE_URL ?? "http://127.0.0.1:7432";

export interface BuildOptions {
  phase?: number;
  description: string;
  interactive?: boolean;
}

export interface PhaseResult {
  status: "success" | "error" | "in_progress";
  phase: number;
  output?: Record<string, string>;
  artifacts?: string[];
  error?: string;
}

/**
 * Check if the Python bridge is available
 */
export async function checkBridgeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start the TypeScript bridge if not running
 */
export async function ensureBridgeRunning(): Promise<void> {
  const isRunning = await checkBridgeHealth();
  if (isRunning) return;

  debugLog("[build] TypeScript bridge not running, attempting to start...");

  // Attempt to import and start the bridge directly (Bun/native ESM)
  try {
    const { startBridgeServer } = await import(
      '../agents/bridge/server.js'
    );
    startBridgeServer();
    debugLog("[build] TypeScript bridge started successfully");
    return;
  } catch (err) {
    debugLog("[build] Failed to import TS bridge:", String(err));
  }

  // Fallback: spawn as detached subprocess using bun
  const { spawn } = await import("node:child_process");

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const bridgeScript = path.join(currentDir, "..", "agents", "bridge", "server.ts");

  const proc = spawn(
    "bun",
    ["run", bridgeScript],
    {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
    }
  );
  proc.unref();

  // Wait for bridge to start (max 30 seconds)
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (await checkBridgeHealth()) {
      debugLog("[build] TypeScript bridge started successfully");
      return;
    }
  }

  throw new Error(
    "Failed to start TypeScript bridge. Run 'bun run dev' first, then try /build again."
  );
}

/**
 * Run Phase 1 (Planning) of the build pipeline
 */
export async function runPhase1(
  description: string,
  onProgress?: (line: string) => void
): Promise<PhaseResult> {
  const { token } = useStore.getState();

  const response = await fetch(`${BRIDGE_URL}/phase/1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(600_000), // 10 minute timeout for planning
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Phase 1 failed: HTTP ${response.status} - ${errorText}`
    );
  }

  // Handle streaming response
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      result += chunk;
      onProgress?.(chunk);
    }

    try {
      return JSON.parse(result) as PhaseResult;
    } catch {
      // If not JSON, wrap the text result
      return {
        status: "success",
        phase: 1,
        output: { raw: result },
        artifacts: [],
      };
    }
  }

  // Non-streaming fallback
  const data = await response.json();
  return data as PhaseResult;
}

/**
 * Run a specific phase or the full pipeline
 */
export async function runPhase(
  phase: number,
  description: string,
  onProgress?: (line: string) => void
): Promise<PhaseResult> {
  const { token } = useStore.getState();

  const response = await fetch(`${BRIDGE_URL}/phase/${phase}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(600_000 * phase), // Longer timeout for later phases
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Phase ${phase} failed: HTTP ${response.status} - ${errorText}`
    );
  }

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      result += chunk;
      onProgress?.(chunk);
    }

    try {
      return JSON.parse(result) as PhaseResult;
    } catch {
      return {
        status: "success",
        phase,
        output: { raw: result },
        artifacts: [],
      };
    }
  }

  const data = await response.json();
  return data as PhaseResult;
}

/**
 * Run the full 6-phase pipeline
 */
export async function runFullPipeline(
  description: string,
  onProgress?: (phase: number, line: string) => void
): Promise<PhaseResult[]> {
  const { token } = useStore.getState();

  const response = await fetch(`${BRIDGE_URL}/orchestrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(3600_000), // 1 hour timeout for full pipeline
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pipeline failed: HTTP ${response.status} - ${errorText}`);
  }

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const results: PhaseResult[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Each line is a JSON object for a phase result
      const lines = chunk.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const result = JSON.parse(line) as PhaseResult;
          results.push(result);
          onProgress?.(result.phase, JSON.stringify(result));
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    return results;
  }

  const data = await response.json();
  return data as PhaseResult[];
}

// ============================================================================
// Slash Command Definition
// ============================================================================

import type { CommandContext, CommandResult } from "./types.js";

export const buildCommand = {
  name: "build",
  aliases: ["b"],
  description: "Start the build pipeline (Phase 1: Planning)",
  usage: "/build <description>",
  category: "workflow" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const description = args.join(" ").trim();

    if (!description) {
      return {
        success: false,
        message:
          "Usage: /build <description>\n\n" +
          "Example: /build a SaaS dashboard with Next.js and PostgreSQL\n\n" +
          "This starts Phase 1 (Planning) which will:\n" +
          "  1. Ask clarifying questions about your tech stack preferences\n" +
          "  2. Research best practices for your chosen stack\n" +
          "  3. Generate 12 planning documents in .pakalon/\n\n" +
          "Use /pakalon <description> to run all 6 phases automatically.",
      };
    }

    try {
      // Check if bridge is available
      const bridgeAvailable = await checkBridgeHealth();

      if (!bridgeAvailable) {
        // Try to start the bridge
        try {
          await ensureBridgeRunning();
        } catch (installError) {
          return {
            success: false,
            message:
              "TypeScript bridge is not running.\n\n" +
              "Make sure you have built the project first:\n" +
              "  bun run build\n\n" +
              "Then try /build again.",
          };
        }
      }

      // Show progress indicator
      context.onDone?.("Starting Phase 1: Planning...");

      // Run Phase 1
      const result = await runPhase1(description, (chunk) => {
        debugLog("[build]", chunk);
      });

      if (result.status === "error") {
        return {
          success: false,
          message: `Phase 1 failed: ${result.error}`,
        };
      }

      // Format success message
      const artifactList = result.artifacts?.length
        ? `\n\nGenerated ${result.artifacts.length} planning documents:\n` +
          result.artifacts!.map((a) => `  • ${a}`).join("\n")
        : "";

      return {
        success: true,
        message:
          "Phase 1 (Planning) completed successfully!\n\n" +
          `Description: ${description}\n` +
          artifactList +
          "\n\nNext steps:\n" +
          "  • /phase-2 - Generate wireframes (requires Penpot)\n" +
          "  • /phase-3 - Start development\n" +
          "  • /pakalon - Run full 6-phase pipeline",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog("[build] Error:", message);

      return {
        success: false,
        message: `Build failed: ${message}`,
      };
    }
  },
};

export default buildCommand;