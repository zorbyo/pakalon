import { z } from "zod";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Browser, BrowserContext, LaunchOptions, Page, StorageState } from "playwright";

export interface BrowserSession {
  id: string;
  name: string;
  createdAt: Date;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  cookies?: string;
}

export interface SessionOptions {
  profile?: string;
  storageStatePath?: string;
  headless?: boolean;
  launchOptions?: Partial<LaunchOptions>;
}

export const sessionCreateSchema = z.object({
  name: z.string().min(1),
  profile: z.string().min(1).optional(),
  storageStatePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
});

export const sessionIdSchema = z.object({
  id: z.string().min(1),
});

export const sessionStateSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;
export type SessionIdInput = z.infer<typeof sessionIdSchema>;
export type SessionStateInput = z.infer<typeof sessionStateSchema>;

type SessionRecord = {
  session: BrowserSession;
  profile?: string;
  storageStatePath?: string;
};

function createSessionId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36);
  return slug ? `${slug}-${suffix}` : `session-${suffix}`;
}

function resolveProfileStatePath(profile: string): string {
  return path.join(process.cwd(), ".pakalon", "browser", "profiles", `${profile}.json`);
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function stringifyCookies(storageState: { cookies: Array<{ name: string; value: string; domain: string; path: string }> }): string {
  return JSON.stringify(storageState.cookies);
}

export class SessionManager {
  private sessions: Map<string, SessionRecord> = new Map();
  private currentSessionId: string | null = null;

  async createSession(name: string, options?: SessionOptions): Promise<BrowserSession> {
    const validated = sessionCreateSchema.parse({
      name,
      profile: options?.profile,
      storageStatePath: options?.storageStatePath,
      headless: options?.headless,
    });

    const sessionId = createSessionId(validated.name);
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: validated.headless ?? true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...(options?.launchOptions ?? {}),
    });

    const storageStatePath = validated.storageStatePath ?? (validated.profile ? resolveProfileStatePath(validated.profile) : undefined);
    const context = storageStatePath
      ? await browser.newContext({ storageState: storageStatePath })
      : await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const storageState = await context.storageState();
    const session: BrowserSession = {
      id: sessionId,
      name: validated.name,
      createdAt: new Date(),
      browser,
      context,
      page,
      cookies: stringifyCookies(storageState),
    };

    this.sessions.set(sessionId, {
      session,
      profile: validated.profile,
      storageStatePath,
    });
    this.currentSessionId = sessionId;

    return session;
  }

  async getSession(id: string): Promise<BrowserSession | undefined> {
    return this.sessions.get(id)?.session;
  }

  async switchSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) {
      throw new Error(`Session not found: ${id}`);
    }

    this.currentSessionId = id;
  }

  async closeSession(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) {
      throw new Error(`Session not found: ${id}`);
    }

    const { session } = record;

    if (session.page && !session.page.isClosed()) {
      await session.page.close();
    }
    if (session.context) {
      await session.context.close();
    }
    if (session.browser && session.browser.isConnected()) {
      await session.browser.close();
    }

    this.sessions.delete(id);
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
  }

  async saveState(sessionId: string, filePath: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record?.session.context) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const state = await record.session.context.storageState();
    await ensureParentDir(filePath);
    await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
    record.session.cookies = stringifyCookies(state);
    record.storageStatePath = filePath;
  }

  async loadState(sessionId: string, filePath: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const raw = await readFile(filePath, "utf-8");
    const storageState = JSON.parse(raw) as StorageState;

    const current = record.session;
    if (current.page && !current.page.isClosed()) {
      await current.page.close();
    }
    if (current.context) {
      await current.context.close();
    }
    if (current.browser && current.browser.isConnected()) {
      await current.browser.close();
    }

    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    current.browser = browser;
    current.context = context;
    current.page = page;
    current.cookies = JSON.stringify(storageState.cookies);
    record.storageStatePath = filePath;
  }

  async listSessions(): Promise<BrowserSession[]> {
    return Array.from(this.sessions.values()).map((record) => record.session);
  }
}
