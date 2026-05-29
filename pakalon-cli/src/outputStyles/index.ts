/**
 * Output Styles - Custom Output Formatting
 *
 * Allows users to customize how the AI's output is formatted and presented.
 * Output styles are defined as markdown files with frontmatter configuration.
 *
 * Structure:
 * - Project .pakalon/output-styles/*.md -> project styles
 * - User ~/.pakalon/output-styles/*.md -> user styles
 * - Built-in styles (minimal, verbose, etc.)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

export interface OutputStyleConfig {
  name: string;
  description: string;
  prompt: string;
  source: 'project' | 'user' | 'builtin';
  keepCodingInstructions?: boolean;
  frontmatter?: Record<string, unknown>;
}

export interface OutputStyleRenderOptions {
  content: string;
  style: OutputStyleConfig;
  includeHeader?: boolean;
  includeFooter?: boolean;
}

interface MarkdownFrontmatter {
  name?: string;
  description?: string;
  keepCodingInstructions?: boolean;
  [key: string]: unknown;
}

const DEFAULT_OUTPUT_STYLES_DIR = '.pakalon/output-styles';
const USER_OUTPUT_STYLES_DIR = '.pakalon/output-styles';

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: MarkdownFrontmatter; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterStr, body] = frontmatterMatch;
  const frontmatter: MarkdownFrontmatter = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse boolean values
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Parse numeric values
    else if (!isNaN(Number(value)) && value !== '') value = Number(value);

    frontmatter[key] = value;
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Load output styles from a directory
 */
async function loadStylesFromDir(dirPath: string): Promise<OutputStyleConfig[]> {
  const styles: OutputStyleConfig[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const filePath = path.join(dirPath, entry.name);
      const styleName = entry.name.replace(/\.md$/, '');

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        const name = (frontmatter.name || styleName) as string;
        const description = (frontmatter.description ||
          extractDescription(body, `Custom ${styleName} output style`)) as string;

        styles.push({
          name,
          description,
          prompt: body,
          source: dirPath.includes('.pakalon') ? 'project' : 'user',
          keepCodingInstructions: frontmatter.keepCodingInstructions,
          frontmatter,
        });

        logger.debug(`[OutputStyles] Loaded style: ${name} from ${filePath}`);
      } catch (err) {
        logger.warn(`[OutputStyles] Failed to load style ${styleName}: ${err}`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug(`[OutputStyles] Could not read styles directory ${dirPath}: ${err}`);
    }
  }

  return styles;
}

/**
 * Extract description from markdown body
 */
function extractDescription(body: string, defaultDesc: string): string {
  // Try to get first paragraph
  const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length > 0) {
    const firstPara = lines.join(' ').slice(0, 200);
    if (firstPara.length > 0) return firstPara + (firstPara.length >= 200 ? '...' : '');
  }
  return defaultDesc;
}

/**
 * Built-in output styles
 */
const BUILTIN_STYLES: OutputStyleConfig[] = [
  {
    name: 'minimal',
    description: 'Minimal output - concise responses without verbose formatting',
    prompt: `You are a concise AI assistant. Keep responses short and to the point.
Avoid unnecessary preamble, summaries, or elaboration.
Focus on direct answers and essential information.`,
    source: 'builtin',
  },
  {
    name: 'verbose',
    description: 'Detailed output with full explanations and context',
    prompt: `You are a thorough AI assistant. Provide comprehensive responses with:
- Detailed explanations
- Supporting context
- Multiple examples where helpful
- Step-by-step breakdowns when appropriate
- Consider edge cases and alternatives`,
    source: 'builtin',
  },
  {
    name: 'technical',
    description: 'Technical output with code-focused formatting',
    prompt: `You are a technical AI assistant. Format responses with:
- Code blocks with language annotations
- Technical terminology used precisely
- Architecture and implementation details
- Performance considerations
- Type information where relevant`,
    source: 'builtin',
  },
  {
    name: 'friendly',
    description: 'Friendly and conversational output style',
    prompt: `You are a friendly AI assistant. Communicate in a warm, approachable manner:
- Use conversational language
- Add encouraging remarks where appropriate
- Explain things clearly without being condescending
- Be personable while remaining helpful`,
    source: 'builtin',
  },
  {
    name: 'formal',
    description: 'Professional and formal output style',
    prompt: `You are a professional AI assistant. Maintain formal communication:
- Use professional language and tone
- Be precise and accurate
- Avoid colloquialisms
- Structure responses clearly
- Executive-level communication style`,
    source: 'builtin',
  },
  {
    name: 'tutorial',
    description: 'Tutorial-style output with learning focus',
    prompt: `You are a tutorial AI assistant. Help users learn:
- Break down concepts into digestible parts
- Provide learning checkpoints
- Offer practice exercises when relevant
- Connect new concepts to prior knowledge
- Encourage understanding over memorization`,
    source: 'builtin',
  },
];

/**
 * Load all output styles (builtin + user + project)
 */
export async function loadAllOutputStyles(cwd?: string): Promise<OutputStyleConfig[]> {
  const styles: OutputStyleConfig[] = [...BUILTIN_STYLES];

  // Load user styles from ~/.pakalon/output-styles
  const userDir = path.join(process.env.HOME || process.env.USERPROFILE || '', USER_OUTPUT_STYLES_DIR);
  const userStyles = await loadStylesFromDir(userDir);
  styles.push(...userStyles);

  // Load project styles from project/.pakalon/output-styles
  if (cwd) {
    const projectDir = path.join(cwd, DEFAULT_OUTPUT_STYLES_DIR);
    const projectStyles = await loadStylesFromDir(projectDir);
    styles.push(...projectStyles);
  }

  // Remove duplicates (project overrides user, user overrides builtin)
  const seen = new Set<string>();
  const result: OutputStyleConfig[] = [];
  for (const style of styles.reverse()) {
    if (!seen.has(style.name.toLowerCase())) {
      seen.add(style.name.toLowerCase());
      result.unshift(style);
    }
  }

  return result;
}

/**
 * Get a specific output style by name
 */
export async function getOutputStyle(name: string, cwd?: string): Promise<OutputStyleConfig | null> {
  const allStyles = await loadAllOutputStyles(cwd);
  return allStyles.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Apply output style to a prompt/system message
 */
export function applyOutputStyle(
  basePrompt: string,
  style: OutputStyleConfig
): string {
  if (!style.prompt.trim()) {
    return basePrompt;
  }

  return `${basePrompt}\n\n## Output Style\n\n${style.prompt}`;
}

/**
 * Render content with output style formatting
 */
export function renderWithStyle(
  content: string,
  style: OutputStyleConfig,
  options: { includeHeader?: boolean; includeFooter?: boolean } = {}
): string {
  const { includeHeader = true, includeFooter = false } = options;

  const lines: string[] = [];

  if (includeHeader && style.description) {
    lines.push(`**Output Style: ${style.name}**`);
    lines.push(`_${style.description}_\n`);
  }

  lines.push(content);

  if (includeFooter) {
    lines.push('\n---\n_This response was formatted using the "' + style.name + '" output style._');
  }

  return lines.join('\n');
}

/**
 * Create a new output style file
 */
export async function createOutputStyle(
  name: string,
  options: {
    description?: string;
    prompt?: string;
    keepCodingInstructions?: boolean;
    projectDir?: string;
    userDir?: boolean;
  } = {}
): Promise<string> {
  const {
    description = `Custom ${name} output style`,
    prompt = options.prompt || 'Custom output style for ' + name,
    keepCodingInstructions,
    projectDir,
    userDir = true,
  } = options;

  const dir = userDir && !projectDir
    ? path.join(process.env.HOME || process.env.USERPROFILE || '', USER_OUTPUT_STYLES_DIR)
    : path.join(projectDir || process.cwd(), DEFAULT_OUTPUT_STYLES_DIR);

  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${name.toLowerCase().replace(/\s+/g, '-')}.md`);

  const frontmatter: Record<string, unknown> = {
    name,
    description,
  };

  if (keepCodingInstructions !== undefined) {
    frontmatter.keepCodingInstructions = keepCodingInstructions;
  }

  const content = [
    '---',
    ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    prompt,
  ].join('\n');

  await fs.writeFile(filePath, content, 'utf-8');
  logger.info(`[OutputStyles] Created style "${name}" at ${filePath}`);

  return filePath;
}

/**
 * List available output styles
 */
export async function listOutputStyles(cwd?: string): Promise<OutputStyleConfig[]> {
  return loadAllOutputStyles(cwd);
}

/**
 * Delete an output style
 */
export async function deleteOutputStyle(name: string, cwd?: string): Promise<boolean> {
  const style = await getOutputStyle(name, cwd);
  if (!style || style.source === 'builtin') {
    return false;
  }

  // Find the file path
  const userDir = path.join(process.env.HOME || process.env.USERPROFILE || '', USER_OUTPUT_STYLES_DIR);
  const projectDir = cwd ? path.join(cwd, DEFAULT_OUTPUT_STYLES_DIR) : null;

  const dirs = [projectDir, userDir].filter(Boolean) as string[];

  for (const dir of dirs) {
    const filePath = path.join(dir, `${name.toLowerCase().replace(/\s+/g, '-')}.md`);
    try {
      await fs.unlink(filePath);
      logger.info(`[OutputStyles] Deleted style "${name}"`);
      return true;
    } catch {
      // Try next directory
    }
  }

  return false;
}

/**
 * Validate an output style configuration
 */
export function validateOutputStyle(style: Partial<OutputStyleConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!style.name?.trim()) {
    errors.push('Style name is required');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(style.name)) {
    errors.push('Style name can only contain letters, numbers, underscores, and hyphens');
  }

  if (!style.prompt?.trim()) {
    errors.push('Style prompt is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get default output style
 */
export function getDefaultOutputStyle(): OutputStyleConfig {
  return BUILTIN_STYLES[0]; // 'minimal'
}

export {
  BUILTIN_STYLES,
  type MarkdownFrontmatter,
};