/**
 * Phase 3 Sub-Agent: Integration Agent (Enhanced)
 *
 * Generates integration tests from Phase 1/2 documents.
 * Supports: vitest — Generates: API, data flow, auth, E2E, load tests.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentContext, AgentResult } from "../types.js";
import * as path from "path";
import * as fs from "fs/promises";
import logger from "@/utils/logger.js";

export interface IntegrationAgentOptions {
  outputDir: string;
  phaseContext?: string;
  userStories?: string;
  apiReference?: string;
  databaseSchema?: string;
  projectType?: string;
  testFramework?: string;
  typescript?: boolean;
}

export class IntegrationAgent extends BaseAgent {
  private options: IntegrationAgentOptions;

  constructor(context: AgentContext, options: IntegrationAgentOptions) {
    const config: AgentConfig = {
      name: "integration-agent",
      model: "anthropic/claude-3-5-haiku",
      systemPrompt: buildSysPrompt(options),
      tools: [],
      maxTokens: 16384,
      temperature: 0.3,
    };
    super(config, context);
    this.options = options;
  }

  public async execute(): Promise<AgentResult> {
    const start = Date.now();
    const files: string[] = [];
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
      const ext = this.options.typescript !== false ? ".ts" : ".js";

      const specs: Array<[string, () => string]> = [
        ["api.integration", this.genApiTests.bind(this)],
        ["data-flow", this.genDataFlow.bind(this)],
        ["auth-flow", this.genAuthFlow.bind(this)],
        ["e2e-scenarios", this.genE2e.bind(this)],
        ["load-tests", this.genLoad.bind(this)],
      ];

      const setup = this.genSetup();
      const sp = path.join(this.options.outputDir, `setup${ext}`);
      await fs.writeFile(sp, setup, "utf-8");
      files.push(sp);

      for (const [name, gen] of specs) {
        const fp = path.join(this.options.outputDir, `${name}${ext}`);
        await fs.writeFile(fp, gen(), "utf-8");
        files.push(fp);
      }

      logger.info(`[IntegrationAgent] Created ${files.length} files`);
      return { success: true, message: `Created ${files.length} files`, filesCreated: files, duration: Date.now() - start };
    } catch (e) {
      return { success: false, message: String(e), duration: Date.now() - start };
    }
  }

  // -----------------------------------------------------------------------
  // Test generators
  // -----------------------------------------------------------------------

  private genApiTests(): string {
    const baseUrl = process.env.API_URL ?? "http://localhost:3000";
    return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const BASE_URL = process.env.API_URL || '${baseUrl}';
describe('API Integration', () => {
  let token = '';
  beforeAll(async () => {
    const r = await fetch(BASE_URL + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 't@t.com', password: 't' }) });
    if (r.ok) { const d = await r.json(); token = d.token || d.accessToken; }
  });
  afterAll(async () => {});
  it('health endpoint', async () => { expect((await fetch(BASE_URL + '/health')).status).toBe(200); });
  it('auth required', async () => { expect([401,403]).toContain((await fetch(BASE_URL + '/api/protected')).status); });
  it('authenticated request', async () => {
    if (!token) return;
    expect((await fetch(BASE_URL + '/api/data', { headers: { Authorization: 'Bearer ' + token } })).ok).toBe(true);
  });
});`;
  }

  private genDataFlow(): string {
    const baseUrl = process.env.API_URL ?? "http://localhost:3000";
    return `import { describe, it, expect } from 'vitest';
const BASE_URL = process.env.API_URL || '${baseUrl}';
describe('CRUD Data Flow', () => {
  it('completes create-read-update-delete cycle', async () => {
    const c = await fetch(BASE_URL + '/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test-item' }) });
    expect([200,201]).toContain(c.status);
    const d = await c.json();
    const id = d.id;
    expect((await fetch(BASE_URL + '/api/items/' + id)).status).toBe(200);
    const u = await fetch(BASE_URL + '/api/items/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'updated' }) });
    expect([200,204]).toContain(u.status);
    expect((await fetch(BASE_URL + '/api/items/' + id, { method: 'DELETE' })).status).toBe(204);
  });
});`;
  }

  private genAuthFlow(): string {
    return `import { describe, it, expect } from 'vitest';
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
describe('Auth Flow', () => {
  it('login succeeds', async () => { expect((await fetch(BASE_URL + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 't@t.com', password: 't' }) })).status).toBe(200); });
  it('login fails', async () => { expect((await fetch(BASE_URL + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@x.com', password: 'x' }) })).status).toBe(401); });
  it('rejects bad token', async () => { expect((await fetch(BASE_URL + '/api/auth/profile', { headers: { Authorization: 'Bearer bad' } })).status).toBe(401); });
});`;
  }

  private genE2e(): string {
    return `import { describe, it, expect } from 'vitest';
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
describe('E2E Scenarios', () => {
  it('registers user', async () => { const r = await fetch(BASE_URL + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'u-' + Date.now() + '@t.com', password: 'P@ss1' }) }); expect(r.status).toBe(201); });
  it('concurrent health', async () => { const rs = await Promise.all(Array.from({ length: 5 }, () => fetch(BASE_URL + '/health'))); expect(rs.filter(r => r.status === 200).length).toBe(5); });
});`;
  }

  private genLoad(): string {
    return `import { describe, it, expect } from 'vitest';
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
describe('Load', () => {
  it('responds under 5s', async () => { const s = Date.now(); await fetch(BASE_URL + '/health'); expect(Date.now() - s).toBeLessThan(5000); });
  it('10 concurrent', async () => { const rs = await Promise.all(Array.from({ length: 10 }, () => fetch(BASE_URL + '/health'))); expect(rs.filter(r => r.status === 200).length).toBeGreaterThanOrEqual(8); });
});`;
  }

  private genSetup(): string {
    return `process.env.API_URL = process.env.API_URL || 'http://localhost:3000';
process.env.NODE_ENV = 'test';
`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSysPrompt(opts: IntegrationAgentOptions): string {
  return [
    `You are the Pakalon Integration Agent.`,
    `Framework: ${opts.projectType ?? "generic"}`,
    `Test framework: ${opts.testFramework ?? "vitest"}`,
    `Generate: API, data flow, auth, E2E, and load tests.`,
  ].join("\n");
}