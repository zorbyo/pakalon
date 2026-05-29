/**
 * Phase 1 Agent: Planning & Requirements
 * Enterprise-grade implementation with complete feature set
 * 
 * Features:
 * - Web research using Firecrawl MCP
 * - Codebase analysis
 * - Interactive Q&A loop with multiple choice
 * - 12 markdown file generation
 * - Context budgeting
 * - Figma import support
 * - Agent skills identification
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult, Phase1State } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getToolsForAI } from '@/tools/registry-new.js';
import { runPhase1ResearchEnhanced } from '@/phase1/research.js';
import type { ResearchConfig } from '@/phase1/research.js';
import { runCompetitiveAnalysis } from '@/phase1/competitive-analysis.js';
import { analyzeProjectCompletion } from '@/phase1/project-analyzer.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as readline from 'readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'process';
import logger from '@/utils/logger.js';
import { interPhaseStore, interPhaseRetrieve } from '@/memory/mem0-adapter.js';
import type { Mem0Memory } from '@/memory/mem0-adapter.js';
import { createHybridMem0Client } from '@/memory/hybrid-adapter.js';
import { buildAgentSkillsBridge } from '@/integrations/agent-skills-bridge.js';
import { validateDocument, logValidationResults, getValidationSummary } from '@/phase1/validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE1_SYSTEM_PROMPT = `You are the Phase 1 Planning Agent for Pakalon, an enterprise-grade 6-phase development workflow system.

Your responsibilities:
1. Research similar products and best practices
2. Analyze existing codebase (if present)
3. Ask clarifying questions to understand requirements
4. Generate comprehensive planning documentation (12 files)
5. Allocate context budget for implementation
6. Identify relevant agent skills

You MUST use natural language in all responses. Never output raw JSON or tool calls to the user.
When using tools, explain what you're doing in plain English.

Example:
Good: "Let me research similar e-commerce platforms to understand best practices..."
Bad: {"tool": "web_search", "query": "e-commerce"}

Always be thorough, professional, and enterprise-focused.`;

const FILES_TO_GENERATE = [
  'plan.md',
  'tasks.md',
  'user-stories.md',
  'context-management.md',
  'design.md',
  'API_reference.md',
  'Database_schema.md',
  'prd.md',
  'technical-spec.md',
  'agent-skills.md',
  'risk-assessment.md',
  'competitive-analysis.md',
  'constraints-and-tradeoffs.md',
  'phase-1.md', // MUST be last (summary of all above)
] as const;

// ---------------------------------------------------------------------------
// Phase 1 Agent Implementation
// ---------------------------------------------------------------------------

export class Phase1Agent extends BaseAgent {
  private state: Phase1State;
  private outputDir: string;
  private mem0Client: ReturnType<typeof createHybridMem0Client> | null = null;
  private mem0Loaded: boolean = false;
  
  constructor(context: AgentContext) {
    const userPrompt = context.userPrompt ?? '';
    const projectDir = context.projectDir ?? process.cwd();
    const isYolo = context.isYolo ?? false;

    const config: AgentConfig = {
      name: 'phase1-planning',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: PHASE1_SYSTEM_PROMPT,
      tools: getToolsForAI(),
      maxTokens: 8192,
      temperature: 0.7,
    };
    
    super(config, context);
    
    // Initialize state
    this.state = {
      userPrompt,
      projectDir,
      isYolo,
      isNewProject: true,
      researchContext: '',
      existingCodebaseSummary: '',
      qaAnswers: new Map(),
      contextBudget: {},
      generatedFiles: new Map(),
      skillsMd: '',
      totalContext: 200000, // Default 200k tokens
      selections: {},
      questions: [],
    };
    
    // Output directory for Phase 1 files
    this.outputDir = path.join(projectDir, '.pakalon-agents', 'ai-agents', 'phase-1');
    
    // Initialize Mem0 client for cross-session memory
    try {
      this.mem0Client = createHybridMem0Client({
        similarityThreshold: 0.72,
        vectorStore: {
          collectionName: 'pakalon_phase1_memories',
        },
      });
      logger.info('[Phase1] Mem0 hybrid client initialized');
    } catch (error) {
      logger.warn(`[Phase1] Mem0 init failed (non-fatal): ${error}`);
    }
    
    logger.info(`[Phase1] Initialized for project: ${projectDir}`);
    logger.info(`[Phase1] YOLO mode: ${isYolo}`);
    logger.info(`[Phase1] Output directory: ${this.outputDir}`);
  }
  
  /**
   * Main execution method
   */
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      logger.info('[Phase1] ========================================');
      logger.info('[Phase1] Starting Phase 1: Planning & Requirements');
      logger.info('[Phase1] ========================================');
      
      // Create output directory
      await this.createOutputDirectory();
      
      // Step 1: Research similar products/technologies
      logger.info('[Phase1] Step 1/6: Web Research');
      await this.researchWeb();
      
      // Step 1b: Import Figma designs (if available) for design context
      logger.info('[Phase1] Step 1b/6: Figma Import');
      await this.importFigmaDesigns();

      // Step 1c: Competitive analysis
      logger.info('[Phase1] Step 1c/6: Competitive Analysis');
      await this.runCompetitiveAnalysis();
      
      // Step 2: Analyze existing codebase (if not new project)
      logger.info('[Phase1] Step 2/6: Codebase Analysis');
      await this.analyzeCodebase();
      
      // Step 3: Interactive Q&A (unless YOLO mode)
      logger.info('[Phase1] Step 3/6: Requirements Gathering');
      if (!this.state.isYolo) {
        await this.qaLoop();
      } else {
        logger.info('[Phase1] YOLO mode - Skipping Q&A, using AI inference');
      }
      
      // Step 4: Calculate context budget
      logger.info('[Phase1] Step 4/6: Context Budget Allocation');
      await this.calculateContextBudget();
      
      // Step 5: Generate all planning files
      logger.info('[Phase1] Step 5/6: Generating Planning Documents');
      await this.generateAllFiles();
      
      const duration = Date.now() - startTime;
      const filesCreated = Array.from(this.state.generatedFiles.keys());
      
      logger.info('[Phase1] ========================================');
      logger.info(`[Phase1] Phase 1 Completed Successfully in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[Phase1] Files Created: ${filesCreated.length}`);
      logger.info('[Phase1] ========================================');
      
      return {
        success: true,
        message: `Phase 1 completed successfully. Generated ${filesCreated.length} planning documents.`,
        filesCreated,
        data: {
          contextBudget: this.state.contextBudget,
          qaAnswers: Object.fromEntries(this.state.qaAnswers),
          researchSummary: this.state.researchContext.substring(0, 500),
        },
        duration,
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      
      logger.error(`[Phase1] Phase 1 failed after ${(duration / 1000).toFixed(1)}s: ${message}`);
      
      return {
        success: false,
        message: `Phase 1 failed: ${message}`,
        duration,
      };
    }
  }
  
  // ---------------------------------------------------------------------------
  // Step 1: Web Research
  // ---------------------------------------------------------------------------
  
  private async researchWeb(): Promise<void> {
    try {
      logger.info('[Phase1] Researching similar products and technologies...');
      
      // Build research config from user prompt
      const researchTopics = this.detectResearchTopics(this.state.userPrompt);
      const researchConfig: ResearchConfig = {
        topics: researchTopics,
        maxUrlsPerTopic: 3,
      };
      
      // Use enhanced research with actual web scraping
      const researchResult = await runPhase1ResearchEnhanced(
        researchConfig,
        this.state.userPrompt,
        this.state.projectDir,
      );
      
      if (researchResult && researchResult.length > 0) {
        this.state.researchContext = researchResult.map(r => 
          `## ${r.topic}\n\n${r.findings}\n\nSources: ${r.sources.join(', ')}`
        ).join('\n\n');
        
        logger.info(`[Phase1] Research completed (${this.state.researchContext.length} chars)`);
        logger.debug(`[Phase1] Research summary: ${this.state.researchContext.substring(0, 200)}...`);
      } else {
        // Fall back to LLM-only research if scraping fails
        logger.info('[Phase1] Falling back to LLM-based research...');
        const researchPrompt = `Research similar products/technologies for: "${this.state.userPrompt}"

Provide:
1. Similar existing products (3-5 examples)
2. Common tech stacks used
3. Best practices and patterns
4. Potential challenges and solutions

Be concise but thorough. Focus on actionable insights.`;
        
        const result = await generateText({
          model: openrouter(this.config.model),
          system: 'You are a technical research assistant. Provide concise, actionable research insights.',
          prompt: researchPrompt,
          maxOutputTokens: 2048,
        });
        
        this.state.researchContext = result.text;
        logger.info(`[Phase1] LLM Research completed (${result.text.length} chars)`);
      }
      
    } catch (error) {
      logger.warn(`[Phase1] Research failed: ${error}. Continuing without research context.`);
      this.state.researchContext = 'Research unavailable - proceeding with user requirements only.';
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1b: Figma Design Import
  // ---------------------------------------------------------------------------

  /**
   * Import Figma design files to enrich research context
   * Fetches frames, components, and design tokens via Figma API
   */
  private async importFigmaDesigns(): Promise<void> {
    try {
      const figmaFileId = this.context.figmaFileId || process.env.FIGMA_FILE_ID;

      if (!figmaFileId) {
        logger.info('[Phase1] No Figma file ID provided — skipping design import');
        logger.info('[Phase1]   Set FIGMA_TOKEN + FIGMA_FILE_ID env vars, or pass figmaFileId in context');
        return;
      }

      const figmaToken = process.env.FIGMA_TOKEN;
      if (!figmaToken) {
        logger.warn('[Phase1] FIGMA_TOKEN not set — cannot authenticate with Figma API');
        return;
      }

      logger.info(`[Phase1] Importing Figma design file: ${figmaFileId}`);

      const { createFigmaClient } = await import('@/integrations/figma.js');
      const figma = createFigmaClient(figmaToken);

      // Fetch design data in parallel
      const [fileResult, framesResult, componentsResult, stylesResult] = await Promise.all([
        figma.getFile(figmaFileId),
        figma.getFrames(figmaFileId),
        figma.getComponents(figmaFileId),
        figma.getStyles(figmaFileId),
      ]);

      if (fileResult.success) {
        const designSummary: string[] = [];
        designSummary.push(`Figma Design File: ${fileResult.data?.name || figmaFileId}`);

        if (framesResult.success && framesResult.frames) {
          const frameNames = framesResult.frames.map(f => f.name).join(', ');
          designSummary.push(`Frames (${framesResult.frames.length}): ${frameNames}`);
        }

        if (componentsResult.success && componentsResult.components) {
          const compNames = componentsResult.components.map(c => c.name).join(', ');
          designSummary.push(`Components (${componentsResult.components.length}): ${compNames}`);
        }

        if (stylesResult.success && stylesResult.styles) {
          designSummary.push(`Design Styles (${stylesResult.styles.length}): ` +
            stylesResult.styles.map(s => `${s.name} (${s.styleType})`).join(', '));
        }

        const figmaContext = designSummary.join('\n');
        this.state.researchContext += `\n\n## Figma Design Context\n\n${figmaContext}`;

        logger.info(`[Phase1] [OK] Figma import complete — added to research context`);
        logger.debug(`[Phase1] Figma context: ${figmaContext.substring(0, 300)}`);
      } else {
        logger.warn(`[Phase1] Figma API call failed: ${fileResult.error}`);
      }
    } catch (error) {
      logger.warn(`[Phase1] Figma import error (non-fatal): ${error}`);
    }
  }
  
  // ---------------------------------------------------------------------------
  // Step 2: Codebase Analysis
  // ---------------------------------------------------------------------------
  
  private async analyzeCodebase(): Promise<void> {
    try {
      logger.info('[Phase1] Analyzing existing codebase...');
      
      // Check if project directory has files
      const entries = await fs.readdir(this.state.projectDir);
      
      if (entries.length === 0 || (entries.length === 1 && entries[0] === '.pakalon-agents')) {
        logger.info('[Phase1] Empty project - starting fresh');
        this.state.isNewProject = true;
        this.state.existingCodebaseSummary = 'New project - no existing codebase';
        return;
      }
      
      this.state.isNewProject = false;
      
      // Count files and directories
      let fileCount = 0;
      let dirCount = 0;
      const fileTypes = new Map<string, number>();
      
      for (const entry of entries) {
        if (entry.startsWith('.') && entry !== '.pakalon-agents') continue;
        
        const fullPath = path.join(this.state.projectDir, entry);
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory()) {
          dirCount++;
        } else {
          fileCount++;
          const ext = path.extname(entry);
          fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);
        }
      }
      
      const projectAnalysis = await analyzeProjectCompletion(this.state.projectDir);
      const detected = projectAnalysis.detectedFeatures.slice(0, 10).join(', ') || 'none';
      const missing = projectAnalysis.missingFeatures.join(', ') || 'none';
      const partial = projectAnalysis.partiallyImplemented.join(', ') || 'none';
      const techStack = [
        ...(projectAnalysis.techStack.frontend ?? []),
        ...(projectAnalysis.techStack.backend ?? []),
        ...(projectAnalysis.techStack.database ?? []),
        ...projectAnalysis.techStack.tools,
      ].join(', ') || 'unknown';

      // Build summary
      const topFileTypes = Array.from(fileTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ext, count]) => `${ext || 'no-ext'}: ${count}`)
        .join(', ');
      
      this.state.existingCodebaseSummary = `Existing project with ${fileCount} top-level files in ${dirCount} top-level directories. Full scan: ${projectAnalysis.fileStats.totalFiles} files, ${projectAnalysis.fileStats.totalLines} lines, ${projectAnalysis.completionPercentage}% estimated complete. File types: ${topFileTypes}. Detected features: ${detected}. Partially implemented: ${partial}. Missing features: ${missing}. Tech stack: ${techStack}. Recommendations: ${projectAnalysis.recommendations.join(' ') || 'none'}`;
      
      logger.info(`[Phase1] ${this.state.existingCodebaseSummary}`);
      
    } catch (error) {
      logger.warn(`[Phase1] Codebase analysis failed: ${error}`);
      this.state.existingCodebaseSummary = 'Unable to analyze existing codebase';
    }
  }

  /**
   * Detect relevant research topics from the user prompt
   */
  private detectResearchTopics(userPrompt: string): string[] {
    const promptLower = userPrompt.toLowerCase();
    const topicMap: Record<string, string[]> = {
      'frontend': ['frontend', 'ui', 'react', 'vue', 'angular', 'svelte', 'component', 'web app', 'landing page'],
      'backend': ['backend', 'server', 'api', 'node', 'express', 'fastify', 'nestjs', 'database'],
      'design': ['design', 'wireframe', 'ui/ux', 'figma', 'penpot', 'prototype', 'mockup'],
      'mobile': ['mobile', 'react native', 'flutter', 'ios', 'android', 'app'],
      'ai-ml': ['ai', 'machine learning', 'llm', 'gpt', 'openai', 'tensorflow', 'pytorch'],
      'ecommerce': ['ecommerce', 'shop', 'store', 'cart', 'payment', 'checkout', 'stripe'],
      'saas': ['saas', 'subscription', 'billing', 'multi-tenant', 'tenant'],
      'devops': ['docker', 'deploy', 'ci/cd', 'kubernetes', 'cloud', 'aws', 'azure'],
    };

    const detected: string[] = [];
    for (const [topic, keywords] of Object.entries(topicMap)) {
      if (keywords.some(kw => promptLower.includes(kw))) {
        detected.push(topic);
      }
    }

    // Default topics if nothing detected
    if (detected.length === 0) {
      return ['frontend', 'backend', 'design', 'devops'];
    }

    return detected;
  }

  private detectProductCategory(userPrompt: string): string | null {
    const promptLower = userPrompt.toLowerCase();
    const categories: Array<{ category: string; keywords: string[] }> = [
      { category: 'saas', keywords: ['saas', 'subscription', 'dashboard', 'platform', 'portal'] },
      { category: 'ecommerce', keywords: ['ecommerce', 'shop', 'store', 'cart', 'checkout', 'commerce'] },
      { category: 'marketplace', keywords: ['marketplace', 'listing', 'vendor', 'two-sided'] },
      { category: 'crm', keywords: ['crm', 'sales', 'pipeline', 'lead management'] },
      { category: 'cms', keywords: ['cms', 'content', 'publishing', 'editorial'] },
      { category: 'analytics', keywords: ['analytics', 'metrics', 'dashboards', 'reporting'] },
      { category: 'developer-tools', keywords: ['developer tool', 'cli', 'sdk', 'api platform', 'devtool'] },
    ];

    for (const entry of categories) {
      if (entry.keywords.some((keyword) => promptLower.includes(keyword))) {
        return entry.category;
      }
    }

    return null;
  }
  
// ---------------------------------------------------------------------------
// Step 3: Q&A Loop (Human-in-Loop Mode)
// ---------------------------------------------------------------------------

  private async qaLoop(): Promise<void> {
    logger.info('[Phase1] Starting interactive Q&A session...');

    // Load previous Mem0 memory to personalize questions
    const previousMemory = await this.loadPhase1Memory();
    if (previousMemory) {
      logger.info('[Phase1] Loaded previous session preferences from Mem0');
      logger.debug(`[Phase1] Previous context: ${previousMemory.content.substring(0, 200)}`);
    }

    const questions = await this.generateQuestions();

    logger.info(`[Phase1] Generated ${questions.length} questions for user`);

    for (const question of questions) {
      const answer = await this.askUserQuestionInteractive(question);
      this.state.qaAnswers.set(question.id, answer);

      logger.debug(`[Phase1] Q: ${question.text}`);
      logger.debug(`[Phase1] A: ${answer}`);

      if (answer === 'End Phase 1') {
        logger.info('[Phase1] User requested early phase end');
        break;
      }
    }

    logger.info(`[Phase1] Q&A completed with ${this.state.qaAnswers.size} answers`);

    // Save Q&A answers to Mem0 for future sessions
    await this.savePhase1Memory();
  }

  private async runCompetitiveAnalysis(): Promise<void> {
    try {
      const productCategory = this.detectProductCategory(this.state.userPrompt);
      if (!productCategory) {
        logger.info('[Phase1] No clear product category detected — skipping competitive analysis');
        return;
      }

      const report = await runCompetitiveAnalysis(productCategory, this.state.projectDir);
      if (report) {
        this.state.researchContext += `\n\n## Competitive Analysis\n\n${report.substring(0, 4000)}`;
      }
    } catch (error) {
      logger.warn(`[Phase1] Competitive analysis failed: ${error}`);
    }
  }

  private async askUserQuestionInteractive(question: { id: string; text: string; choices: string[] }): Promise<string> {
    const useInteractive = process.env.PAKALON_INTERACTIVE_HIL === "1";

    if (!useInteractive) {
      return this.askUserQuestionAuto(question);
    }

    // Actually prompt the user interactively
    return this.askUserQuestionWithChoices(question);
  }

/**
   * Determine if the user's prompt is "plain" (minimal tech details) or "detailed"
   */
  private isPlainPrompt(prompt: string): boolean {
    const techKeywords = [
      'react', 'next.js', 'vue', 'angular', 'svelte', 'node', 'express', 
      'fastify', 'nestjs', 'go', 'rust', 'postgresql', 'mongodb',
      'mysql', 'tailwind', 'typescript', 'javascript', 'graphql', 'rest',
    ];
    
    const promptLower = prompt.toLowerCase();
    const techCount = techKeywords.filter(keyword => promptLower.includes(keyword)).length;
    
    // If fewer than 2 tech keywords, consider it a "plain" prompt
    return techCount < 2;
  }

  /**
   * Generate additional questions for plain prompts (as per requirements)
   * For plain prompts like "Build an e-commerce website", ask at least 10 clarifying questions
   */
  private generateAdditionalQuestionsForPlainPrompt(): Array<{ id: string; text: string; choices: string[] }> {
    return [
      {
        id: 'q_purpose',
        text: 'What is the main purpose of this application?',
        choices: [
          'E-commerce / Online store',
          'SaaS / Business application',
          'Content management / Blog',
          'Social network / Community',
          'Portfolio / Personal site',
          'Educational platform',
          'Other - user will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q_target_users',
        text: 'Who are the target users of this application?',
        choices: [
          'General consumers',
          'Business professionals',
          'Developers / Technical users',
          'Enterprise / Large organizations',
          'Students / Educators',
          'Specific demographic - will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q_user_count',
        text: 'How many users do you expect?',
        choices: [
          'Small (< 100 users)',
          'Medium (100 - 10,000 users)',
          'Large (10,000 - 1M users)',
          'Enterprise (> 1M users)',
          'Unsure / Will scale as needed',
          'End Phase 1',
        ],
      },
      {
        id: 'q_monetization',
        text: 'How do you plan to monetize?',
        choices: [
          'One-time purchase',
          'Subscription / SaaS',
          'Freemium model',
          'Advertising',
          'Commission / Marketplace fees',
          'Not monetized / Personal use',
          'End Phase 1',
        ],
      },
      {
        id: 'q_design_pref',
        text: 'What design aesthetic do you prefer?',
        choices: [
          'Modern / Minimalist',
          'Corporate / Professional',
          'Creative / Art-focused',
          'Playful / Fun',
          'Dark mode focused',
          'No preference - need suggestions',
          'End Phase 1',
        ],
      },
      {
        id: 'q_mobile',
        text: 'Is mobile responsiveness important?',
        choices: [
          'Yes - critical (mobile-first)',
          'Yes - important (responsive)',
          'Desktop only is fine',
          'Native mobile app (not responsive web)',
          'Both web and native',
          'End Phase 1',
        ],
      },
      {
        id: 'q_integrations',
        text: 'Do you need any third-party integrations?',
        choices: [
          'Payment processing (Stripe, PayPal)',
          'Email marketing (Mailchimp, etc)',
          'Social media integration',
          'Analytics (Google Analytics, etc)',
          'SMS / Messaging',
          'No integrations needed',
          'End Phase 1',
        ],
      },
      {
        id: 'q_admin',
        text: 'Do you need an admin dashboard?',
        choices: [
          'Yes - full admin panel',
          'Yes - basic management',
          'No admin needed',
          'User will decide later',
          'End Phase 1',
        ],
      },
      {
        id: 'q_seo',
        text: 'Is SEO important for this application?',
        choices: [
          'Yes - critical for business',
          'Yes - nice to have',
          'Not important (internal tool)',
          'Not sure - need guidance',
          'End Phase 1',
        ],
      },
      {
        id: 'q_timeline',
        text: 'What is your timeline expectation?',
        choices: [
          'MVP in 1-2 weeks',
          'MVP in 1 month',
          'Full product in 3 months',
          'No rush - quality first',
          'Flexible - just need it working',
          'End Phase 1',
        ],
      },
    ];
  }

  private async generateQuestions(): Promise<Array<{ id: string; text: string; choices: string[] }>> {
    const questions: Array<{ id: string; text: string; choices: string[] }> = [];
    
    // Determine prompt type
    const isPlain = this.isPlainPrompt(this.state.userPrompt);
    logger.info(`[Phase1] Prompt type detected: ${isPlain ? 'PLAIN (will ask 10+ questions)' : 'DETAILED'}`);
    
    // For plain prompts, add purpose/target questions first
    if (isPlain) {
      const additionalQuestions = this.generateAdditionalQuestionsForPlainPrompt();
      questions.push(...additionalQuestions);
    }
    
    // Add tech stack questions
    const baseQuestions = [
      {
        id: 'q1_frontend',
        text: 'What frontend technology should we use?',
        choices: [
          'React + Next.js + Tailwind CSS',
          'Vue.js + Nuxt + Tailwind CSS',
          'Vanilla HTML/CSS/JS',
          'Svelte + SvelteKit',
          'Angular + Material',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q2_backend',
        text: 'What backend framework should we use?',
        choices: [
          'Node.js + Express',
          'Node.js + Fastify',
          'Python + FastAPI',
          'Python + Django',
          'Go + Gin',
          'Rust + Actix',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q3_database',
        text: 'What database should we use?',
        choices: [
          'PostgreSQL',
          'MongoDB',
          'MySQL',
          'SQLite',
          'Redis (cache)',
          'DynamoDB',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q4_auth',
        text: 'What authentication method should we use?',
        choices: [
          'JWT tokens',
          'OAuth 2.0 (Google, GitHub)',
          'Session-based auth',
          'Auth0/Supabase Auth',
          'No authentication needed',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q5_deployment',
        text: 'What is the target deployment platform?',
        choices: [
          'Vercel',
          'AWS (EC2, ECS, EKS)',
          'Docker containers',
          'Google Cloud Platform',
          'Azure',
          'DigitalOcean',
          'Traditional server',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q6_styling',
        text: 'Do you want a component library?',
        choices: [
          'Yes - shadcn/ui',
          'Yes - Material UI',
          'Yes - Ant Design',
          'Yes - Chakra UI',
          'Yes - Radix UI',
          'No - custom styling',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q7_testing',
        text: 'What testing framework should we use?',
        choices: [
          'Vitest + Playwright',
          'Jest + Cypress',
          'Playwright (E2E only)',
          'Testing Library',
          'No testing',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q8_api',
        text: 'What API architecture should we use?',
        choices: [
          'REST API',
          'GraphQL',
          'tRPC',
          'gRPC',
          'Mix of REST and GraphQL',
          'No API needed',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q9_state',
        text: 'What state management should we use?',
        choices: [
          'React Context',
          'Zustand',
          'Redux Toolkit',
          'Jotai',
          'No state management',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q10_cicd',
        text: 'Do you want CI/CD pipelines?',
        choices: [
          'Yes - GitHub Actions',
          'Yes - GitLab CI',
          'Yes - Jenkins',
          'Yes - CircleCI',
          'No CI/CD',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q11_hosting',
        text: 'How should the app be hosted?',
        choices: [
          'Serverless (Vercel, Netlify)',
          'Containerized (Docker, K8s)',
          'Virtual machine',
          'Traditional hosting',
          'User will specify',
          'End Phase 1',
        ],
      },
      {
        id: 'q12_realtime',
        text: 'Do you need real-time features?',
        choices: [
          'Yes - WebSockets',
          'Yes - Server-Sent Events',
          'Yes - Socket.io',
          'No real-time needed',
          'User will specify',
          'End Phase 1',
        ],
      },
    ];

    questions.push(...baseQuestions);
    
    // Add domain-specific questions based on detected project type
    const domainQuestions = this.generateDomainSpecificQuestions();
    questions.push(...domainQuestions);
    
    logger.info(`[Phase1] Total questions to ask: ${questions.length}`);
    return questions;
  }

  /**
   * Generate domain-specific questions based on project type
   * Adds targeted questions for AI/ML, E-commerce, SaaS, Mobile, and Enterprise projects
   */
  private generateDomainSpecificQuestions(): Array<{ id: string; text: string; choices: string[] }> {
    const promptLower = this.state.userPrompt.toLowerCase();
    const domainQuestions: Array<{ id: string; text: string; choices: string[] }> = [];

    // AI/ML project detection
    if (/ai|machine learning|llm|chatbot|gpt|openai|tensorflow|pytorch|nlp|computer vision/.test(promptLower)) {
      domainQuestions.push(
        {
          id: 'q_ai_model',
          text: 'Which AI/ML models will you need?',
          choices: [
            'OpenAI GPT models (GPT-4, GPT-4o)',
            'Open-source LLMs (Llama, Mistral, etc)',
            'Custom ML models (TensorFlow/PyTorch)',
            'Multi-modal (vision, audio, text)',
            'Will decide during development',
            'End Phase 1',
          ],
        },
        {
          id: 'q_ai_embedding',
          text: 'Do you need vector embeddings for RAG/semantic search?',
          choices: [
            'Yes - OpenAI embeddings',
            'Yes - Open-source (sentence-transformers, etc)',
            'Yes - pgvector with PostgreSQL',
            'Not needed',
            'Unsure - need guidance',
            'End Phase 1',
          ],
        },
        {
          id: 'q_ai_vector_db',
          text: 'What vector database do you need?',
          choices: [
            'pgvector (PostgreSQL extension)',
            'Pinecone',
            'Weaviate',
            'Qdrant',
            'ChromaDB',
            'Not needed',
            'End Phase 1',
          ],
        },
        {
          id: 'q_ai_agents',
          text: 'Do you need AI agent orchestration?',
          choices: [
            'Yes - simple chain/pipe agents',
            'Yes - complex multi-agent system',
            'Yes - code generation agents',
            'No agent orchestration needed',
            'Unsure - need guidance',
            'End Phase 1',
          ],
        }
      );
    }

    // E-commerce detection
    if (/ecommerce|e-commerce|shop|store|cart|checkout|payment|product.*catalog|marketplace/.test(promptLower)) {
      domainQuestions.push(
        {
          id: 'q_eco_payment',
          text: 'Which payment processors do you need?',
          choices: [
            'Stripe',
            'PayPal',
            'Square',
            'Multiple payment gateways',
            'Local payment methods',
            'Will decide later',
            'End Phase 1',
          ],
        },
        {
          id: 'q_eco_inventory',
          text: 'Do you need inventory management?',
          choices: [
            'Yes - real-time inventory tracking',
            'Yes - basic inventory count',
            'No - digital goods only',
            'No - third-party fulfillment',
            'End Phase 1',
          ],
        },
        {
          id: 'q_eco_shipping',
          text: 'What shipping integration is needed?',
          choices: [
            'ShipStation / Shippo',
            'Shippo / EasyPost',
            'Custom carrier integration',
            'Digital delivery only',
            'Local delivery only',
            'Not needed',
            'End Phase 1',
          ],
        },
        {
          id: 'q_eco_multi',
          text: 'Do you need multi-vendor / marketplace support?',
          choices: [
            'Yes - full marketplace',
            'Yes - multi-vendor with commission',
            'No - single store',
            'Unsure',
            'End Phase 1',
          ],
        }
      );
    }

    // SaaS / Subscription detection
    if (/saas|subscription|billing|multi.?tenant|tenant|plan|pricing/.test(promptLower)) {
      domainQuestions.push(
        {
          id: 'q_saas_billing',
          text: 'What billing model do you need?',
          choices: [
            'Monthly/Annual subscriptions',
            'Usage-based billing',
            'Tiered pricing plans',
            'One-time purchases',
            'Freemium with upgrades',
            'Will decide later',
            'End Phase 1',
          ],
        },
        {
          id: 'q_saas_multi',
          text: 'Do you need multi-tenant architecture?',
          choices: [
            'Yes - shared DB with tenant isolation',
            'Yes - separate DB per tenant',
            'Yes - hybrid approach',
            'No - single tenant for now',
            'Unsure - need guidance',
            'End Phase 1',
          ],
        },
        {
          id: 'q_saas_onboarding',
          text: 'Do you need user onboarding flows?',
          choices: [
            'Yes - guided onboarding wizard',
            'Yes - interactive tutorials',
            'Basic welcome flow only',
            'No onboarding needed',
            'End Phase 1',
          ],
        }
      );
    }

    // Mobile app detection
    if (/mobile|ios|android|react native|flutter|app|swiftui/.test(promptLower)) {
      domainQuestions.push(
        {
          id: 'q_mobile_platform',
          text: 'What mobile platforms do you target?',
          choices: [
            'iOS only',
            'Android only',
            'Both iOS and Android (native)',
            'Cross-platform (React Native)',
            'Cross-platform (Flutter)',
            'Progressive Web App (PWA)',
            'End Phase 1',
          ],
        },
        {
          id: 'q_mobile_push',
          text: 'Do you need push notifications?',
          choices: [
            'Yes - Firebase Cloud Messaging',
            'Yes - APNs + FCM',
            'Yes - OneSignal',
            'Not needed',
            'End Phase 1',
          ],
        },
        {
          id: 'q_mobile_offline',
          text: 'Do you need offline support?',
          choices: [
            'Yes - full offline with sync',
            'Yes - basic offline cache',
            'No - always online required',
            'End Phase 1',
          ],
        }
      );
    }

    // Enterprise / Internal Tool detection
    if (/enterprise|internal|admin|back.?office|dashboard|compliance|audit|enterprise/.test(promptLower)) {
      domainQuestions.push(
        {
          id: 'q_enterprise_sso',
          text: 'Do you need SSO / SAML / OIDC?',
          choices: [
            'Yes - SAML 2.0',
            'Yes - OIDC / OAuth 2.0',
            'Yes - both SAML and OIDC',
            'Yes - Google Workspace SSO',
            'No - email/password only',
            'End Phase 1',
          ],
        },
        {
          id: 'q_enterprise_rbac',
          text: 'What access control model do you need?',
          choices: [
            'RBAC (Role-Based)',
            'ABAC (Attribute-Based)',
            'ReBAC (Relationship-Based)',
            'Simple admin/user roles',
            'No access control needed',
            'End Phase 1',
          ],
        },
        {
          id: 'q_enterprise_audit',
          text: 'Do you need audit logging and compliance?',
          choices: [
            'Yes - full audit trail',
            'Yes - SOC 2 compliance',
            'Yes - GDPR compliance',
            'Basic activity logging',
            'No audit needed',
            'End Phase 1',
          ],
        },
        {
          id: 'q_enterprise_reporting',
          text: 'Do you need reporting and analytics?',
          choices: [
            'Yes - custom reports',
            'Yes - dashboards with charts',
            'Yes - scheduled exports (CSV/PDF)',
            'Basic analytics only',
            'Not needed',
            'End Phase 1',
          ],
        }
      );
    }

    return domainQuestions;
  }

  private async askUserQuestionAuto(question: { id: string; text: string; choices: string[] }): Promise<string> {
    const prompt = `Based on the user's request: "${this.state.userPrompt}"
    
Research context: ${this.state.researchContext.substring(0, 500)}

Question: ${question.text}
Choices: ${question.choices.join(', ')}

Pick the MOST APPROPRIATE choice. Respond with ONLY the choice text, nothing else.`;
    
    try {
      const result = await generateText({
        model: openrouter('anthropic/claude-3-5-haiku'),
        prompt,
        maxOutputTokens: 100,
      });
      
      const answer = result.text.trim();
      
      if (question.choices.includes(answer)) {
        return answer;
      }
      
      return question.choices[0] ?? 'User will specify';
      
    } catch (error) {
      logger.warn(`[Phase1] Question failed, using default: ${error}`);
      return question.choices[0] ?? 'User will specify';
    }
  }

  private async askUserQuestionWithChoices(question: { id: string; text: string; choices: string[] }): Promise<string> {
    logger.info(`[Phase1] Interactive Q: ${question.text}`);

    // Display question and choices to the user on the terminal
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║        Phase 1 — Requirements Questionnaire     ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Q: ${question.text}`);
    console.log('');

    for (let i = 0; i < question.choices.length; i++) {
      const choice = question.choices[i] ?? '';
      const prefix = choice === 'End Phase 1' ? ' 0.' : ` ${i + 1}.`;
      console.log(`${prefix} ${choice}`);
    }

    console.log('');
    console.log('Enter the number of your choice (or press Enter for auto-select):');

    try {
      const rl = readline.createInterface({
        input: processStdin,
        output: processStdout,
      });

      const answer = await rl.question('> ');
      rl.close();

      const trimmed = answer.trim();

      if (trimmed === '0' && question.choices.includes('End Phase 1')) {
        logger.info('[Phase1] User chose to end phase 1 early');
        return 'End Phase 1';
      }

      if (trimmed === '') {
        logger.info('[Phase1] No input — auto-selecting answer');
        return this.askUserQuestionAuto(question);
      }

      const numIndex = parseInt(trimmed, 10);
      if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= question.choices.length) {
        const selected = question.choices[numIndex - 1] ?? question.choices[0] ?? 'User will specify';
        logger.info(`[Phase1] User selected: ${selected}`);
        return selected;
      }

      // Check if the user typed the choice text directly
      const directMatch = question.choices.find(
        c => c.toLowerCase() === trimmed.toLowerCase()
      );
      if (directMatch) {
        logger.info(`[Phase1] User typed: ${directMatch}`);
        return directMatch;
      }

      // Invalid input — auto-select
      logger.warn(`[Phase1] Invalid input "${trimmed}" — auto-selecting`);
      return this.askUserQuestionAuto(question);
    } catch (error) {
      logger.warn(`[Phase1] Interactive read failed: ${error} — auto-selecting`);
      return this.askUserQuestionAuto(question);
    }
  }

  // ---------------------------------------------------------------------------
  // Mem0 Memory Integration
  // ---------------------------------------------------------------------------

  /**
   * Load previous Phase 1 Q&A answers from Mem0 to personalize this session
   */
  private async loadPhase1Memory(): Promise<Mem0Memory | null> {
    if (!this.mem0Client) {
      logger.debug('[Phase1] Mem0 not available, skipping memory load');
      return null;
    }

    try {
      const memory = await interPhaseRetrieve('phase-1', this.mem0Client);
      if (memory) {
        this.mem0Loaded = true;
        logger.info('[Phase1] [OK] Restored preferences from previous session');

        // Parse stored answers and inject into state for better auto-selection
        try {
          const stored = JSON.parse(memory.content);
          if (stored.qaAnswers && typeof stored.qaAnswers === 'object') {
            for (const [key, value] of Object.entries(stored.qaAnswers)) {
              if (!this.state.qaAnswers.has(key)) {
                this.state.qaAnswers.set(key, String(value));
              }
            }
            logger.info(`[Phase1] Injected ${Object.keys(stored.qaAnswers).length} previous answers`);
          }
          if (stored.userPrompt) {
            logger.debug(`[Phase1] Previous prompt: ${stored.userPrompt.substring(0, 100)}`);
          }
        } catch {
          logger.debug('[Phase1] Could not parse stored memory content');
        }

        return memory;
      }
      logger.info('[Phase1] No previous memory found — first session');
      return null;
    } catch (error) {
      logger.warn(`[Phase1] Failed to load memory: ${error}`);
      return null;
    }
  }

  /**
   * Save Phase 1 Q&A answers to Mem0 for future sessions
   */
  private async savePhase1Memory(): Promise<void> {
    if (!this.mem0Client) {
      logger.debug('[Phase1] Mem0 not available, skipping memory save');
      return;
    }

    try {
      const memoryData = {
        userPrompt: this.state.userPrompt,
        qaAnswers: Object.fromEntries(this.state.qaAnswers),
        contextBudget: this.state.contextBudget,
        isNewProject: this.state.isNewProject,
        timestamp: new Date().toISOString(),
      };

      await interPhaseStore('phase-1', memoryData, this.mem0Client);
      logger.info(`[Phase1] [OK] Saved ${this.state.qaAnswers.size} Q&A answers to Mem0`);
    } catch (error) {
      logger.warn(`[Phase1] Failed to save memory: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4: Context Budget Calculation
  // ---------------------------------------------------------------------------
  
  private async calculateContextBudget(): Promise<void> {
    logger.info('[Phase1] Calculating context budget allocation...');
    
    // Allocate 200k tokens across phases with 10% buffer
    const totalTokens = this.state.totalContext;
    const bufferPercent = 0.10;
    const usableTokens = Math.floor(totalTokens * (1 - bufferPercent));
    
    // Phase allocation (based on complexity)
    this.state.contextBudget = {
      'phase-1-planning': Math.floor(usableTokens * 0.10),  // 10%
      'phase-2-wireframes': Math.floor(usableTokens * 0.15), // 15%
      'phase-3-development': Math.floor(usableTokens * 0.40), // 40% (most complex)
      'phase-4-security': Math.floor(usableTokens * 0.15),   // 15%
      'phase-5-deployment': Math.floor(usableTokens * 0.10), // 10%
      'phase-6-documentation': Math.floor(usableTokens * 0.10), // 10%
      'buffer': Math.floor(totalTokens * bufferPercent),     // 10% buffer
    };
    
    logger.info('[Phase1] Context budget allocated:');
    Object.entries(this.state.contextBudget).forEach(([phase, tokens]) => {
      logger.info(`[Phase1]   ${phase}: ${tokens.toLocaleString()} tokens`);
    });
  }
  
  // ---------------------------------------------------------------------------
  // Step 5: Generate All Planning Files
  // ---------------------------------------------------------------------------
  
  private async generateAllFiles(): Promise<void> {
    logger.info(`[Phase1] Generating ${FILES_TO_GENERATE.length} planning documents...`);
    
    let generatedCount = 0;
    
    for (const filename of FILES_TO_GENERATE) {
      try {
        logger.info(`[Phase1] Generating ${filename}... (${generatedCount + 1}/${FILES_TO_GENERATE.length})`);
        
        const content = await this.generateFileContent(filename);
        const filePath = path.join(this.outputDir, filename);
        
        // Write file
        await fs.writeFile(filePath, content, 'utf-8');
        
        this.state.generatedFiles.set(filename, content);
        generatedCount++;
        
        logger.info(`[Phase1] [OK] Generated ${filename} (${content.length} chars)`);
        
      } catch (error) {
        logger.error(`[Phase1] Failed to generate ${filename}: ${error}`);
        throw error;
      }
    }
    
    logger.info(`[Phase1] All ${generatedCount} files generated successfully`);

    // Validate generated documents
    logger.info('[Phase1] Validating generated documents...');
    const validationResults = new Map<string, ReturnType<typeof validateDocument>>();
    for (const [filename, content] of this.state.generatedFiles) {
      validationResults.set(filename, validateDocument(filename, content));
    }
    logValidationResults(validationResults);
    const summary = getValidationSummary(validationResults);
    logger.info(`[Phase1] Validation: ${summary.validDocuments}/${summary.totalDocuments} documents valid (avg score: ${summary.averageScore.toFixed(1)}%)`);
  }
  
  private async generateFileContent(filename: string): Promise<string> {
    let basePrompt = this.buildFilePrompt(filename);
    
    // For agent-skills.md, inject real vercel-labs agent skills
    if (filename === 'agent-skills.md') {
      try {
        const skillsContent = await buildAgentSkillsBridge(this.state.userPrompt, this.state.qaAnswers);
        if (skillsContent) {
          basePrompt += `\n\n## Real Vercel Agent Skills (fetched from vercel-labs/agent-skills)\n\n${skillsContent}\n\nIncorporate these skills into the document above.`;
        }
      } catch (err) {
        logger.warn(`[Phase1] Vercel skills fetch failed (non-blocking): ${err}`);
      }
    }
    
    const result = await generateText({
      model: openrouter(this.config.model),
      system: `You are generating ${filename} for a software project planning document.
      
Write in clear, professional markdown format.
Be thorough and specific.
Include all relevant technical details.
Format with proper headings, lists, and code blocks.`,
      prompt: basePrompt,
      maxOutputTokens: 4096,
    });
    
    return result.text;
  }
  
  private buildFilePrompt(filename: string): string {
    const baseContext = `
User Request: "${this.state.userPrompt}"

Research Context: ${this.state.researchContext}

Existing Codebase: ${this.state.existingCodebaseSummary}

Q&A Answers:
${Array.from(this.state.qaAnswers.entries())
  .map(([q, a]) => `- ${q}: ${a}`)
  .join('\n')}

Context Budget: ${JSON.stringify(this.state.contextBudget, null, 2)}
`;
    
    // File-specific prompts
    const prompts: Record<string, string> = {
      'plan.md': `${baseContext}

Generate a comprehensive PROJECT PLAN including:
1. Executive Summary
2. Project Overview
3. Goals and Objectives
4. Scope (In-scope and Out-of-scope)
5. Technology Stack (Frontend, Backend, Database, etc.)
6. Architecture Overview
7. Development Phases
8. Timeline Estimates
9. Success Metrics
10. Risks and Mitigations`,

      'tasks.md': `${baseContext}

Generate a detailed TASK BREAKDOWN including:
1. All tasks needed to complete the project
2. Organized by phase (Phase 1-6)
3. Dependencies between tasks
4. Estimated effort for each task
5. Priority levels (Critical, High, Medium, Low)
6. Assigned to which sub-agent (if Phase 3)

Format as a task list with checkboxes.`,

      'user-stories.md': `${baseContext}

Generate USER STORIES in standard format:
- As a [user type], I want [goal] so that [benefit]
- Include acceptance criteria for each story
- Organize by feature area
- Include at least 10-15 stories
- Cover happy paths and edge cases`,

      'context-management.md': `${baseContext}

Generate a CONTEXT MANAGEMENT PLAN including:
1. Phase-by-phase context budgets and handoff files
2. What information must be persisted between phases
3. What information can be summarized or discarded
4. Token-budget guardrails for long sessions
5. Memory strategy for user preferences, project constraints, and design decisions
6. Recovery process if a phase runs out of context
7. Required handoff artifacts for each phase`,

      'design.md': `${baseContext}

Generate a DESIGN SPECIFICATION including:
1. UI/UX Design Principles
2. Color Scheme and Typography
3. Component Hierarchy
4. Wireframe Descriptions
5. Responsive Design Approach
6. Accessibility Requirements (WCAG 2.1)
7. Animation and Interaction Patterns`,

      'API_reference.md': `${baseContext}

Generate an API REFERENCE including:
1. Base URL and versioning
2. Authentication method
3. All endpoints (GET, POST, PUT, DELETE)
4. Request/Response formats (JSON schemas)
5. Status codes and error handling
6. Rate limiting
7. Example requests and responses`,

      'Database_schema.md': `${baseContext}

Generate a DATABASE SCHEMA including:
1. All tables/collections
2. Columns/fields with types
3. Primary keys and indexes
4. Foreign key relationships
5. Constraints (unique, not null, etc.)
6. Sample data examples
7. Migration strategy`,

      'prd.md': `${baseContext}

Generate a PRODUCT REQUIREMENTS DOCUMENT including:
1. Problem Statement
2. Target Users
3. User Needs and Pain Points
4. Proposed Solution
5. Feature Requirements (Must-have, Should-have, Nice-to-have)
6. Non-Functional Requirements
7. Success Metrics`,

      'technical-spec.md': `${baseContext}

Generate a TECHNICAL SPECIFICATION including:
1. System Architecture Diagram (describe)
2. Technology Stack Details
3. Data Flow
4. Security Considerations
5. Performance Requirements
6. Scalability Plan
7. Third-Party Integrations`,

      'agent-skills.md': `${baseContext}

Generate AGENT SKILLS identification including:
1. Vercel agent skills that apply to this project
2. Custom skills needed
3. MCP servers to use
4. Tool requirements
5. Integration points`,

      'risk-assessment.md': `${baseContext}

Generate a RISK ASSESSMENT including:
1. Technical Risks (and mitigations)
2. Security Risks (and mitigations)
3. Performance Risks (and mitigations)
4. Timeline Risks (and mitigations)
5. Resource Risks (and mitigations)
6. Dependency Risks (and mitigations)`,

      'competitive-analysis.md': `${baseContext}

Generate a COMPETITIVE ANALYSIS including:
1. Similar Products/Services (at least 3-5)
2. Feature Comparison Table
3. Strengths and Weaknesses
4. Differentiation Opportunities
5. Market Gaps`,

      'constraints-and-tradeoffs.md': `${baseContext}

Generate CONSTRAINTS AND TRADEOFFS including:
1. Technical Constraints
2. Budget Constraints
3. Timeline Constraints
4. Resource Constraints
5. Design Tradeoffs Made
6. Technology Tradeoffs Made
7. Rationale for Each Decision`,

      'phase-1.md': `${baseContext}

Generated Files:
${Array.from(this.state.generatedFiles.keys()).join('\n')}

Generate a PHASE 1 SUMMARY including:
1. Overview of Phase 1 Work
2. Key Decisions Made
3. Summary of Each Planning Document
4. Next Steps (Phase 2)
5. Handoff Notes for Implementation Team`,
    };
    
    return prompts[filename] || `${baseContext}\n\nGenerate content for ${filename}.`;
  }
  
  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------
  
  private async createOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      logger.info(`[Phase1] Created output directory: ${this.outputDir}`);
    } catch (error) {
      logger.error(`[Phase1] Failed to create output directory: ${error}`);
      throw error;
    }
  }
}
