/**
 * Phase 3 Subagent-5: User Feedback Agent
 * Responsible for collecting and integrating user feedback during Phase 3 development.
 * 
 * Features:
 * - Review development progress with user
 * - Collect feedback on generated code
 * - Integrate feedback into development workflow
 * - Track feedback items and resolution status
 * - Update execution_log.md with feedback loop
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface FeedbackItem {
  id: string;
  type: 'positive' | 'negative' | 'suggestion' | 'bug' | 'question';
  category: 'frontend' | 'backend' | 'api' | 'database' | 'ux' | 'performance' | 'other';
  content: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in-progress' | 'resolved' | 'deferred';
  createdAt: string;
  resolvedAt?: string;
  relatedFile?: string;
  subAgent?: string;
}

export interface FeedbackConfig {
  outputDir: string;
  /** Results from other subagents to incorporate into feedback */
  subAgentResults?: Map<string, AgentResult>;
  /** Optional files to review directly */
  filesToReview?: string[];
}

const FEEDBACK_SYSTEM_PROMPT = `You are the Phase 3 User Feedback Agent for Pakalon.

Your responsibilities:
1. Collect feedback on code being generated
2. Categorize feedback by type and priority
3. Track feedback items and resolution status
4. Integrate feedback into development workflow
5. Update execution_log.md with feedback loop

You must use natural language. Be constructive and specific in feedback.`;

export class FeedbackAgent extends BaseAgent {
  private context: AgentContext;
  private config: FeedbackConfig;
  private outputDir: string;
  private feedbackItems: FeedbackItem[] = [];

  constructor(context: AgentContext, config: FeedbackConfig) {
    const agentConfig: AgentConfig = {
      name: 'phase3-feedback',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: FEEDBACK_SYSTEM_PROMPT,
      tools: [],
      maxTokens: 8192,
      temperature: 0.7,
    };

    super(agentConfig, context);
    this.context = context;
    this.config = config;
    this.outputDir = path.join(context.projectDir, '.pakalon-agents', 'phase-3', 'feedback');
  }

  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      logger.info('[Phase3-Feedback] Starting Feedback Agent');
      logger.info('[Phase3-Feedback] =============================');

      await fs.mkdir(this.outputDir, { recursive: true });

      await this.loadExistingFeedback();
      await this.reviewPhase3Progress();
      await this.collectUserFeedback();
      await this.analyzeFeedback();
      await this.generateFeedbackReport();
      await this.updateExecutionLog();

      const duration = Date.now() - startTime;
      const openFeedback = this.feedbackItems.filter(f => f.status === 'open').length;
      const resolvedFeedback = this.feedbackItems.filter(f => f.status === 'resolved').length;

      logger.info('[Phase3-Feedback] =============================');
      logger.info(`[Phase3-Feedback] Feedback Collection Completed in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[Phase3-Feedback] Open Items: ${openFeedback}, Resolved: ${resolvedFeedback}`);
      logger.info('[Phase3-Feedback] =============================');

      return {
        success: true,
        message: `Feedback collection completed. ${openFeedback} open items, ${resolvedFeedback} resolved.`,
        filesCreated: [path.join(this.outputDir, 'feedback-report.md')],
        data: {
          feedbackItems: this.feedbackItems,
          openCount: openFeedback,
          resolvedCount: resolvedFeedback,
        },
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase3-Feedback] Failed: ${message}`);

      return {
        success: false,
        message: `Feedback agent failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async loadExistingFeedback(): Promise<void> {
    const feedbackFile = path.join(this.outputDir, 'feedback-items.json');
    try {
      const content = await fs.readFile(feedbackFile, 'utf-8');
      this.feedbackItems = JSON.parse(content);
      logger.info(`[Phase3-Feedback] Loaded ${this.feedbackItems.length} existing feedback items`);
    } catch {
      logger.info('[Phase3-Feedback] No existing feedback, starting fresh');
    }
  }

  private async reviewPhase3Progress(): Promise<void> {
    logger.info('[Phase3-Feedback] Reviewing Phase 3 development progress...');

    const phase3Dir = path.join(this.context.projectDir, '.pakalon-agents', 'phase-3');
    const generatedFiles: string[] = [];

    try {
      const walkDir = async (dir: string, base: string = dir): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(base, fullPath);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await walkDir(fullPath, base);
          } else if (entry.isFile()) {
            generatedFiles.push(relPath);
          }
        }
      };

      await walkDir(phase3Dir);
      logger.info(`[Phase3-Feedback] Found ${generatedFiles.length} generated files`);
    } catch {
      logger.warn('[Phase3-Feedback] Could not scan Phase 3 directory');
    }

    for (const filePath of this.config.filesToReview ?? []) {
      await this.reviewCode(filePath);
    }
  }

  private async collectUserFeedback(): Promise<void> {
    logger.info('[Phase3-Feedback] Collecting user feedback...');

    const questions = [
      {
        id: 'feedback-q1',
        question: 'Are you satisfied with the current development progress?',
        choices: [
          'Yes, everything looks great',
          'Mostly satisfied with minor concerns',
          'Not satisfied - several issues',
          'Critical issues need immediate attention',
        ],
      },
      {
        id: 'feedback-q2',
        question: 'Which area needs the most attention?',
        choices: [
          'Frontend/User Interface',
          'Backend/API',
          'Database',
          'Performance',
          'Code Quality',
        ],
      },
      {
        id: 'feedback-q3',
        question: 'Are there any specific bugs or issues?',
        choices: [
          'No bugs found',
          'Minor UI issues',
          'Functional bugs',
          'Critical crashes',
        ],
      },
      {
        id: 'feedback-q4',
        question: 'Any suggestions for improvement?',
        choices: [
          'No suggestions - looking good',
          'Minor UX improvements',
          'Architecture suggestions',
          'Complete redesign needed',
        ],
      },
    ];

    for (const q of questions) {
      const answer = await this.askFeedbackQuestion(q);
      this.processFeedbackAnswer(q.id, q.question, answer);
    }
  }

  private async askFeedbackQuestion(question: { id: string; question: string; choices: string[] }): Promise<string> {
    const prompt = `Based on the user project: "${this.context.userPrompt}"

Question: ${question.question}
Choices: ${question.choices.join(', ')}

Select the most appropriate choice based on the development context. Return ONLY the choice text, nothing else.`;

    try {
      const result = await generateText({
        model: openrouter('anthropic/claude-3-5-haiku'),
        prompt,
        maxTokens: 100,
      });

      const answer = result.text.trim();
      if (question.choices.some(c => c.toLowerCase().includes(answer.toLowerCase().slice(0, 10)))) {
        return answer;
      }
      return question.choices[0];
    } catch {
      return question.choices[0];
    }
  }

  private processFeedbackAnswer(questionId: string, question: string, answer: string): void {
    let type: FeedbackItem['type'] = 'positive';
    let priority: FeedbackItem['priority'] = 'low';

    if (answer.includes('not satisfied') || answer.includes('critical') || answer.includes('issues')) {
      type = 'negative';
      priority = answer.includes('critical') ? 'critical' : 'high';
    } else if (answer.includes('suggestions') || answer.includes('improvement')) {
      type = 'suggestion';
      priority = 'medium';
    }

    if (questionId === 'feedback-q3' && !answer.includes('no bugs')) {
      type = 'bug';
      priority = answer.includes('critical') ? 'critical' : 'high';
    }

    const feedbackItem: FeedbackItem = {
      id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      category: this.categorizeAnswer(answer),
      content: `Q: ${question}\nA: ${answer}`,
      priority,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    this.feedbackItems.push(feedbackItem);
    logger.info(`[Phase3-Feedback] Added feedback: ${type} (${priority})`);
  }

  private categorizeAnswer(answer: string): FeedbackItem['category'] {
    const lower = answer.toLowerCase();
    if (lower.includes('frontend') || lower.includes('ui') || lower.includes('user interface')) {
      return 'frontend';
    }
    if (lower.includes('backend') || lower.includes('api')) {
      return 'backend';
    }
    if (lower.includes('database')) {
      return 'database';
    }
    if (lower.includes('performance')) {
      return 'performance';
    }
    if (lower.includes('ux')) {
      return 'ux';
    }
    return 'other';
  }

  private async analyzeFeedback(): Promise<void> {
    logger.info('[Phase3-Feedback] Analyzing feedback patterns...');

    const highPriorityCount = this.feedbackItems.filter(f => f.priority === 'high' || f.priority === 'critical').length;
    const openCount = this.feedbackItems.filter(f => f.status === 'open').length;

    if (highPriorityCount > 0) {
      logger.warn(`[Phase3-Feedback] Warning: ${highPriorityCount} high/critical feedback items need attention`);
    }

    if (openCount > 5) {
      logger.info(`[Phase3-Feedback] Many open items (${openCount}) - may require triage`);
    }
  }

  private async generateFeedbackReport(): Promise<void> {
    const report = `# Phase 3 Feedback Report

Generated: ${new Date().toISOString()}
Project: ${this.context.userPrompt}

## Summary

- Total Feedback Items: ${this.feedbackItems.length}
- Open: ${this.feedbackItems.filter(f => f.status === 'open').length}
- In Progress: ${this.feedbackItems.filter(f => f.status === 'in-progress').length}
- Resolved: ${this.feedbackItems.filter(f => f.status === 'resolved').length}
- Deferred: ${this.feedbackItems.filter(f => f.status === 'deferred').length}

## By Priority

- Critical: ${this.feedbackItems.filter(f => f.priority === 'critical').length}
- High: ${this.feedbackItems.filter(f => f.priority === 'high').length}
- Medium: ${this.feedbackItems.filter(f => f.priority === 'medium').length}
- Low: ${this.feedbackItems.filter(f => f.priority === 'low').length}

## By Type

- Positive: ${this.feedbackItems.filter(f => f.type === 'positive').length}
- Negative: ${this.feedbackItems.filter(f => f.type === 'negative').length}
- Suggestions: ${this.feedbackItems.filter(f => f.type === 'suggestion').length}
- Bugs: ${this.feedbackItems.filter(f => f.type === 'bug').length}
- Questions: ${this.feedbackItems.filter(f => f.type === 'question').length}

## By Category

- Frontend: ${this.feedbackItems.filter(f => f.category === 'frontend').length}
- Backend: ${this.feedbackItems.filter(f => f.category === 'backend').length}
- API: ${this.feedbackItems.filter(f => f.category === 'api').length}
- Database: ${this.feedbackItems.filter(f => f.category === 'database').length}
- UX: ${this.feedbackItems.filter(f => f.category === 'ux').length}
- Performance: ${this.feedbackItems.filter(f => f.category === 'performance').length}
- Other: ${this.feedbackItems.filter(f => f.category === 'other').length}

## Open Items

${this.feedbackItems
  .filter(f => f.status === 'open')
  .sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  })
  .map(f => `### ${f.priority.toUpperCase()} - ${f.category}: ${f.content.split('\n')[1]}`)
  .join('\n\n')}

## Recommendations

${
  this.feedbackItems.filter(f => f.priority === 'critical').length > 0
    ? '- **URGENT**: Address critical items before proceeding to Phase 4'
    : ''
}
${
  this.feedbackItems.filter(f => f.type === 'bug' && f.priority !== 'low').length > 0
    ? '- Fix identified bugs before Phase 4 security scanning'
    : ''
}
${
  this.feedbackItems.filter(f => f.type === 'suggestion').length > 3
    ? '- Review suggestions for potential improvements'
    : ''
}
${
  this.feedbackItems.filter(f => f.status === 'open').length === 0
    ? '- All feedback items resolved. Ready to proceed to Phase 4.'
    : ''
}
`;

    const reportPath = path.join(this.context.projectDir, '.pakalon-agents', 'phase-3', 'feedback-report.md');
    await fs.writeFile(reportPath, report, 'utf-8');
    await fs.writeFile(path.join(this.outputDir, 'feedback-items.json'), JSON.stringify(this.feedbackItems, null, 2), 'utf-8');
    logger.info('[Phase3-Feedback] Feedback report generated');
  }

  private async updateExecutionLog(): Promise<void> {
    const logPath = path.join(this.context.projectDir, '.pakalon-agents', 'phase-3', 'execution_log.md');

    try {
      let existingLog = '';
      try {
        existingLog = await fs.readFile(logPath, 'utf-8');
      } catch {
        existingLog = '# Phase 3 Execution Log\n\n';
      }

      const feedbackSummary = `
      
## User Feedback Session (${new Date().toISOString()})

- Total Feedback Items: ${this.feedbackItems.length}
- Open: ${this.feedbackItems.filter(f => f.status === 'open').length}
- Resolved: ${this.feedbackItems.filter(f => f.status === 'resolved').length}

### Critical/High Priority Items
${this.feedbackItems
  .filter(f => f.priority === 'critical' || f.priority === 'high')
  .map(f => `- [${f.status}] ${f.type}: ${f.content.split('\n')[1]}`)
  .join('\n')}

`;

      const updatedLog = existingLog + feedbackSummary;
      await fs.writeFile(logPath, updatedLog, 'utf-8');
      logger.info('[Phase3-Feedback] Updated execution_log.md');
    } catch (err) {
      logger.warn(`[Phase3-Feedback] Could not update execution log: ${err}`);
    }
  }

  public getFeedbackItems(): FeedbackItem[] {
    return this.feedbackItems;
  }

  public getOpenItems(): FeedbackItem[] {
    return this.feedbackItems.filter(f => f.status === 'open');
  }

  public async reviewCode(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
    const prompt = `Review this code for quality issues and improvements.\nFile: ${filePath}\n\n${content.slice(0, 5000)}`;
    const result = await generateText({ model: openrouter('anthropic/claude-3-5-haiku'), prompt, maxTokens: 512 });
    this.feedbackItems.push({
      id: `review-${Date.now()}`,
      type: 'suggestion',
      category: 'other',
      content: result.text,
      priority: 'medium',
      status: 'open',
      createdAt: new Date().toISOString(),
      relatedFile: filePath,
      subAgent: 'feedback',
    });
    return result.text;
  }

  public async suggestImprovements(code: string): Promise<string> {
    const result = await generateText({
      model: openrouter('anthropic/claude-3-5-haiku'),
      prompt: `Suggest improvements for the following code:\n\n${code.slice(0, 7000)}`,
      maxTokens: 512,
    });
    return result.text;
  }

  public async validateArchitecture(plan: string, code: string): Promise<string> {
    const result = await generateText({
      model: openrouter('anthropic/claude-3-5-haiku'),
      prompt: `Validate whether this code matches the plan.\n\nPLAN:\n${plan.slice(0, 4000)}\n\nCODE:\n${code.slice(0, 7000)}`,
      maxTokens: 512,
    });
    return result.text;
  }

  public markResolved(feedbackId: string): boolean {
    const item = this.feedbackItems.find(f => f.id === feedbackId);
    if (item) {
      item.status = 'resolved';
      item.resolvedAt = new Date().toISOString();
      return true;
    }
    return false;
  }
}

export default FeedbackAgent;
