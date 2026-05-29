import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '@/utils/logger.js';

export interface Suggestion {
  id: string;
  type: 'completion' | 'correction' | 'tip' | 'warning';
  text: string;
  context?: string;
  confidence: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface SuggestionContext {
  command?: string;
  currentInput?: string;
  cursorPosition?: number;
  mode?: string;
  recentCommands?: string[];
}

const SUGGESTIONS_DIR = path.join(os.homedir(), '.pakalon', 'suggestions');

let suggestionsCache: Suggestion[] = [];

function ensureSuggestionsDir(): void {
  if (!fs.existsSync(SUGGESTIONS_DIR)) {
    fs.mkdirSync(SUGGESTIONS_DIR, { recursive: true });
  }
}

export function generateSuggestions(context: SuggestionContext): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (context.mode === 'plan') {
    suggestions.push({
      id: 'exit-plan-mode',
      type: 'tip',
      text: 'Type /edit to exit plan mode',
      context: 'plan-mode-hint',
      confidence: 0.9,
      source: 'mode-hint',
    });
  }

  if (context.currentInput?.startsWith('/')) {
    const commands = [
      { name: 'edit', description: 'Exit plan mode' },
      { name: 'plan', description: 'Enter plan mode' },
      { name: 'compact', description: 'Compact context' },
      { name: 'resume', description: 'Resume session' },
      { name: 'help', description: 'Show help' },
    ];

    const partial = context.currentInput.slice(1);
    const matches = commands.filter((c) => c.name.startsWith(partial.toLowerCase()));

    for (const cmd of matches) {
      suggestions.push({
        id: `cmd-${cmd.name}`,
        type: 'completion',
        text: `/${cmd.name} - ${cmd.description}`,
        context: 'slash-command',
        confidence: 0.8,
        source: 'commands',
      });
    }
  }

  if (context.recentCommands && context.recentCommands.length > 0) {
    const last = context.recentCommands[context.recentCommands.length - 1];

    if (last && context.currentInput === last.slice(0, context.currentInput.length)) {
      suggestions.push({
        id: 'repeat-command',
        type: 'completion',
        text: last,
        context: 'recent-command',
        confidence: 0.7,
        source: 'history',
      });
    }
  }

  suggestionsCache = suggestions;
  return suggestions;
}

export function getSuggestions(context: SuggestionContext): Suggestion[] {
  return generateSuggestions(context);
}

export function dismissSuggestion(id: string): void {
  suggestionsCache = suggestionsCache.filter((s) => s.id !== id);
}

export function acceptSuggestion(id: string): Suggestion | null {
  const suggestion = suggestionsCache.find((s) => s.id === id);

  if (suggestion) {
    dismissSuggestion(id);
  }

  return suggestion || null;
}

export async function loadSuggestionHistory(): Promise<Suggestion[]> {
  const historyFile = path.join(SUGGESTIONS_DIR, 'history.json');

  if (!fs.existsSync(historyFile)) {
    return [];
  }

  try {
    const content = await fs.promises.readFile(historyFile, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    logger.warn('Failed to load suggestion history:', err);
    return [];
  }
}

export async function saveSuggestionHistory(suggestions: Suggestion[]): Promise<void> {
  ensureSuggestionsDir();

  const historyFile = path.join(SUGGESTIONS_DIR, 'history.json');

  try {
    await fs.promises.writeFile(historyFile, JSON.stringify(suggestions, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save suggestion history:', err);
  }
}

export function recordSuggestionFeedback(
  id: string,
  feedback: 'accepted' | 'dismissed' | 'ignored'
): void {
  loadSuggestionHistory().then((history) => {
    history.push({
      id,
      type: 'tip',
      text: id,
      confidence: feedback === 'accepted' ? 1 : feedback === 'dismissed' ? 0.5 : 0,
      source: 'feedback',
      metadata: { feedback, timestamp: Date.now() },
    } as Suggestion);

    const recent = history.slice(-100);
    saveSuggestionHistory(recent);
  });
}

const getSuggestionsTool = tool({
  description: 'Get AI-powered suggestions based on current context',
  inputSchema: z.object({
    command: z.string().optional().describe('Current command being typed'),
    currentInput: z.string().optional().describe('Current input text'),
    cursorPosition: z.number().optional().describe('Cursor position'),
    mode: z.string().optional().describe('Current mode (normal, plan, etc.)'),
  }),
  execute: async ({ arguments: args }) => {
    const context: SuggestionContext = {
      command: args.command,
      currentInput: args.currentInput,
      cursorPosition: args.cursorPosition,
      mode: args.mode,
    };

    const suggestions = getSuggestions(context);

    return {
      success: true,
      suggestions: suggestions.map((s) => ({
        id: s.id,
        type: s.type,
        text: s.text,
        confidence: s.confidence,
      })),
      count: suggestions.length,
    };
  },
});

const acceptSuggestionTool = tool({
  description: 'Accept a suggestion by ID',
  inputSchema: z.object({
    id: z.string().describe('ID of the suggestion to accept'),
  }),
  execute: async ({ arguments: args }) => {
    const suggestion = acceptSuggestion(args.id);

    if (suggestion) {
      recordSuggestionFeedback(args.id, 'accepted');
      return {
        success: true,
        text: suggestion.text,
        message: `Accepted suggestion: ${suggestion.text}`,
      };
    }

    return {
      success: false,
      error: `Suggestion not found: ${args.id}`,
    };
  },
});

export function getAllSuggestionTools() {
  return {
    get_suggestions: getSuggestionsTool,
    accept_suggestion: acceptSuggestionTool,
  };
}

export { getSuggestionsTool, acceptSuggestionTool };