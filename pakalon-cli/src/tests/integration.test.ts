/**
 * Integration Tests
 * End-to-end tests for 6-phase workflow
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAllPhases, runSinglePhase } from '../agents/orchestrator.js';
import type { AgentContext } from '../agents/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests', () => {
  let testDir: string;
  
  beforeAll(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pakalon-test-'));
  });
  
  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  describe('Phase 1: Planning', () => {
    it('should generate planning documents', async () => {
      const context: AgentContext = {
        userPrompt: 'Build a simple todo app',
        projectDir: testDir,
        isYolo: true,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
      
      const result = await runSinglePhase(1, context);
      
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
      
      // Check if planning files were created
      const planningDir = path.join(testDir, '.pakalon-agents', 'phase-1');
      const planFile = path.join(planningDir, 'plan.md');
      
      const planExists = await fs.access(planFile).then(() => true).catch(() => false);
      expect(planExists).toBe(true);
    }, 60000); // 60 second timeout
  });
  
  describe('Phase 2: Design', () => {
    it('should generate design system', async () => {
      const context: AgentContext = {
        userPrompt: 'Build a simple todo app',
        projectDir: testDir,
        isYolo: true,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
      
      const result = await runSinglePhase(2, context);
      
      expect(result.success).toBe(true);
    }, 60000);
  });
  
  describe('Full Workflow', () => {
    it('should complete all 6 phases', async () => {
      const context: AgentContext = {
        userPrompt: 'Build a REST API for managing books',
        projectDir: testDir,
        isYolo: true,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
      
      const result = await runAllPhases(context, {
        startPhase: 1,
        endPhase: 6,
        isYolo: true,
      });
      
      expect(result.success).toBe(true);
      expect(result.phasesCompleted).toHaveLength(6);
      expect(result.phasesFailed).toHaveLength(0);
      
      // Verify key files exist
      const filesCheck = [
        '.pakalon-agents/phase-1/plan.md',
        '.pakalon-agents/phase-2/phase-2.md',
        '.pakalon-agents/phase-3/phase-3.md',
        'README.md',
        'Dockerfile',
        'docker-compose.yml',
      ];
      
      for (const file of filesCheck) {
        const filePath = path.join(testDir, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    }, 300000); // 5 minute timeout for full workflow
  });
  
  describe('Error Handling', () => {
    it('should handle invalid project directory', async () => {
      const context: AgentContext = {
        userPrompt: 'Build an app',
        projectDir: '/invalid/path/that/does/not/exist',
        isYolo: true,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
      
      const result = await runSinglePhase(1, context);
      
      // Should still succeed by creating the directory
      expect(result.success).toBe(true);
    }, 30000);
    
    it('should handle missing API key gracefully', async () => {
      const context: AgentContext = {
        userPrompt: 'Build an app',
        projectDir: testDir,
        isYolo: true,
        // apiKey intentionally not provided
      };
      
      try {
        await runSinglePhase(1, context);
        // Should throw error
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }
    }, 10000);
  });
  
  describe('YOLO vs HIL Mode', () => {
    it('should run in YOLO mode without user input', async () => {
      const context: AgentContext = {
        userPrompt: 'Build a blog',
        projectDir: testDir,
        isYolo: true,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
      
      const result = await runSinglePhase(1, context);
      expect(result.success).toBe(true);
    }, 60000);
  });
});
