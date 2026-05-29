/**
 * Skill Change Detector
 *
 * Monitors skill directories for changes (additions, removals, modifications)
 * and emits events when the skill catalog is updated.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import chokidar from "chokidar";
import { discoverSkillCatalog, type SkillCatalogEntry } from "@/skills/catalog.js";
import logger from "@/utils/logger.js";

export type SkillChangeType = "added" | "removed" | "modified";

export interface SkillChangeEvent {
  type: SkillChangeType;
  skillName: string;
  skillPath: string;
  source: SkillCatalogEntry["source"];
  timestamp: number;
  previousEntry?: SkillCatalogEntry;
  currentEntry?: SkillCatalogEntry;
}

export interface SkillChangeDetectorOptions {
  projectDir?: string;
  debounceMs?: number;
  pollIntervalMs?: number;
  watchContent?: boolean;
}

const SKILL_SNAPSHOT_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "skill-snapshot.json",
);

interface SkillSnapshot {
  skills: Record<string, { path: string; mtime: number; hash: string }>;
  timestamp: number;
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

function loadSnapshot(): SkillSnapshot | null {
  try {
    if (fs.existsSync(SKILL_SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SKILL_SNAPSHOT_PATH, "utf-8");
      return JSON.parse(raw) as SkillSnapshot;
    }
  } catch {
    // Snapshot corrupted
  }
  return null;
}

function saveSnapshot(snapshot: SkillSnapshot): void {
  try {
    const dir = path.dirname(SKILL_SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SKILL_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  } catch {
    // Best effort
  }
}

function buildCurrentSnapshot(projectDir: string): SkillSnapshot {
  const skills = discoverSkillCatalog({
    includeContent: true,
    projectDir,
  });

  const skillMap: Record<string, { path: string; mtime: number; hash: string }> = {};

  for (const skill of skills) {
    try {
      const stat = fs.statSync(skill.path);
      skillMap[skill.name] = {
        path: skill.path,
        mtime: stat.mtimeMs,
        hash: simpleHash(skill.content ?? skill.description),
      };
    } catch {
      skillMap[skill.name] = {
        path: skill.path,
        mtime: 0,
        hash: simpleHash(skill.description),
      };
    }
  }

  return { skills: skillMap, timestamp: Date.now() };
}

function compareSnapshots(
  previous: SkillSnapshot | null,
  current: SkillSnapshot,
  projectDir: string,
): SkillChangeEvent[] {
  const events: SkillChangeEvent[] = [];
  const prevSkills = previous?.skills ?? {};
  const currSkills = current.skills;

  for (const [name, curr] of Object.entries(currSkills)) {
    const prev = prevSkills[name];
    if (!prev) {
      const entry = discoverSkillCatalog({ projectDir }).find(
        (s) => s.name === name,
      );
      events.push({
        type: "added",
        skillName: name,
        skillPath: curr.path,
        source: entry?.source ?? "global",
        timestamp: current.timestamp,
        currentEntry: entry,
      });
    } else if (prev.hash !== curr.hash || prev.mtime !== curr.mtime) {
      const prevEntry = discoverSkillCatalog({ projectDir }).find(
        (s) => s.name === name,
      );
      events.push({
        type: "modified",
        skillName: name,
        skillPath: curr.path,
        source: prevEntry?.source ?? "global",
        timestamp: current.timestamp,
        previousEntry: prevEntry,
        currentEntry: prevEntry,
      });
    }
  }

  for (const [name, prev] of Object.entries(prevSkills)) {
    if (!currSkills[name]) {
      events.push({
        type: "removed",
        skillName: name,
        skillPath: prev.path,
        source: "global",
        timestamp: current.timestamp,
        previousEntry: undefined,
      });
    }
  }

  return events;
}

export class SkillChangeDetector extends EventEmitter {
  private options: Required<SkillChangeDetectorOptions>;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastSnapshot: SkillSnapshot | null = null;
  private isScanning = false;

  constructor(options?: SkillChangeDetectorOptions) {
    super();
    this.options = {
      projectDir: options?.projectDir ?? process.cwd(),
      debounceMs: options?.debounceMs ?? 500,
      pollIntervalMs: options?.pollIntervalMs ?? 2000,
      watchContent: options?.watchContent ?? true,
    };
    this.lastSnapshot = loadSnapshot();
  }

  async start(): Promise<void> {
    if (this.watcher) {
      logger.debug("[skillChangeDetector] already running");
      return;
    }

    await this.scanForChanges();

    const skillDirs = this.getSkillDirs();
    if (skillDirs.length === 0) {
      logger.debug("[skillChangeDetector] no skill directories to watch");
      return;
    }

    const patterns = skillDirs.map((dir) =>
      path.join(dir, "**", "SKILL.md"),
    );

    this.watcher = chokidar.watch(patterns, {
      ignoreInitial: false,
      persistent: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: this.options.pollIntervalMs,
      },
    });

    this.watcher
      .on("add", () => this.onFileChange())
      .on("change", () => this.onFileChange())
      .on("unlink", () => this.onFileChange())
      .on("error", (err) => {
        logger.error("[skillChangeDetector] watcher error", err);
      });

    logger.info("[skillChangeDetector] started watching skill directories");
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    logger.info("[skillChangeDetector] stopped");
  }

  async scanForChanges(): Promise<SkillChangeEvent[]> {
    if (this.isScanning) return [];
    this.isScanning = true;

    try {
      const currentSnapshot = buildCurrentSnapshot(this.options.projectDir);
      const events = compareSnapshots(
        this.lastSnapshot,
        currentSnapshot,
        this.options.projectDir,
      );

      if (events.length > 0) {
        saveSnapshot(currentSnapshot);
        this.lastSnapshot = currentSnapshot;

        for (const event of events) {
          this.emit("change", event);
          this.emit(event.type, event);
        }

        logger.info("[skillChangeDetector] detected changes", {
          changes: events.length,
          types: events.map((e) => e.type),
        });
      }

      return events;
    } finally {
      this.isScanning = false;
    }
  }

  private onFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.scanForChanges();
    }, this.options.debounceMs);
  }

  private getSkillDirs(): string[] {
    const dirs: string[] = [];
    const projectDir = this.options.projectDir;

    const candidates = [
      path.join(projectDir, ".pakalon", "skills"),
      path.join(projectDir, ".claude", "skills"),
      path.join(projectDir, ".agents", "skills"),
      path.join(projectDir, ".pakalon-agents", "skills"),
      path.join(os.homedir(), ".agents", "skills"),
      path.join(os.homedir(), ".claude", "skills"),
      path.join(os.homedir(), ".pakalon", "skills"),
    ];

    for (const dir of candidates) {
      try {
        if (fs.existsSync(dir)) {
          dirs.push(dir);
        }
      } catch {
        // Directory not accessible
      }
    }

    return dirs;
  }

  getSnapshot(): SkillSnapshot | null {
    return this.lastSnapshot;
  }
}

export function createSkillChangeDetector(
  options?: SkillChangeDetectorOptions,
): SkillChangeDetector {
  return new SkillChangeDetector(options);
}
