/**
 * Tests for per-project session scoping.
 *
 * Per CLI-req.md §520 / code.md §11, sessions are per-project-directory.
 * The sessions are stored under `<cwd>/.pakalon/sessions/<id>.json`,
 * so two different cwds must never see each other's sessions.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("per-project session scoping", () => {
	let cwdA: string;
	let cwdB: string;

	beforeEach(async () => {
		cwdA = mkdtempSync(join(tmpdir(), "pakalon-sess-a-"));
		cwdB = mkdtempSync(join(tmpdir(), "pakalon-sess-b-"));
	});

	afterEach(() => {
		rmSync(cwdA, { recursive: true, force: true });
		rmSync(cwdB, { recursive: true, force: true });
	});

	it("scopes sessions to the project cwd", async () => {
		const { createSession, listSessions, getSession } = await import("./sessions");
		const a = createSession(cwdA, "Project A", "anthropic/claude-sonnet-4");
		const b = createSession(cwdB, "Project B", "openai/gpt-4o");

		const listA = listSessions(cwdA);
		const listB = listSessions(cwdB);

		expect(listA).toHaveLength(1);
		expect(listA[0]?.id).toBe(a.id);
		expect(listB).toHaveLength(1);
		expect(listB[0]?.id).toBe(b.id);

		// Cross-project lookup must return null.
		expect(getSession(cwdA, b.id)).toBeNull();
		expect(getSession(cwdB, a.id)).toBeNull();
	});

	it("persists messages within a session and across save/load", async () => {
		const { createSession, addMessage, getMessages, getSession } = await import("./sessions");
		const s = createSession(cwdA, "chat");
		addMessage(cwdA, s.id, "user", "hello", { tokensUsed: 10 });
		addMessage(cwdA, s.id, "assistant", "world", { tokensUsed: 12 });

		const reloaded = getSession(cwdA, s.id);
		const msgs = getMessages(cwdA, s.id);
		expect(msgs).toHaveLength(2);
		expect(reloaded?.totalTokens).toBe(22);
	});
});
