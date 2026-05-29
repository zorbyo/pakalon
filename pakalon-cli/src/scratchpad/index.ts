import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '@/utils/logger.js';

export interface ScratchpadEntry {
  id: string;
  content: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface ScratchpadFile {
  entries: ScratchpadEntry[];
  version: number;
}

const SCRATCHPAD_DIR = path.join(os.homedir(), '.pakalon', 'scratch');
const SCRATCHPAD_FILE = path.join(SCRATCHPAD_DIR, 'scratchpad.json');

let scratchpadCache: ScratchpadFile | null = null;
let currentScratchpadId: string | null = null;

function ensureScratchpadDir(): void {
  if (!fs.existsSync(SCRATCHPAD_DIR)) {
    fs.mkdirSync(SCRATCHPAD_DIR, { recursive: true });
  }
}

function loadScratchpad(): ScratchpadFile {
  if (scratchpadCache) {
    return scratchpadCache;
  }

  ensureScratchpadDir();

  if (!fs.existsSync(SCRATCHPAD_FILE)) {
    const empty: ScratchpadFile = { entries: [], version: 1 };
    saveScratchpad(empty);
    scratchpadCache = empty;
    return scratchpadCache;
  }

  try {
    const content = fs.readFileSync(SCRATCHPAD_FILE, 'utf-8');
    scratchpadCache = JSON.parse(content);
    return scratchpadCache!;
  } catch (err) {
    logger.warn('Failed to load scratchpad:', err);
    const empty: ScratchpadFile = { entries: [], version: 1 };
    scratchpadCache = empty;
    return scratchpadCache;
  }
}

function saveScratchpad(scratchpad: ScratchpadFile): void {
  ensureScratchpadDir();

  try {
    fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify(scratchpad, null, 2), 'utf-8');
    scratchpadCache = scratchpad;
  } catch (err) {
    logger.error('Failed to save scratchpad:', err);
  }
}

export function createScratchpadEntry(
  content: string,
  language: string = 'markdown',
  tags: string[] = []
): ScratchpadEntry {
  const now = new Date().toISOString();

  const entry: ScratchpadEntry = {
    id: `scratch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    content,
    language,
    createdAt: now,
    updatedAt: now,
    tags,
  };

  const scratchpad = loadScratchpad();
  scratchpad.entries.push(entry);
  saveScratchpad(scratchpad);

  return entry;
}

export function updateScratchpadEntry(
  id: string,
  updates: Partial<Pick<ScratchpadEntry, 'content' | 'tags'>>
): ScratchpadEntry | null {
  const scratchpad = loadScratchpad();
  const entry = scratchpad.entries.find((e) => e.id === id);

  if (!entry) {
    return null;
  }

  if (updates.content !== undefined) {
    entry.content = updates.content;
  }

  if (updates.tags !== undefined) {
    entry.tags = updates.tags;
  }

  entry.updatedAt = new Date().toISOString();
  saveScratchpad(scratchpad);

  return entry;
}

export function deleteScratchpadEntry(id: string): boolean {
  const scratchpad = loadScratchpad();
  const index = scratchpad.entries.findIndex((e) => e.id === id);

  if (index === -1) {
    return false;
  }

  scratchpad.entries.splice(index, 1);
  saveScratchpad(scratchpad);

  return true;
}

export function getScratchpadEntry(id: string): ScratchpadEntry | null {
  const scratchpad = loadScratchpad();
  return scratchpad.entries.find((e) => e.id === id) || null;
}

export function getAllScratchpadEntries(): ScratchpadEntry[] {
  const scratchpad = loadScratchpad();
  return [...scratchpad.entries].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function searchScratchpad(query: string): ScratchpadEntry[] {
  const scratchpad = loadScratchpad();
  const lowerQuery = query.toLowerCase();

  return scratchpad.entries.filter(
    (e) =>
      e.content.toLowerCase().includes(lowerQuery) ||
      e.tags.some((t) => t.toLowerCase().includes(lowerQuery))
  );
}

export function setCurrentScratchpad(id: string | null): void {
  currentScratchpadId = id;
}

export function getCurrentScratchpad(): ScratchpadEntry | null {
  if (!currentScratchpadId) {
    return null;
  }
  return getScratchpadEntry(currentScratchpadId);
}

export function clearScratchpad(): void {
  const empty: ScratchpadFile = { entries: [], version: 1 };
  saveScratchpad(empty);
  currentScratchpadId = null;
}

export function exportScratchpad(): string {
  const scratchpad = loadScratchpad();
  return JSON.stringify(scratchpad, null, 2);
}

export async function importScratchpad(json: string): Promise<boolean> {
  try {
    const data = JSON.parse(json) as ScratchpadFile;
    saveScratchpad(data);
    return true;
  } catch (err) {
    logger.error('Failed to import scratchpad:', err);
    return false;
  }
}

export function isScratchpadEnabled(): boolean {
  return process.env.PAKALON_SCRATCHPAD !== '0';
}

export function enableScratchpad(): void {
  process.env.PAKALON_SCRATCHPAD = '1';
}

export function disableScratchpad(): void {
  process.env.PAKALON_SCRATCHPAD = '0';
}

export function getScratchpadStats(): {
  totalEntries: number;
  totalSize: number;
  byLanguage: Record<string, number>;
  byTag: Record<string, number>;
} {
  const scratchpad = loadScratchpad();

  const byLanguage: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  let totalSize = 0;

  for (const entry of scratchpad.entries) {
    totalSize += entry.content.length;

    byLanguage[entry.language] = (byLanguage[entry.language] || 0) + 1;

    for (const tag of entry.tags) {
      byTag[tag] = (byTag[tag] || 0) + 1;
    }
  }

  return {
    totalEntries: scratchpad.entries.length,
    totalSize,
    byLanguage,
    byTag,
  };
}