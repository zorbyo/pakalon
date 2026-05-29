/**
 * Performance Benchmarks
 * Track generation speed and quality metrics
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import { runSinglePhase } from '../agents/orchestrator.js';
import type { AgentContext } from '../agents/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface BenchmarkResult {
  phase: number;
  duration: number;
  filesCreated: number;
  avgFileSize: number;
  tokensUsed?: number;
}

describe('Performance Benchmarks', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pakalon-bench-'));
  });
  
  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore
    }
  });
  
  it('Phase 1 should complete within 2 minutes', async () => {
    const context: AgentContext = {
      userPrompt: 'Build a todo app with React and Node.js',
      projectDir: testDir,
      isYolo: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
    
    const start = performance.now();
    const result = await runSinglePhase(1, context);
    const duration = performance.now() - start;
    
    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(120000); // 2 minutes
    
    console.log(`Phase 1 completed in ${(duration / 1000).toFixed(1)}s`);
  }, 150000);
  
  it('Phase 2 should complete within 1 minute', async () => {
    const context: AgentContext = {
      userPrompt: 'Build a todo app',
      projectDir: testDir,
      isYolo: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
    
    const start = performance.now();
    const result = await runSinglePhase(2, context);
    const duration = performance.now() - start;
    
    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(60000); // 1 minute
    
    console.log(`Phase 2 completed in ${(duration / 1000).toFixed(1)}s`);
  }, 90000);
  
  it('Phase 3 should complete within 3 minutes', async () => {
    const context: AgentContext = {
      userPrompt: 'Build a REST API',
      projectDir: testDir,
      isYolo: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
    
    // Need Phase 1 first for context
    await runSinglePhase(1, context);
    
    const start = performance.now();
    const result = await runSinglePhase(3, context);
    const duration = performance.now() - start;
    
    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(180000); // 3 minutes
    
    console.log(`Phase 3 completed in ${(duration / 1000).toFixed(1)}s`);
  }, 240000);
  
  it('should generate high-quality code', async () => {
    const context: AgentContext = {
      userPrompt: 'Build a user authentication API',
      projectDir: testDir,
      isYolo: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
    
    // Run Phase 1 and 3
    await runSinglePhase(1, context);
    const result = await runSinglePhase(3, context);
    
    expect(result.success).toBe(true);
    
    // Check generated files quality
    const phase3Dir = path.join(testDir, '.pakalon-agents', 'phase-3');
    
    // Should have generated multiple code files
    const files = await getAllFiles(phase3Dir);
    expect(files.length).toBeGreaterThan(5);
    
    // Files should have reasonable size (not empty, not huge)
    for (const file of files) {
      const stat = await fs.stat(file);
      expect(stat.size).toBeGreaterThan(100); // At least 100 bytes
      expect(stat.size).toBeLessThan(50000); // Less than 50KB per file
    }
  }, 300000);
  
  it('memory usage should stay reasonable', async () => {
    const context: AgentContext = {
      userPrompt: 'Build a blog platform',
      projectDir: testDir,
      isYolo: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
    
    const startMem = process.memoryUsage().heapUsed;
    
    await runSinglePhase(1, context);
    
    const endMem = process.memoryUsage().heapUsed;
    const memIncrease = (endMem - startMem) / 1024 / 1024; // MB
    
    console.log(`Memory increase: ${memIncrease.toFixed(1)} MB`);
    
    // Should not use more than 500MB for a single phase
    expect(memIncrease).toBeLessThan(500);
  }, 120000);
});

async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...await getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist
  }
  
  return files;
}
