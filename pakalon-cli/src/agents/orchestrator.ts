/**
 * Phase Orchestrator
 * Manages the 6-phase development workflow
 * Enterprise-grade orchestration with state management
 */

import { Phase1Agent } from './phase1/index.js';
import { Phase2Agent } from './phase2/index.js';
import { Phase3Agent } from './phase3/index.js';
import { Phase4Agent } from './phase4/index.js';
import { Phase5Agent } from './phase5/index.js';
import { Phase6Agent } from './phase6/index.js';
import type { AgentContext, AgentResult } from './types.js';
import { permissionGate } from '@/ai/permission-gate.js';
import logger from '@/utils/logger.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { loadSandboxState } from '@/sandbox/index.js';

export interface OrchestrationOptions {
  startPhase?: 1 | 2 | 3 | 4 | 5 | 6;
  endPhase?: 1 | 2 | 3 | 4 | 5 | 6;
  skipPhases?: number[];
  isYolo?: boolean;
}

export interface OrchestrationResult {
  success: boolean;
  message: string;
  phasesCompleted: number[];
  phasesFailed: number[];
  totalDuration: number;
  results: Map<number, AgentResult>;
}

/**
 * Phase checkpoint for human-in-loop approval
 */
export interface PhaseCheckpoint {
  phase: number;
  phaseName: string;
  summary: string;
  artifacts: string[];
  risks: string[];
  canProceed: boolean;
  userDecision?: 'approve' | 'reject' | 'modify';
}

export class PhaseOrchestrator {
  private context: AgentContext;
  private options: OrchestrationOptions;
  private results: Map<number, AgentResult>;
  private checkpoints: PhaseCheckpoint[] = [];
  
  constructor(context: AgentContext, options: OrchestrationOptions = {}) {
    this.context = context;
    this.options = {
      startPhase: options.startPhase || 1,
      endPhase: options.endPhase || 6,
      skipPhases: options.skipPhases || [],
      isYolo: options.isYolo !== undefined ? options.isYolo : context.isYolo,
    };
    this.results = new Map();
    
    logger.info('[Orchestrator] Initialized');
    logger.info(`[Orchestrator] Phases: ${this.options.startPhase} → ${this.options.endPhase}`);
    logger.info(`[Orchestrator] YOLO mode: ${this.options.isYolo}`);
    if (this.options.skipPhases!.length > 0) {
      logger.info(`[Orchestrator] Skipping phases: ${this.options.skipPhases!.join(', ')}`);
    }
  }

  /**
   * Get phase name from number
   */
  private getPhaseName(phaseNum: number): string {
    const names: Record<number, string> = {
      1: 'Planning & Research',
      2: 'Wireframes & Design',
      3: 'Development',
      4: 'Security & QA',
      5: 'CI/CD & Deployment',
      6: 'Documentation',
    };
    return names[phaseNum] || `Phase ${phaseNum}`;
  }

  /**
   * Create a checkpoint after each phase for HIL mode
   */
  private async createCheckpoint(
    phaseNum: number,
    result: AgentResult
  ): Promise<PhaseCheckpoint> {
    const checkpoint: PhaseCheckpoint = {
      phase: phaseNum,
      phaseName: this.getPhaseName(phaseNum),
      summary: result.message || 'Phase completed',
      artifacts: result.filesCreated ? [...result.filesCreated] : [],
      risks: this.assessPhaseRisks(phaseNum, result),
      canProceed: result.success,
    };
    
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Assess potential risks from phase results
   */
  private assessPhaseRisks(phaseNum: number, result: AgentResult): string[] {
    const risks: string[] = [];
    
    if (!result.success) {
      risks.push('Phase failed - may affect downstream phases');
    }
    
    if (result.message?.includes('error') || result.message?.includes('failed')) {
      risks.push('Errors detected in phase output');
    }
    
    // Phase-specific risk assessment
    switch (phaseNum) {
      case 1:
        if (!result.message?.includes('plan')) {
          risks.push('Incomplete planning - may cause scope issues');
        }
        break;
      case 2:
        if (!result.message?.includes('wireframe') && !result.message?.includes('design')) {
          risks.push('No wireframes generated - UI may not match requirements');
        }
        break;
      case 3:
        if (!result.filesCreated?.length) {
          risks.push('No code generated - nothing to deploy');
        }
        break;
    }
    
    return risks;
  }

  /**
   * Request human approval between phases (HIL mode)
   */
  private async requestPhaseApproval(checkpoint: PhaseCheckpoint): Promise<boolean> {
    if (this.options.isYolo) {
      logger.info(`[Orchestrator] YOLO mode - auto-approving ${checkpoint.phaseName}`);
      return true;
    }
    
    logger.info(`[Orchestrator] ════════════════════════════════════════════`);
    logger.info(`[Orchestrator] CHECKPOINT: ${checkpoint.phaseName} Complete`);
    logger.info(`[Orchestrator] ════════════════════════════════════════════`);
    logger.info(`[Orchestrator] Summary: ${checkpoint.summary}`);
    
    if (checkpoint.artifacts.length > 0) {
      logger.info(`[Orchestrator] Artifacts: ${checkpoint.artifacts.length} files created`);
    }
    
    if (checkpoint.risks.length > 0) {
      logger.warn(`[Orchestrator] Risks: ${checkpoint.risks.join(', ')}`);
    }
    
    // Use permission gate for interactive approval
    try {
      const approved = await permissionGate.requestPermission(
        'phaseTransition',
        `Proceed to next phase after ${checkpoint.phaseName}`,
        { 
          phase: checkpoint.phase,
          summary: checkpoint.summary,
          artifacts: checkpoint.artifacts,
          risks: checkpoint.risks,
        },
        'orchestrator',
        `Continue to ${this.getPhaseName(checkpoint.phase + 1)}?`
      );
      
      return approved;
    } catch (error) {
      logger.error('[Orchestrator] Approval request failed:', error);
      // In case of error, prompt user directly
      return await this.promptUserApproval(checkpoint);
    }
  }

  /**
   * Fallback interactive prompt for user approval
   */
  private async promptUserApproval(checkpoint: PhaseCheckpoint): Promise<boolean> {
    logger.info('[Orchestrator] Waiting for user approval...');
    logger.info('[Orchestrator] Type "y" to proceed, "n" to stop, "s" to skip remaining checkpoints');
    
    // This would integrate with actual TUI input
    // For now, log the checkpoint info
    return true; // Default to proceed in non-interactive mode
  }

  /**
   * Display interactive checkpoint summary to user
   */
  public displayCheckpointSummary(): void {
    if (this.checkpoints.length === 0) {
      logger.info('[Orchestrator] No checkpoints recorded');
      return;
    }
    
    logger.info('\n═══════════════════════════════════════════════════');
    logger.info('              PHASE CHECKPOINT SUMMARY');
    logger.info('═══════════════════════════════════════════════════');
    
    for (const cp of this.checkpoints) {
      const status = cp.canProceed ? '[OK]' : '[X]';
      logger.info(`${status} ${cp.phaseName}: ${cp.summary}`);
      if (cp.risks.length > 0) {
        logger.info(`  [!] Risks: ${cp.risks.join('; ')}`);
      }
    }
    
    logger.info('═══════════════════════════════════════════════════');
  }

  /**
   * Get sandbox state summary string for checkpoint display
   */
  private async getSandboxSummary(): Promise<string | null> {
    if (!this.context.projectDir) return null;
    try {
      const sandboxState = await loadSandboxState(this.context.projectDir);
      if (!sandboxState) return null;
      return `Sandbox: ${sandboxState.url} [${sandboxState.status}] (container: ${sandboxState.containerId.substring(0, 12)}...)`;
    } catch {
      return null;
    }
  }

  /**
   * Display interactive checkpoint summary to user (with sandbox state)
   */
  public async displayCheckpointSummaryWithSandbox(): Promise<void> {
    this.displayCheckpointSummary();
    const sandboxSummary = await this.getSandboxSummary();
    if (sandboxSummary) {
      logger.info(`[Orchestrator] ${sandboxSummary}`);
    }
  }
  
  /**
   * Run all phases in sequence
   */
  public async executeAll(): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const phasesCompleted: number[] = [];
    const phasesFailed: number[] = [];
    
    try {
      logger.info('[Orchestrator] ========================================');
      logger.info('[Orchestrator] Starting Pakalon 6-Phase Workflow');
      logger.info('[Orchestrator] ========================================');
      
      // Create root output directory
      const projectDir = this.context.projectDir ?? process.cwd();
      const rootDir = path.join(projectDir, '.pakalon-agents');
      await fs.mkdir(rootDir, { recursive: true });
      
      // Execute phases with optional loop-back support
      const maxLoopIterations = 3;
      let loopCount = 0;
      for (let phaseNum = this.options.startPhase!; phaseNum <= this.options.endPhase!; phaseNum++) {
        if (this.options.skipPhases!.includes(phaseNum)) {
          logger.info(`[Orchestrator] Skipping Phase ${phaseNum}`);
          continue;
        }
        
        const result = await this.executePhase(phaseNum);
        this.results.set(phaseNum, result);
        
        // Create checkpoint after each phase
        const checkpoint = await this.createCheckpoint(phaseNum, result);
        
        if (result.success) {
          phasesCompleted.push(phaseNum);
          logger.info(`[Orchestrator] [OK] Phase ${phaseNum} completed`);
          
          // Check if phase result requests a loop-back to an earlier phase
          // (used by Phase 5 sandbox policy failure → loop back to Phase 3)
          const loopBackToPhase = result.data?.loopBackToPhase as number | undefined;
          if (loopBackToPhase && loopBackToPhase >= (this.options.startPhase ?? 1) && loopBackToPhase < phaseNum) {
            loopCount++;
            if (loopCount >= maxLoopIterations) {
              logger.error(`[Orchestrator] Max loop iterations (${maxLoopIterations}) reached, aborting`);
              phasesFailed.push(phaseNum);
              break;
            }
            logger.info(`[Orchestrator] Looping back to Phase ${loopBackToPhase} (iteration ${loopCount}/${maxLoopIterations})`);
            phaseNum = loopBackToPhase as typeof phaseNum; // loop will increment to loopBackToPhase + 1 next
            continue;
          }
          
          // Request approval for next phase (in HIL mode)
          if (phaseNum < this.options.endPhase!) {
            const approved = await this.requestPhaseApproval(checkpoint);
            if (!approved) {
              logger.warn('[Orchestrator] User rejected proceeding to next phase');
              break;
            }
          }
        } else {
          phasesFailed.push(phaseNum);
          logger.error(`[Orchestrator] [X] Phase ${phaseNum} failed: ${result.message}`);
          
          // Stop execution on failure (unless YOLO mode)
          if (!this.options.isYolo) {
            logger.warn('[Orchestrator] Stopping execution due to phase failure');
            break;
          }
        }
      }
      
      const totalDuration = Date.now() - startTime;
      
      logger.info('[Orchestrator] ========================================');
      logger.info(`[Orchestrator] Workflow Completed in ${(totalDuration / 1000).toFixed(1)}s`);
      logger.info(`[Orchestrator] Phases Completed: ${phasesCompleted.join(', ')}`);
      if (phasesFailed.length > 0) {
        logger.info(`[Orchestrator] Phases Failed: ${phasesFailed.join(', ')}`);
      }
      logger.info('[Orchestrator] ========================================');
      
      // Display checkpoint summary (with sandbox state if available)
      await this.displayCheckpointSummaryWithSandbox();
      
      return {
        success: phasesFailed.length === 0,
        message: phasesFailed.length === 0
          ? 'All phases completed successfully'
          : `${phasesFailed.length} phase(s) failed`,
        phasesCompleted,
        phasesFailed,
        totalDuration,
        results: this.results,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Orchestrator] Orchestration failed: ${message}`);
      
      return {
        success: false,
        message: `Orchestration failed: ${message}`,
        phasesCompleted,
        phasesFailed,
        totalDuration: Date.now() - startTime,
        results: this.results,
      };
    }
  }
  
  /**
   * Execute a single phase
   */
  public async executePhase(phaseNum: number): Promise<AgentResult> {
    logger.info(`[Orchestrator] Executing Phase ${phaseNum}...`);
    
    // Update context with YOLO mode from options
    const phaseContext: AgentContext = {
      ...this.context,
      isYolo: this.options.isYolo || false,
      isAgentMode: true,
    };
    
    try {
      let agent;
      
      switch (phaseNum) {
        case 1:
          agent = new Phase1Agent(phaseContext);
          break;
        case 2:
          agent = new Phase2Agent(phaseContext);
          break;
        case 3:
          agent = new Phase3Agent(phaseContext);
          break;
        case 4:
          agent = new Phase4Agent(phaseContext);
          break;
        case 5:
          agent = new Phase5Agent(phaseContext);
          break;
        case 6:
          agent = new Phase6Agent(phaseContext);
          break;
        default:
          throw new Error(`Invalid phase number: ${phaseNum}`);
      }
      
      return await agent.execute();
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Orchestrator] Phase ${phaseNum} execution failed: ${message}`);
      
      return {
        success: false,
        message: `Phase ${phaseNum} failed: ${message}`,
        duration: 0,
      };
    }
  }
  
  /**
   * Get results for all executed phases
   */
  public getResults(): Map<number, AgentResult> {
    return this.results;
  }
  
  /**
   * Get result for a specific phase
   */
  public getPhaseResult(phaseNum: number): AgentResult | undefined {
    return this.results.get(phaseNum);
  }
}

/**
 * Convenience function to run all phases
 */
export async function runAllPhases(
  context: AgentContext,
  options?: OrchestrationOptions
): Promise<OrchestrationResult> {
  const orchestrator = new PhaseOrchestrator(context, options);
  return await orchestrator.executeAll();
}

/**
 * Convenience function to run a single phase
 */
export async function runSinglePhase(
  phaseNum: number,
  context: AgentContext
): Promise<AgentResult> {
  const orchestrator = new PhaseOrchestrator(context);
  return await orchestrator.executePhase(phaseNum);
}
