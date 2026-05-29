/**
 * Session Aliases - Named shortcuts for sessions
 * 
 * Allows users to create memorable names for sessions
 * for easy resumption.
 */

import fs from "fs/promises";
import path from "path";

export interface SessionAlias {
  alias: string;
  sessionId: string;
  createdAt: Date;
  description?: string;
}

const ALIASES_FILE = ".pakalon/session-aliases.json";

class SessionAliasManager {
  private aliases: Map<string, SessionAlias> = new Map();
  private aliasesPath: string;
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.aliasesPath = path.join(projectDir, ALIASES_FILE);
  }

  async initialize(): Promise<void> {
    try {
      const data = await fs.readFile(this.aliasesPath, "utf-8");
      const parsed = JSON.parse(data) as SessionAlias[];
      this.aliases = new Map(parsed.map((a) => [a.alias.toLowerCase(), a]));
    } catch {
      this.aliases = new Map();
    }
  }

  async addAlias(alias: string, sessionId: string, description?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const normalized = alias.toLowerCase().trim();
    if (!normalized) {
      return { success: false, error: "Alias cannot be empty" };
    }

    if (this.aliases.has(normalized)) {
      return { success: false, error: `Alias "${alias}" already exists` };
    }

    const newAlias: SessionAlias = {
      alias,
      sessionId,
      createdAt: new Date(),
      description,
    };

    this.aliases.set(normalized, newAlias);
    await this.persist();

    return { success: true };
  }

  async removeAlias(alias: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const normalized = alias.toLowerCase().trim();
    if (!this.aliases.has(normalized)) {
      return { success: false, error: `Alias "${alias}" not found` };
    }

    this.aliases.delete(normalized);
    await this.persist();

    return { success: true };
  }

  async getSessionId(alias: string): Promise<string | null> {
    const normalized = alias.toLowerCase().trim();
    const entry = this.aliases.get(normalized);
    return entry?.sessionId ?? null;
  }

  async listAliases(): Promise<SessionAlias[]> {
    return Array.from(this.aliases.values()).sort(
      (a, b) => a.alias.localeCompare(b.alias)
    );
  }

  async updateDescription(alias: string, description: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const normalized = alias.toLowerCase().trim();
    const entry = this.aliases.get(normalized);
    if (!entry) {
      return { success: false, error: `Alias "${alias}" not found` };
    }

    entry.description = description;
    await this.persist();

    return { success: true };
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.aliasesPath), { recursive: true });
    await fs.writeFile(
      this.aliasesPath,
      JSON.stringify(Array.from(this.aliases.values()), null, 2)
    );
  }
}

let globalAliasManager: SessionAliasManager | null = null;

export async function initializeSessionAliases(projectDir: string): Promise<SessionAliasManager> {
  globalAliasManager = new SessionAliasManager(projectDir);
  await globalAliasManager.initialize();
  return globalAliasManager;
}

export function getSessionAliasManager(): SessionAliasManager | null {
  return globalAliasManager;
}

export async function addSessionAlias(
  alias: string,
  sessionId: string,
  description?: string
): Promise<{ success: boolean; error?: string }> {
  if (!globalAliasManager) {
    return { success: false, error: "Session alias manager not initialized" };
  }
  return globalAliasManager.addAlias(alias, sessionId, description);
}

export async function getSessionByAlias(alias: string): Promise<string | null> {
  if (!globalAliasManager) {
    return null;
  }
  return globalAliasManager.getSessionId(alias);
}

export async function listSessionAliases(): Promise<SessionAlias[]> {
  if (!globalAliasManager) {
    return [];
  }
  return globalAliasManager.listAliases();
}