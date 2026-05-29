/**
 * /phase-1 through /phase-6 commands
 * 
 * Each command runs a single phase of the Pakalon build pipeline
 * by calling the TypeScript bridge directly.
 * 
 * Previously these were thin wrappers returning bridge-pipeline data;
 * now they perform standalone execution like /build.
 */

import type { CommandDefinition, CommandContext, CommandResult } from "./types.js";
import { debugLog } from "@/utils/logger.js";
import { useStore } from "@/store/index.js";

const BRIDGE_URL = process.env.PAKALON_BRIDGE_URL ?? "http://127.0.0.1:7432";

const PHASE_NAMES: Record<number, string> = {
  1: "Planning",
  2: "Wireframes",
  3: "Development",
  4: "Security",
  5: "Deployment",
  6: "Documentation",
};

/**
 * Check if the bridge is available
 */
async function checkBridgeHealth(): Promise<boolean> {
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
 * Ensure the bridge is running
 */
async function ensureBridgeRunning(): Promise<void> {
  const isRunning = await checkBridgeHealth();
  if (isRunning) return;

  // Attempt to start the bridge directly
  try {
    const { startBridgeServer } = await import(
      '../agents/bridge/server.js'
    );
    startBridgeServer();
    debugLog(`[phase] Bridge started successfully`);
    return;
  } catch (err) {
    debugLog(`[phase] Failed to import bridge:`, String(err));
  }

  // Fallback: spawn as detached subprocess
  const { fileURLToPath } = await import("url");
  const { spawn } = await import("node:child_process");
  const currentDir = __dirname;
  const bridgeScript = require.resolve("../agents/bridge/server.ts");

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
      debugLog(`[phase] Bridge started successfully`);
      return;
    }
  }

  throw new Error(
    "Failed to start TypeScript bridge. Run 'bun run dev' first, then try again."
  );
}

function createPhaseCommand(phase: 1 | 2 | 3 | 4 | 5 | 6): CommandDefinition {
  const phaseName = PHASE_NAMES[phase];
  const timeout = 600_000 * phase; // 10 min * phase number

  return {
    name: `phase-${phase}`,
    description: `Run Pakalon Phase ${phase} (${phaseName}) standalone`,
    usage: `/phase-${phase} [project description]`,
    category: "advanced",
    async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
      const prompt = args.join(" ").trim() ||
        "Continue the existing Pakalon project using available phase artifacts.";

      try {
        // Ensure bridge is running
        const bridgeAvailable = await checkBridgeHealth();
        if (!bridgeAvailable) {
          try {
            await ensureBridgeRunning();
          } catch {
            return {
              success: false,
              message:
                `TypeScript bridge is not running.\n\n` +
                `Make sure you have built the project first:\n` +
                `  bun run build\n\n` +
                `Then try /phase-${phase} again.`,
            };
          }
        }

        context.onDone?.(`Starting Phase ${phase}: ${phaseName}...`);

        // Call the bridge for this specific phase
        const response = await fetch(`${BRIDGE_URL}/phase/${phase}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: prompt }),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            message: `Phase ${phase} failed: HTTP ${response.status} - ${errorText}`,
          };
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
            debugLog(`[phase-${phase}]`, chunk);
          }

          try {
            const parsed = JSON.parse(result);
            if (parsed.status === "error") {
              return {
                success: false,
                message: `Phase ${phase} failed: ${parsed.error}`,
              };
            }
          } catch {
            // Non-JSON response is fine
          }
        }

        return {
          success: true,
          message: `Phase ${phase} (${phaseName}) completed successfully!`,
          data: { phase, phaseName },
        };

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog(`[phase-${phase}] Error:`, message);

        return {
          success: false,
          message: `Phase ${phase} failed: ${message}`,
        };
      }
    },
  };
}

export const phaseCommands: CommandDefinition[] = [
  createPhaseCommand(1),
  createPhaseCommand(2),
  createPhaseCommand(3),
  createPhaseCommand(4),
  createPhaseCommand(5),
  createPhaseCommand(6),
];
