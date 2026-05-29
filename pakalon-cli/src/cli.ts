#!/usr/bin/env node
/**
 * Pakalon CLI Entry Point
 * Production-ready enterprise application generator
 */

import { Command } from 'commander';
import { runAllPhases, runSinglePhase } from './agents/orchestrator.js';
import type { AgentContext } from './agents/types.js';
import { initializeMCP, shutdownMCP } from './integrations/mcp.js';
import logger from './utils/logger.js';
import * as path from 'path';
import chalk from 'chalk';

const program = new Command();

program
  .name('pakalon')
  .description('Enterprise-grade application generator with 6-phase agentic workflow')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate a complete application')
  .argument('<prompt>', 'Describe what you want to build')
  .option('-d, --dir <directory>', 'Output directory', process.cwd())
  .option('-y, --yolo', 'YOLO mode - skip confirmations', false)
  .option('--start-phase <phase>', 'Start from specific phase (1-6)', '1')
  .option('--end-phase <phase>', 'End at specific phase (1-6)', '6')
  .option('--figma <fileId>', 'Import Figma file')
  .option('--api-key <key>', 'OpenRouter API key')
  .option('--continuous-monitoring', 'Enable continuous runtime security monitoring', false)
  .option('--verbose', 'Verbose logging', false)
  .action(async (prompt: string, options: any) => {
    try {
      // Set log level
      if (options.verbose) {
        logger.setLevel('debug');
      }
      
      console.log(chalk.blue.bold('\n[Rocket] Pakalon - Enterprise Application Generator\n'));
      console.log(chalk.gray(`Prompt: ${prompt}`));
      console.log(chalk.gray(`Directory: ${options.dir}`));
      console.log(chalk.gray(`Mode: ${options.yolo ? 'YOLO' : 'Human-in-Loop'}\n`));
      
      // Initialize MCP servers
      console.log(chalk.yellow(' Initializing MCP servers...'));
      await initializeMCP();
      console.log(chalk.green('[OK] MCP servers ready\n'));
      
      // Build context
      const context: AgentContext = {
        userPrompt: prompt,
        projectDir: path.resolve(options.dir),
        isYolo: options.yolo,
        apiKey: options.apiKey || process.env.OPENROUTER_API_KEY,
        figmaFileId: options.figma,
        continuousMonitoring: options.continuousMonitoring,
      };
      
      // Run phases
      const result = await runAllPhases(context, {
        startPhase: parseInt(options.startPhase) as 1 | 2 | 3 | 4 | 5 | 6,
        endPhase: parseInt(options.endPhase) as 1 | 2 | 3 | 4 | 5 | 6,
        isYolo: options.yolo,
      });
      
      // Shutdown MCP
      await shutdownMCP();
      
      // Results
      console.log('\n' + chalk.blue.bold('='.repeat(60)));
      
      if (result.success) {
        console.log(chalk.green.bold('[OK] Generation Complete!\n'));
        console.log(chalk.white(`Phases completed: ${result.phasesCompleted.join(', ')}`));
        console.log(chalk.white(`Total time: ${(result.totalDuration / 1000).toFixed(1)}s\n`));
        console.log(chalk.yellow('Next steps:'));
        console.log(chalk.white('  1. cd ' + context.projectDir));
        console.log(chalk.white('  2. Review generated files in .pakalon-agents/'));
        console.log(chalk.white('  3. Run: npm install'));
        console.log(chalk.white('  4. Run: npm run dev\n'));
      } else {
        console.log(chalk.red.bold('[X] Generation Failed\n'));
        console.log(chalk.white(`Message: ${result.message}`));
        
        if (result.phasesFailed.length > 0) {
          console.log(chalk.white(`Failed phases: ${result.phasesFailed.join(', ')}`));
        }
        
        process.exit(1);
      }
      
    } catch (error) {
      console.error(chalk.red('\n[X] Fatal error:'), error);
      await shutdownMCP();
      process.exit(1);
    }
  });

// Fleet command - Run task across multiple models
program
  .command('fleet')
  .description('Run a task across multiple models in parallel')
  .argument('<task>', 'Task description')
  .option('--models <models>', 'Comma-separated model list (e.g., claude,gpt4,gemini)')
  .option('--timeout <seconds>', 'Timeout per agent in seconds', '300')
  .option('--concurrency <n>', 'Max concurrent agents', '3')
  .option('--verbose', 'Show detailed output', false)
  .action(async (task: string, options: any) => {
    try {
      const { cmdFleet } = await import('./commands/fleet.js');
      
      await cmdFleet({
        task,
        models: options.models,
        timeout: parseInt(options.timeout),
        maxConcurrency: parseInt(options.concurrency),
        verbose: options.verbose,
      });
      
    } catch (error) {
      console.error(chalk.red('[X] Fleet execution failed:'), error);
      process.exit(1);
    }
  });

// Context command - Visualize context window
program
  .command('context')
  .description('Visualize context window usage')
  .option('--detailed', 'Show detailed message history', false)
  .option('--session <id>', 'Inspect specific session')
  .action(async (options: any) => {
    try {
      const { cmdContext } = await import('./commands/context-viz.js');
      
      await cmdContext({
        detailed: options.detailed,
        sessionId: options.session,
      });
      
    } catch (error) {
      console.error(chalk.red('[X] Context visualization failed:'), error);
      process.exit(1);
    }
  });

// Compact command - Manually compact context
program
  .command('compact')
  .description('Manually compact context window')
  .option('--keep <n>', 'Keep last N messages', '10')
  .option('--force', 'Force even if not needed', false)
  .option('--verbose', 'Show detailed statistics', false)
  .option('--dry-run', 'Preview without compacting', false)
  .action(async (options: any) => {
    try {
      const { cmdCompact } = await import('./commands/compact.js');
      const { ContextManager } = await import('./ai/context-manager.js');
      
      // Create or get current session's context manager
      const contextManager = new ContextManager(200_000);
      
      await cmdCompact(contextManager, {
        keepMessages: parseInt(options.keep),
        force: options.force,
        verbose: options.verbose,
        dryRun: options.dryRun,
      });
      
    } catch (error) {
      console.error(chalk.red('[X] Compaction failed:'), error);
      process.exit(1);
    }
  });

program
  .command('phase')
  .description('Run a single phase')
  .argument('<phase>', 'Phase number (1-6)')
  .argument('<prompt>', 'Describe what you want to build')
  .option('-d, --dir <directory>', 'Output directory', process.cwd())
  .option('--api-key <key>', 'OpenRouter API key')
  .option('--continuous-monitoring', 'Enable continuous runtime security monitoring', false)
  .option('--verbose', 'Verbose logging', false)
  .action(async (phaseNum: string, prompt: string, options: any) => {
    try {
      if (options.verbose) {
        logger.setLevel('debug');
      }
      
      const phase = parseInt(phaseNum);
      
      if (phase < 1 || phase > 6) {
        console.error(chalk.red('Phase must be between 1 and 6'));
        process.exit(1);
      }
      
      console.log(chalk.blue.bold(`\n[Rocket] Running Phase ${phase}\n`));
      
      await initializeMCP();
      
      const context: AgentContext = {
        userPrompt: prompt,
        projectDir: path.resolve(options.dir),
        isYolo: true,
        apiKey: options.apiKey || process.env.OPENROUTER_API_KEY,
        continuousMonitoring: options.continuousMonitoring,
      };
      
      const result = await runSinglePhase(phase as 1 | 2 | 3 | 4 | 5 | 6, context);
      
      await shutdownMCP();
      
      if (result.success) {
        console.log(chalk.green.bold(`\n[OK] Phase ${phase} Complete!\n`));
        console.log(chalk.white(`Time: ${(result.duration / 1000).toFixed(1)}s`));
      } else {
        console.log(chalk.red.bold(`\n[X] Phase ${phase} Failed\n`));
        console.log(chalk.white(`Error: ${result.message}`));
        process.exit(1);
      }
      
    } catch (error) {
      console.error(chalk.red('\n[X] Fatal error:'), error);
      await shutdownMCP();
      process.exit(1);
    }
  });

program
  .command('list-phases')
  .description('List all available phases')
  .action(() => {
    console.log(chalk.blue.bold('\nPakalon 6-Phase Workflow:\n'));
    console.log(chalk.white('  1. Planning & Requirements'));
    console.log(chalk.gray('     - Web research, Q&A, 12 planning documents\n'));
    console.log(chalk.white('  2. Wireframes & Design'));
    console.log(chalk.gray('     - Figma import, Penpot wireframes, design system\n'));
    console.log(chalk.white('  3. Development'));
    console.log(chalk.gray('     - Database, Backend, API, Frontend, Integration\n'));
    console.log(chalk.white('  4. Security Scanning'));
    console.log(chalk.gray('     - SAST, DAST, dependency audit, secrets detection\n'));
    console.log(chalk.white('  5. Deployment'));
    console.log(chalk.gray('     - Docker, CI/CD, environment config, cloud deploy\n'));
    console.log(chalk.white('  6. Documentation'));
    console.log(chalk.gray('     - README, API docs, user guide, developer guide\n'));
  });

program.parse();
