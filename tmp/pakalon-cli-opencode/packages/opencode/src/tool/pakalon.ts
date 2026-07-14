import { Tool } from "./tool"
import z from "zod"
import { Pakalon } from "../pakalon"
import { PhaseOrchestrator } from "../pakalon/phase-orchestrator"
import { QASystem } from "../pakalon/qa-system"
import { NormalMode } from "../pakalon/normal-mode"
import { Phase3Subagents, PHASE3_SUBAGENTS } from "../pakalon/phase3-subagents"
import { Phase4Security, SECURITY_SUBAGENTS } from "../pakalon/phase4-security"
import { ModeSwitcher } from "../pakalon/mode-switcher"
import { TelemetryManager } from "../pakalon/telemetry-manager"
import { MCPProjectConfig } from "../pakalon/mcp-project"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "tool:pakalon" })

const PARAMETERS = z.object({
  action: z.enum([
    "init-pipeline",
    "init-qa",
    "get-current-question",
    "answer-question",
    "generate-phase1",
    "advance-phase",
    "get-phase-status",
    "init-normal-mode",
    "generate-normal-artifacts",
    "run-subagent",
    "run-all-subagents",
    "generate-security-report",
    "generate-blackbox-tests",
    "generate-whitebox-tests",
    "get-mode",
    "cycle-mode",
    "toggle-thinking",
    "get-telemetry-id",
    "track-event",
    "list-mcp-servers",
    "add-mcp-server",
    "remove-mcp-server",
  ]).describe("The Pakalon action to perform"),

  // Common parameters
  mode: z.enum(["hil", "yolo"]).describe("Pipeline mode: Human-in-Loop or YOLO").optional(),
  projectPath: z.string().describe("Project directory path").optional(),
  prompt: z.string().describe("User's initial prompt/requirements").optional(),
  questionAnswer: z.string().describe("Answer to current Q&A question").optional(),
  phase: z.number().min(1).max(6).describe("Phase number").optional(),
  subagentNumber: z.number().min(1).max(5).describe("Subagent number (1-5)").optional(),
  sessionId: z.string().describe("Session ID for mode switching").optional(),
  eventType: z.string().describe("Telemetry event type").optional(),
  eventData: z.record(z.string(), z.unknown()).describe("Telemetry event data").optional(),
  serverName: z.string().describe("MCP server name").optional(),
  serverCommand: z.string().describe("MCP server command").optional(),
  serverArgs: z.array(z.string()).describe("MCP server arguments").optional(),
  global: z.boolean().describe("Use global config instead of project config").optional(),
  plan: z.enum(["free", "pro"]).describe("User plan tier").optional(),
})

// @ts-ignore - TypeScript inference issue with Tool.define function form
export const PakalonTool = Tool.define("pakalon", async (_ctx) => {
  return {
    description: `Pakalon 6-phase agentic development pipeline tool. Use this to:
- Initialize the pipeline (init-pipeline)
- Run interactive Q&A (init-qa, get-current-question, answer-question)
- Generate phase artifacts (generate-phase1, generate-normal-artifacts)
- Manage phase transitions (advance-phase, get-phase-status)
- Run subagents (run-subagent, run-all-subagents)
- Generate security reports (generate-security-report, generate-blackbox-tests, generate-whitebox-tests)
- Manage modes (get-mode, cycle-mode, toggle-thinking)
- Track telemetry (get-telemetry-id, track-event)
- Manage MCP servers (list-mcp-servers, add-mcp-server, remove-mcp-server)

Example usage:
- Start pipeline: { action: "init-pipeline", mode: "hil", prompt: "Build a SaaS dashboard" }
- Get next question: { action: "get-current-question" }
- Answer question: { action: "answer-question", questionAnswer: "1" }
- Generate Phase 1: { action: "generate-phase1" }
- Check status: { action: "get-phase-status" }
- Advance to next phase: { action: "advance-phase" }`,

    parameters: PARAMETERS,

    async execute(params: z.infer<typeof PARAMETERS>, _ctx) {
      const projectPath = params.projectPath || Instance.worktree

      try {
        switch (params.action) {
          case "init-pipeline": {
            if (!params.mode) throw new Error("mode is required for init-pipeline")
            if (!params.prompt) throw new Error("prompt is required for init-pipeline")

            const state = await PhaseOrchestrator.initState(projectPath, params.mode)
            await PhaseOrchestrator.ensureDirectoryStructure(projectPath)

            log.info("Pipeline initialized", { projectPath, mode: params.mode })

            return {
              output: JSON.stringify({
                success: true,
                message: `Pakalon pipeline initialized in ${params.mode.toUpperCase()} mode`,
                state: {
                  currentPhase: state.currentPhase,
                  mode: state.mode,
                },
                nextStep: "Run init-qa to start the Q&A session",
              }),
              title: "Pipeline Initialized",
              metadata: { phase: 1, mode: params.mode },
            }
          }

          case "init-qa": {
            if (!params.mode) throw new Error("mode is required for init-qa")
            if (!params.prompt) throw new Error("prompt is required for init-qa")

            const session = QASystem.init(projectPath, params.mode, params.prompt)
            const currentQuestion = QASystem.current(projectPath)

            return {
              output: JSON.stringify({
                success: true,
                message: "Q&A session initialized",
                mode: session.mode,
                totalQuestions: session.questions.length,
                currentQuestion: currentQuestion ? QASystem.format(currentQuestion) : null,
              }),
              title: "Q&A Session Started",
              metadata: { mode: params.mode },
            }
          }

          case "get-current-question": {
            const question = QASystem.current(projectPath)
            if (!question) {
              return {
                output: JSON.stringify({
                  success: true,
                  complete: true,
                  message: "Q&A session is complete",
                  responses: QASystem.getResponses(projectPath),
                }),
                title: "Q&A Complete",
                metadata: { complete: true },
              }
            }

            return {
              output: JSON.stringify({
                success: true,
                complete: false,
                question: QASystem.format(question),
                questionId: question.id,
                questionType: question.type,
                options: question.options,
              }),
              title: "Current Question",
              metadata: { complete: false },
            }
          }

          case "answer-question": {
            if (!params.questionAnswer) throw new Error("questionAnswer is required")

            const nextQuestion = QASystem.answer(projectPath, params.questionAnswer)
            const isComplete = QASystem.isComplete(projectPath)

            return {
              output: JSON.stringify({
                success: true,
                complete: isComplete,
                nextQuestion: nextQuestion ? QASystem.format(nextQuestion) : null,
                responses: isComplete ? QASystem.getResponses(projectPath) : undefined,
                message: isComplete
                  ? "Q&A complete! Run generate-phase1 to create artifacts."
                  : "Answer recorded. Get next question to continue.",
              }),
              title: isComplete ? "Q&A Complete" : "Answer Recorded",
              metadata: { complete: isComplete },
            }
          }

          case "generate-phase1": {
            const responses = QASystem.getResponses(projectPath)
            const prompt = responses._prompt || params.prompt || "No prompt provided"

            const artifacts = await PhaseOrchestrator.generatePhase1Artifacts(
              projectPath,
              prompt,
              responses,
            )

            return {
              output: JSON.stringify({
                success: true,
                message: "Phase 1 artifacts generated successfully",
                files: Object.keys(artifacts),
                phaseDir: path.join(Pakalon.agentsDir(projectPath), "phase-1"),
              }),
              title: "Phase 1 Artifacts Generated",
              metadata: { phase: 1, fileCount: Object.keys(artifacts).length },
            }
          }

          case "advance-phase": {
            const nextPhase = await PhaseOrchestrator.advancePhase(projectPath)
            if (nextPhase === null) {
              return {
                output: JSON.stringify({
                  success: true,
                  complete: true,
                  message: "All phases complete!",
                }),
                title: "Pipeline Complete",
                metadata: {},
              }
            }

            return {
              output: JSON.stringify({
                success: true,
                currentPhase: nextPhase,
                phaseName: Pakalon.phaseName(nextPhase),
                message: `Advanced to Phase ${nextPhase}: ${Pakalon.phaseName(nextPhase)}`,
              }),
              title: `Phase ${nextPhase}: ${Pakalon.phaseName(nextPhase)}`,
              metadata: { phase: nextPhase },
            }
          }

          case "get-phase-status": {
            const state = await PhaseOrchestrator.getState(projectPath)
            if (!state) {
              return {
                output: JSON.stringify({
                  success: false,
                  message: "Pipeline not initialized. Run init-pipeline first.",
                }),
                title: "Not Initialized",
                metadata: {},
              }
            }

            return {
              output: JSON.stringify({
                success: true,
                currentPhase: state.currentPhase,
                phaseName: Pakalon.phaseName(state.currentPhase),
                mode: state.mode,
                completionStatus: {
                  phase1: state.phase1Complete,
                  phase2: state.phase2Complete,
                  phase3: state.phase3Complete,
                  phase4: state.phase4Complete,
                  phase5: state.phase5Complete,
                  phase6: state.phase6Complete,
                },
                auditorIterations: state.auditorIterations,
                maxAuditorIterations: state.maxAuditorIterations,
              }),
              title: `Phase ${state.currentPhase} Status`,
              metadata: { phase: state.currentPhase },
            }
          }

          case "init-normal-mode": {
            await NormalMode.ensureStructure(projectPath)
            return {
              output: JSON.stringify({
                success: true,
                message: "Normal mode structure created",
                normalDir: Pakalon.normalDir(projectPath),
              }),
              title: "Normal Mode Initialized",
              metadata: {},
            }
          }

          case "generate-normal-artifacts": {
            if (!params.prompt) throw new Error("prompt is required for generate-normal-artifacts")
            const responses = QASystem.getResponses(projectPath)

            const artifacts = await NormalMode.generateArtifacts(projectPath, params.prompt, responses)

            return {
              output: JSON.stringify({
                success: true,
                message: "Normal mode artifacts generated",
                files: Object.keys(artifacts),
                normalDir: Pakalon.normalDir(projectPath),
              }),
              title: "Normal Artifacts Generated",
              metadata: { fileCount: Object.keys(artifacts).length },
            }
          }

          case "run-subagent": {
            if (!params.subagentNumber) throw new Error("subagentNumber is required")
            const subagent = PHASE3_SUBAGENTS.find((s) => s.number === params.subagentNumber)
            if (!subagent) throw new Error(`Subagent ${params.subagentNumber} not found`)

            const result = await Phase3Subagents.runSubagent(
              projectPath,
              subagent,
              params.mode || "yolo",
            )

            return {
              output: JSON.stringify({
                success: result.success,
                subagent: result.subagent.name,
                markdownPath: result.markdownPath,
                duration: result.duration,
              }),
              title: `Subagent ${params.subagentNumber}: ${subagent.name}`,
              metadata: { subagent: params.subagentNumber },
            }
          }

          case "run-all-subagents": {
            const results = await Phase3Subagents.runAllSubagents(
              projectPath,
              params.mode || "yolo",
            )

            return {
              output: JSON.stringify({
                success: true,
                results: results.map((r) => ({
                  subagent: r.subagent.name,
                  success: r.success,
                  markdownPath: r.markdownPath,
                })),
              }),
              title: "All Subagents Complete",
              metadata: { count: results.length },
            }
          }

          case "generate-security-report": {
            if (!params.subagentNumber) throw new Error("subagentNumber is required")
            const subagent = SECURITY_SUBAGENTS.find((s) => s.number === params.subagentNumber)
            if (!subagent) throw new Error(`Security subagent ${params.subagentNumber} not found`)

            const report = await Phase4Security.runSecuritySubagent(
              projectPath,
              subagent,
              params.plan || "free",
            )

            return {
              output: JSON.stringify({
                success: true,
                subagent: subagent.name,
                report: report.slice(0, 500) + "...",
              }),
              title: `Security Report: ${subagent.name}`,
              metadata: { subagent: params.subagentNumber },
            }
          }

          case "generate-blackbox-tests": {
            await Phase4Security.generateBlackboxTests(projectPath)
            return {
              output: JSON.stringify({
                success: true,
                message: "Blackbox tests generated",
                path: path.join(Pakalon.agentsDir(projectPath), "phase-4", "blackbox_testing.xml"),
              }),
              title: "Blackbox Tests Generated",
              metadata: {},
            }
          }

          case "generate-whitebox-tests": {
            await Phase4Security.generateWhiteboxTests(projectPath)
            return {
              output: JSON.stringify({
                success: true,
                message: "Whitebox tests generated",
                path: path.join(Pakalon.agentsDir(projectPath), "phase-4", "whitebox_testing.xml"),
              }),
              title: "Whitebox Tests Generated",
              metadata: {},
            }
          }

          case "get-mode": {
            if (!params.sessionId) throw new Error("sessionId is required for get-mode")
            const modeState = ModeSwitcher.get(params.sessionId)
            if (!modeState) {
              const newState = ModeSwitcher.init(params.sessionId)
              return {
                output: JSON.stringify({
                  success: true,
                  mode: newState.currentMode,
                  thinking: newState.thinkingEnabled,
                  description: ModeSwitcher.getModeDescription(newState.currentMode),
                }),
                title: "Mode Initialized",
                metadata: {},
              }
            }

            return {
              output: JSON.stringify({
                success: true,
                mode: modeState.currentMode,
                thinking: modeState.thinkingEnabled,
                description: ModeSwitcher.getModeDescription(modeState.currentMode),
                statusBar: ModeSwitcher.formatStatusBar(modeState.currentMode, modeState.thinkingEnabled),
              }),
              title: `Mode: ${modeState.currentMode}`,
              metadata: { mode: modeState.currentMode },
            }
          }

          case "cycle-mode": {
            if (!params.sessionId) throw new Error("sessionId is required for cycle-mode")
            const newState = ModeSwitcher.cycleMode(params.sessionId)
            if (!newState) throw new Error("Session not found")

            return {
              output: JSON.stringify({
                success: true,
                mode: newState.currentMode,
                description: ModeSwitcher.getModeDescription(newState.currentMode),
                permissions: ModeSwitcher.getModePermissions(newState.currentMode),
              }),
              title: `Switched to ${newState.currentMode}`,
              metadata: { mode: newState.currentMode },
            }
          }

          case "toggle-thinking": {
            if (!params.sessionId) throw new Error("sessionId is required for toggle-thinking")
            const newState = ModeSwitcher.toggleThinking(params.sessionId)
            if (!newState) throw new Error("Session not found")

            return {
              output: JSON.stringify({
                success: true,
                thinking: newState.thinkingEnabled,
                message: `Thinking mode ${newState.thinkingEnabled ? "enabled" : "disabled"}`,
              }),
              title: `Thinking ${newState.thinkingEnabled ? "ON" : "OFF"}`,
              metadata: { thinking: newState.thinkingEnabled },
            }
          }

          case "get-telemetry-id": {
            const identifiers = await TelemetryManager.getIdentifiers()
            return {
              output: JSON.stringify({
                success: true,
                machineId: identifiers.machineId,
                macMachineId: identifiers.macMachineId,
                devDeviceId: identifiers.devDeviceId,
              }),
              title: "Machine Identifiers",
              metadata: {},
            }
          }

          case "track-event": {
            if (!params.eventType) throw new Error("eventType is required for track-event")
            await TelemetryManager.trackEvent({
              type: params.eventType,
              timestamp: Date.now(),
              data: params.eventData || {},
            })

            return {
              output: JSON.stringify({
                success: true,
                message: `Event tracked: ${params.eventType}`,
              }),
              title: "Event Tracked",
              metadata: { eventType: params.eventType },
            }
          }

          case "list-mcp-servers": {
            const servers = await MCPProjectConfig.listServers(projectPath)
            return {
              output: JSON.stringify({
                success: true,
                global: servers.global,
                project: servers.project,
              }),
              title: "MCP Servers",
              metadata: { globalCount: servers.global.length, projectCount: servers.project.length },
            }
          }

          case "add-mcp-server": {
            if (!params.serverName || !params.serverCommand) {
              throw new Error("serverName and serverCommand are required for add-mcp-server")
            }

            await MCPProjectConfig.addServer(
              params.global ? null : projectPath,
              {
                name: params.serverName,
                command: params.serverCommand,
                args: params.serverArgs,
              },
              params.global || false,
            )

            return {
              output: JSON.stringify({
                success: true,
                message: `MCP server "${params.serverName}" added`,
                global: params.global || false,
              }),
              title: "MCP Server Added",
              metadata: { server: params.serverName },
            }
          }

          case "remove-mcp-server": {
            if (!params.serverName) throw new Error("serverName is required for remove-mcp-server")

            await MCPProjectConfig.removeServer(
              params.global ? null : projectPath,
              params.serverName,
              params.global || false,
            )

            return {
              output: JSON.stringify({
                success: true,
                message: `MCP server "${params.serverName}" removed`,
              }),
              title: "MCP Server Removed",
              metadata: { server: params.serverName },
            }
          }

          default:
            throw new Error(`Unknown action: ${params.action}`)
        }
      } catch (error) {
        log.error("Pakalon tool error", { action: params.action, error })
        return {
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
          title: "Error",
          metadata: {},
        }
      }
    },
  }
})

export default PakalonTool
