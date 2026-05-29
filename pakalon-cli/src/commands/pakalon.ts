/**
 * /pakalon command — trigger the full 6-phase agentic mode.
 * Uses native TypeScript pipeline (no Python bridge required).
 */
import path from "path";
import fs from "fs";
import { debugLog } from "@/utils/logger.js";
import type { CommandDefinition, CommandContext, CommandResult } from "./types.js";
import { cmdPakalonAgents } from "./pakalon-agents.js";
import { useStore } from "@/store/index.js";
import { detectPipelineState, formatPipelineStateSummary } from "@/utils/pipeline-state.js";
import crypto from "crypto";

const DEFAULT_SECURITY_POLICY_YAML = `# Pakalon Security Promotion Policy
promotion_criteria:
  max_critical_vulnerabilities: 0
  max_high_vulnerabilities: 2
  max_medium_vulnerabilities: 10
  min_security_score: 70
  required_sast_coverage: 80
  require_dast: true
  require_sbom: true

actions:
  on_failure: loop_back
  loop_back_phase: 3
  max_loop_iterations: 3

sandbox:
  max_runtime_minutes: 30
  max_memory_mb: 1024
  max_iterations: 5
  auto_cleanup: true
`;

export interface AgentRunOptions {
  prompt: string;
  mode?: "hil" | "yolo";
  dir?: string;
  maxBudget?: number;
  userId?: string;
  userPlan?: string;
  figmaUrl?: string;
  targetUrl?: string;
  continuousMonitoring?: boolean;
}

/**
 * Prepare the .pakalon/ config directory for the agentic run.
 * The .pakalon-agents/ scaffold is created separately by cmdPakalonAgents().
 */
export function prepareAgentDirs(dir: string): void {
  const pakalonDir = path.join(dir, ".pakalon");
  if (!fs.existsSync(pakalonDir)) {
    fs.mkdirSync(pakalonDir, { recursive: true });
    debugLog(`[pakalon] Created ${pakalonDir}`);
  }

  const settingsFile = path.join(pakalonDir, "settings.json");
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ version: 1, mode: "hil", privacyMode: false }, null, 2) + "\n",
    );
  }

  const policyFile = path.join(pakalonDir, "security-policy.yml");
  if (!fs.existsSync(policyFile)) {
    fs.writeFileSync(policyFile, DEFAULT_SECURITY_POLICY_YAML);
  }
}

/**
 * Launch the 6-phase agentic pipeline.
 * Returns config that can be used to render AgentScreen in native pipeline mode.
 */
export async function cmdPakalon(options: AgentRunOptions): Promise<{
  bridgeMode: {
    userPrompt: string;
    userId: string;
    userPlan: string;
    isYolo: boolean;
    figmaUrl?: string;
    targetUrl?: string;
    continuousMonitoring?: boolean;
  };
  projectDir: string;
}> {
  const {
    prompt,
    mode = "hil",
    dir = process.cwd(),
    userId = "anonymous",
    userPlan = "free",
    figmaUrl,
    targetUrl = "http://localhost:3000",
  } = options;

  console.log("\nStarting Pakalon Agentic Mode...\n");

  if (mode === "yolo") {
    console.log("  Mode: YOLO (all phases auto-proceed, no human input required)");
  } else {
    console.log("  Mode: HIL (Human-in-the-Loop — you'll be asked before each phase)");
  }

  console.log(`  Working directory: ${dir}`);
  console.log(`  Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"\n`);

  // Prepare .pakalon and .pakalon-agents directories (with all phase subdirs)
  prepareAgentDirs(dir);
  console.log("  Prepared .pakalon/ and .pakalon-agents/ai-agents/phase-{1..6}/ directories");

  return {
    bridgeMode: {
      userPrompt: prompt,
      userId,
      userPlan,
      isYolo: mode === "yolo",
      figmaUrl,
      targetUrl,
      continuousMonitoring: options.continuousMonitoring,
    },
    projectDir: dir,
  };
}

/**
 * Get opening message for AgentScreen when /pakalon is invoked.
 */
export function getPakalonOpeningMessage(prompt: string, mode: string): string {
  return `Starting 6-phase agentic build for:

"${prompt}"

Mode: ${mode.toUpperCase()}

Phase 1 → Planning & Research
  - Web research for similar products
  - Q&A with you (HIL mode) or auto-proceed (YOLO mode)
  - Generating: plan.md, tasks.md, user-stories.md, design.md
  - Generating: API_reference.md ← Phase-3 SA-2 reads this
  - Generating: Database_schema.md ← Phase-3 SA-2 reads this
  - Plus 7 more planning docs

Phase 2 → Wireframe Generation
  - Penpot wireframe creation (auto-opens in browser)
  - sync.js lifecycle bridge (starts on open, stops on close)
  - Design review & iteration with TDD screenshots

Phase 3 → Development (5 specialist sub-agents)
  - SA-1: Frontend (uses wireframe from phase-2)
  - SA-2: Backend API (reads API_reference.md + Database_schema.md)
  - SA-3: Frontend ↔ Backend integration
  - SA-4: Debug, testing & chrome-devtools audit
  - SA-5: Feedback, review & execution_log.md

Phase 4 → Security QA (5 specialist sub-agents)
  - SAST + DAST scanning
  - blackbox_testing.xml + whitebox_testing.xml generated
  - Requirement verification

Phase 5 → CI/CD & Deployment
Phase 6 → Documentation

Starting now...`;
}

export const pakalonCommand: CommandDefinition = {
  name: "pakalon",
  description: "Trigger the full 6-phase agentic mode and initialize the folder structure",
  usage: "/pakalon <project description>",
  category: "advanced",
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const projectDir = context.cwd ?? process.cwd();
    const info = (msg: string) => {
      if (context.info) {
        (context.info as (m: string) => void)(msg);
      }
    };

    // Step 1: Create .pakalon-agents folder structure
    try {
      const result = await cmdPakalonAgents(projectDir);
      info(
        result.filesCreated > 0
          ? `Created \`.pakalon-agents/\` scaffold with **${result.filesCreated}** files.\n\nFolder structure initialized for the 6-phase SDLC pipeline.`
          : "`.pakalon-agents/` is already initialized. Missing scaffold files were checked."
      );
    } catch (e: any) {
      debugLog(`[pakalon] Failed to create .pakalon-agents: ${e.message}`);
      const errMessage = `Failed to initialize \`.pakalon-agents/\`: ${e.message}`;
      info(errMessage);
      return { success: false, message: errMessage };
    }

    const pakPrompt = args.join(" ").trim();
    if (!pakPrompt) {
      info("Run `/pakalon <project description>` when you want to launch the Phase 1-6 pipeline.");
      return { success: true };
    }

    // Step 2: Ask the user which mode to continue with
    // Default is HIL (Human-in-Loop). Show a choice panel.
    const currentPermissionMode = useStore.getState().permissionMode;
    const isCurrentlyYolo = currentPermissionMode === "auto-accept";

    // If the user is already in YOLO mode, skip the prompt and proceed directly
    if (isCurrentlyYolo) {
      const launchCfg = {
        userPrompt: pakPrompt,
        userId: (context.token as string) ?? (context.user?.id as string) ?? "anonymous",
        userPlan: (context.plan as string) ?? (context.userPlan as string) ?? "free",
        isYolo: true,
        privacyLevel: useStore.getState().privacyLevel,
      };

      // Existing run protection in YOLO mode
      try {
        const pipelineState = detectPipelineState(projectDir);
        if (pipelineState.hasAgentsOutput) {
          const summary = formatPipelineStateSummary(pipelineState);
          const resumePhase = pipelineState.nextPhase;
          if (resumePhase === null) {
            const msg = `\`.pakalon-agents/\` already has a completed Phase 1-6 run.\n\n${summary}\n\nUse \`/phase-1\` ... \`/phase-6\` to rerun a specific phase, or switch out of YOLO mode with \`/HIL\` to confirm a full rerun.`;
            info(msg);
            return { success: true, message: msg };
          }
          const msg = `Existing pipeline artifacts detected. YOLO mode will continue from **Phase ${resumePhase}**.\n\n${summary}`;
          info(msg);
          useStore.getState().launchBridgePipeline({
            ...launchCfg,
            startPhase: resumePhase,
            endPhase: 6,
          });
          return { success: true, message: msg };
        }
      } catch {
        /* filesystem state detection is best-effort */
      }

      const msg = `[Rocket] Launching 6-phase Pakalon pipeline in **YOLO mode** for:\n\n_${pakPrompt}_\n\nAll phases will execute autonomously. Switch to HIL with \`/HIL\` at any time.`;
      info(msg);
      useStore.getState().launchBridgePipeline(launchCfg);
      return { success: true, message: msg };
    }

    // Show mode selection prompt (default: HIL)
    if (context.setPendingChoice) {
      const setPendingChoice = context.setPendingChoice as (choice: any) => void;
      setPendingChoice({
        messageId: crypto.randomUUID(),
        kind: "pakalon-mode",
        payload: { prompt: pakPrompt },
        question: `The .pakalon-agents/ folder is ready. Which mode would you like to continue with for the 6-phase SDLC pipeline?`,
        choices: [
          {
            id: "hil",
            label: "Human-in-Loop (HIL)",
            description: "AI asks for your permission before each action. Default and recommended mode.",
          },
          {
            id: "yolo",
            label: "YOLO Mode",
            description: "AI executes all actions autonomously without asking for permission. Fast but less control.",
          },
        ],
      });
      return { success: true };
    } else {
      // Headless execution: we cannot show choice, so return success indicating scaffold is created.
      return {
        success: true,
        message: "Scaffold created. For headless execution, configure YOLO/HIL mode or launch the pipeline steps directly.",
      };
    }
  }
};
