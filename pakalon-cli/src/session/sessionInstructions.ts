/**
 * Session Instructions
 * 
 * Loads AGENTS.md/CLAUDE.md files for context.
 * Modeled after opencode's session/instruction.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Instruction file names to search for */
export const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTEXT.md', // deprecated
];

/** Global instruction directories */
export const GLOBAL_INSTRUCTION_DIRS = [
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon'),
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.pakalon'),
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InstructionFile {
  /** Absolute path to the file */
  path: string;
  /** File contents */
  content: string;
  /** Source type */
  source: 'global' | 'project' | 'nearby';
}

export interface InstructionResult {
  /** All found instruction files */
  files: InstructionFile[];
  /** Combined content */
  content: string;
  /** Paths that were loaded */
  paths: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

const instructionCache = new Map<string, InstructionFile>();

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a file safely, returning null if not found
 */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

/**
 * Find instruction files walking up directory tree
 */
export function findInstructionFiles(
  startDir: string,
  rootDir?: string,
): string[] {
  const found: string[] = [];
  let current = path.resolve(startDir);
  const root = rootDir ? path.resolve(rootDir) : path.parse(current).root;

  while (current !== root && current !== path.dirname(current)) {
    for (const filename of INSTRUCTION_FILES) {
      const filePath = path.join(current, filename);
      if (fs.existsSync(filePath)) {
        found.push(filePath);
      }
    }
    current = path.dirname(current);
  }

  return found;
}

/**
 * Read instruction files and return contents
 */
export async function readInstructionFiles(
  files: string[],
): Promise<InstructionFile[]> {
  const results: InstructionFile[] = [];

  for (const filePath of files) {
    // Check cache first
    const cached = instructionCache.get(filePath);
    if (cached) {
      results.push(cached);
      continue;
    }

    const content = await readFileSafe(filePath);
    if (content) {
      const instructionFile: InstructionFile = {
        path: filePath,
        content,
        source: getInstructionSource(filePath),
      };
      instructionCache.set(filePath, instructionFile);
      results.push(instructionFile);
    }
  }

  return results;
}

/**
 * Get instruction source type based on path
 */
function getInstructionSource(filePath: string): 'global' | 'project' | 'nearby' {
  const normalized = path.normalize(filePath);
  
  // Check global directories
  for (const dir of GLOBAL_INSTRUCTION_DIRS) {
    if (normalized.startsWith(path.normalize(dir))) {
      return 'global';
    }
  }

  // Check if it's in a parent directory (project-level)
  const cwd = process.cwd();
  if (normalized.startsWith(cwd) && path.dirname(normalized) !== cwd) {
    return 'project';
  }

  // Otherwise it's a nearby file
  return 'nearby';
}

/**
 * Get all system instructions from global and project levels
 */
export async function getSystemInstructions(): Promise<InstructionResult> {
  const files: InstructionFile[] = [];

  // Check global directories
  for (const dir of GLOBAL_INSTRUCTION_DIRS) {
    for (const filename of INSTRUCTION_FILES) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        const content = await readFileSafe(filePath);
        if (content) {
          files.push({
            path: filePath,
            content,
            source: 'global',
          });
        }
      }
    }
  }

  // Check project-level (cwd)
  const cwd = process.cwd();
  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      const content = await readFileSafe(filePath);
      if (content) {
        files.push({
          path: filePath,
          content,
          source: 'project',
        });
      }
    }
  }

  return {
    files,
    content: files.map(f => f.content).join('\n\n'),
    paths: files.map(f => f.path),
  };
}

/**
 * Resolve nearby instruction files for a given file path
 */
export async function resolveNearbyInstructions(
  filepath: string,
  projectRoot: string,
): Promise<InstructionResult> {
  const dir = path.dirname(filepath);
  const instructionFiles = findInstructionFiles(dir, projectRoot);
  const files = await readInstructionFiles(instructionFiles);

  return {
    files,
    content: files.map(f => f.content).join('\n\n'),
    paths: files.map(f => f.path),
  };
}

/**
 * Clear instruction cache
 */
export function clearInstructionCache(): void {
  instructionCache.clear();
}

export * as SessionInstructions from './sessionInstructions.js';
