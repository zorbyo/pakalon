/**
 * Skill Sourcing & Provenance — Track where skills come from and their history.
 *
 * Provides comprehensive provenance tracking:
 * - Source type detection (project, global, npm, git, url)
 * - Version tracking
 * - Installation history
 * - Change detection with SHA-256 hashing
 * - Trust verification
 *
 * Port from Pi's skill sourcing patterns.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SkillSource =
  | "project"
  | "global"
  | "embedded"
  | "vendored"
  | "npm"
  | "git"
  | "url"
  | "unknown";

export type TrustLevel = "trusted" | "verified" | "unverified" | "untrusted";

export interface SkillProvenance {
  /** Skill name */
  name: string;
  /** Source type */
  source: SkillSource;
  /** Source path or URL */
  sourcePath: string;
  /** Version if available */
  version?: string;
  /** Git commit hash if from git */
  gitCommit?: string;
  /** Git branch if from git */
  gitBranch?: string;
  /** Git remote URL if from git */
  gitRemote?: string;
  /** npm package name if from npm */
  npmPackage?: string;
  /** npm version range if from npm */
  npmVersion?: string;
  /** Installation timestamp */
  installedAt: Date;
  /** Last verified timestamp */
  lastVerifiedAt?: Date;
  /** Content hash at installation */
  installedHash: string;
  /** Current content hash */
  currentHash?: string;
  /** Whether the skill has been modified */
  modified?: boolean;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Verification source (who verified) */
  verifiedBy?: string;
  /** Installation method */
  installMethod: "manual" | "npm" | "git-clone" | "git-subdir" | "url-download" | "builtin";
  /** Dependencies */
  dependencies?: string[];
  /** License */
  license?: string;
  /** Author */
  author?: string;
  /** Homepage URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;
}

export interface ProvenanceHistory {
  /** Skill name */
  name: string;
  /** History entries */
  entries: ProvenanceEntry[];
}

export interface ProvenanceEntry {
  /** Entry type */
  type: "install" | "update" | "verify" | "trust-change" | "modification-detected";
  /** Timestamp */
  timestamp: Date;
  /** Previous state (for updates/trust changes) */
  previous?: Partial<SkillProvenance>;
  /** New state */
  current: Partial<SkillProvenance>;
  /** Reason for the entry */
  reason?: string;
}

export interface ProvenanceStats {
  /** Total tracked skills */
  totalSkills: number;
  /** Skills by source */
  bySource: Map<SkillSource, number>;
  /** Skills by trust level */
  byTrustLevel: Map<TrustLevel, number>;
  /** Skills modified since installation */
  modifiedCount: number;
  /** Skills with verification */
  verifiedCount: number;
  /** Recent installations (last 7 days) */
  recentInstallations: SkillProvenance[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance Store
// ─────────────────────────────────────────────────────────────────────────────

export class ProvenanceStore {
  private provenance: Map<string, SkillProvenance> = new Map();
  private history: Map<string, ProvenanceHistory> = new Map();
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath ?? path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "pakalon",
      "skill-provenance.json"
    );
    this.load();
  }

  /**
   * Record skill provenance.
   */
  record(provenance: SkillProvenance): void {
    const existing = this.provenance.get(provenance.name);
    
    // Add history entry
    const historyEntry: ProvenanceEntry = {
      type: existing ? "update" : "install",
      timestamp: new Date(),
      previous: existing ? { ...existing } : undefined,
      current: { ...provenance },
      reason: existing ? "Updated" : "Installed",
    };
    this.addHistoryEntry(provenance.name, historyEntry);

    // Update provenance
    this.provenance.set(provenance.name, {
      ...provenance,
      lastVerifiedAt: new Date(),
    });

    this.save();
    logger.debug("[Provenance] Recorded", {
      name: provenance.name,
      source: provenance.source,
      version: provenance.version,
    });
  }

  /**
   * Get provenance for a skill.
   */
  get(name: string): SkillProvenance | undefined {
    return this.provenance.get(name);
  }

  /**
   * Get all provenance records.
   */
  getAll(): SkillProvenance[] {
    return Array.from(this.provenance.values());
  }

  /**
   * Update skill hash and check for modifications.
   */
  verify(name: string, currentHash: string): boolean {
    const provenance = this.provenance.get(name);
    if (!provenance) return false;

    const modified = provenance.installedHash !== currentHash;
    
    if (modified && !provenance.modified) {
      // First time detecting modification
      const historyEntry: ProvenanceEntry = {
        type: "modification-detected",
        timestamp: new Date(),
        current: { currentHash, modified: true },
        reason: `Content hash mismatch: expected ${provenance.installedHash.slice(0, 12)}, got ${currentHash.slice(0, 12)}`,
      };
      this.addHistoryEntry(name, historyEntry);

      provenance.modified = true;
      provenance.currentHash = currentHash;
      this.save();

      logger.warn("[Provenance] Modification detected", {
        name,
        expectedHash: provenance.installedHash.slice(0, 12),
        actualHash: currentHash.slice(0, 12),
      });
    }

    provenance.lastVerifiedAt = new Date();
    this.save();

    return !modified;
  }

  /**
   * Update trust level.
   */
  setTrustLevel(name: string, level: TrustLevel, reason?: string): void {
    const provenance = this.provenance.get(name);
    if (!provenance) return;

    const previous = { trustLevel: provenance.trustLevel };
    provenance.trustLevel = level;

    const historyEntry: ProvenanceEntry = {
      type: "trust-change",
      timestamp: new Date(),
      previous,
      current: { trustLevel: level },
      reason,
    };
    this.addHistoryEntry(name, historyEntry);

    this.save();
    logger.info("[Provenance] Trust level changed", {
      name,
      from: previous.trustLevel,
      to: level,
      reason,
    });
  }

  /**
   * Get history for a skill.
   */
  getHistory(name: string): ProvenanceHistory | undefined {
    return this.history.get(name);
  }

  /**
   * Get stats.
   */
  getStats(): ProvenanceStats {
    const bySource = new Map<SkillSource, number>();
    const byTrustLevel = new Map<TrustLevel, number>();
    let modifiedCount = 0;
    let verifiedCount = 0;
    const recentInstallations: SkillProvenance[] = [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const prov of this.provenance.values()) {
      // By source
      bySource.set(prov.source, (bySource.get(prov.source) ?? 0) + 1);

      // By trust level
      byTrustLevel.set(prov.trustLevel, (byTrustLevel.get(prov.trustLevel) ?? 0) + 1);

      // Modified count
      if (prov.modified) modifiedCount++;

      // Verified count
      if (prov.lastVerifiedAt) verifiedCount++;

      // Recent installations
      if (prov.installedAt > sevenDaysAgo) {
        recentInstallations.push(prov);
      }
    }

    return {
      totalSkills: this.provenance.size,
      bySource,
      byTrustLevel,
      modifiedCount,
      verifiedCount,
      recentInstallations,
    };
  }

  /**
   * Remove provenance record.
   */
  remove(name: string): boolean {
    const removed = this.provenance.delete(name);
    this.history.delete(name);
    if (removed) {
      this.save();
      logger.debug("[Provenance] Removed", { name });
    }
    return removed;
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.provenance.clear();
    this.history.clear();
    this.save();
    logger.debug("[Provenance] Cleared all records");
  }

  private addHistoryEntry(name: string, entry: ProvenanceEntry): void {
    let history = this.history.get(name);
    if (!history) {
      history = { name, entries: [] };
      this.history.set(name, history);
    }
    history.entries.push(entry);

    // Trim history to last 100 entries
    if (history.entries.length > 100) {
      history.entries = history.entries.slice(-100);
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"));
        
        // Load provenance
        if (data.provenance) {
          for (const [name, prov] of Object.entries(data.provenance)) {
            this.provenance.set(name, {
              ...(prov as SkillProvenance),
              installedAt: new Date((prov as SkillProvenance).installedAt),
              lastVerifiedAt: (prov as SkillProvenance).lastVerifiedAt
                ? new Date((prov as SkillProvenance).lastVerifiedAt!)
                : undefined,
            });
          }
        }

        // Load history
        if (data.history) {
          for (const [name, hist] of Object.entries(data.history)) {
            const h = hist as ProvenanceHistory;
            this.history.set(name, {
              name,
              entries: h.entries.map((e) => ({
                ...e,
                timestamp: new Date(e.timestamp),
                previous: e.previous ? { ...e.previous } : undefined,
                current: { ...e.current },
              })),
            });
          }
        }

        logger.debug("[Provenance] Loaded from disk", {
          skills: this.provenance.size,
        });
      }
    } catch (error) {
      logger.warn("[Provenance] Failed to load", { error: String(error) });
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        provenance: Object.fromEntries(this.provenance),
        history: Object.fromEntries(this.history),
        savedAt: new Date().toISOString(),
      };

      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      logger.warn("[Provenance] Failed to save", { error: String(error) });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the source of a skill based on its path.
 */
export function detectSkillSource(skillPath: string): SkillSource {
  const normalized = skillPath.replace(/\\/g, "/");

  // Check for project skills
  if (normalized.includes("/.pakalon/skills/") || normalized.includes("/.claude/skills/")) {
    return "project";
  }

  // Check for global skills
  if (
    normalized.includes("/.config/pakalon/skills/") ||
    normalized.includes("/.agents/skills/")
  ) {
    return "global";
  }

  // Check for embedded skills (in CLI package)
  if (normalized.includes("/skills/bundled/")) {
    return "embedded";
  }

  // Check for vendored skills
  if (normalized.includes("/vendor/")) {
    return "vendored";
  }

  return "unknown";
}

/**
 * Detect if a path is from npm.
 */
export function isNpmSource(skillPath: string): boolean {
  return skillPath.includes("/node_modules/");
}

/**
 * Detect if a path is from git.
 */
export function isGitSource(skillPath: string): boolean {
  return skillPath.includes("/.git/") || skillPath.startsWith("git@");
}

/**
 * Extract git info from a path.
 */
export function extractGitInfo(skillPath: string): { remote?: string; commit?: string; branch?: string } {
  // This is a simplified implementation
  // In a real implementation, you'd use git commands to get this info
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate SHA-256 hash of a file.
 */
export function calculateFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Calculate SHA-256 hash of a string.
 */
export function calculateStringHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let storeInstance: ProvenanceStore | null = null;

/**
 * Get the singleton provenance store.
 */
export function getProvenanceStore(storePath?: string): ProvenanceStore {
  if (!storeInstance) {
    storeInstance = new ProvenanceStore(storePath);
  }
  return storeInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetProvenanceStore(): void {
  storeInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record skill installation.
 */
export function recordSkillInstallation(
  name: string,
  source: SkillSource,
  sourcePath: string,
  options?: {
    version?: string;
    npmPackage?: string;
    gitCommit?: string;
    installMethod?: SkillProvenance["installMethod"];
    author?: string;
    license?: string;
  }
): SkillProvenance {
  const store = getProvenanceStore();
  const hash = calculateFileHash(sourcePath) ?? calculateStringHash(sourcePath);

  const provenance: SkillProvenance = {
    name,
    source,
    sourcePath,
    version: options?.version,
    npmPackage: options?.npmPackage,
    gitCommit: options?.gitCommit,
    installedAt: new Date(),
    installedHash: hash,
    trustLevel: "unverified",
    installMethod: options?.installMethod ?? "manual",
    author: options?.author,
    license: options?.license,
  };

  store.record(provenance);
  return provenance;
}

/**
 * Verify a skill's integrity.
 */
export function verifySkillIntegrity(name: string, filePath: string): boolean {
  const store = getProvenanceStore();
  const hash = calculateFileHash(filePath);
  if (!hash) return false;
  return store.verify(name, hash);
}
