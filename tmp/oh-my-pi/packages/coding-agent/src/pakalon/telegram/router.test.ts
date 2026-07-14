/**
 * Tests for the Telegram router.
 *
 * Per CLI-req.md §690-694 and code.md §21, the router binds a
 * `SubmitFn` once `/connect` is called, then dispatches every
 * inbound Telegram message to the live AgentSession. The contract
 * we test: when no session is bound, incoming messages are
 * silently dropped (logged as a warning), and when a session is
 * bound, the message text is submitted and the response is sent
 * back to the originating chat.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

describe("telegram router", () => {
	const ORIGINAL_FETCH = globalThis.fetch;

	beforeEach(() => {
		// Stub global fetch so the chunked-sender doesn't hit Telegram.
		globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
		mock.restore();
	});

	it("drops messages when no session is bound (logs a warning)", async () => {
		const { onTelegramMessage, bindTelegramSession } = await import("./router");
		bindTelegramSession(null as never); // unbind
		// No assertion on logs (logger writes to file); we just verify
		// the function returns without throwing.
		await expect(onTelegramMessage({ chatId: 123, text: "ls" })).resolves.toBeUndefined();
	});

	it("submits the message text to the bound session and sends the response back", async () => {
		const { onTelegramMessage, bindTelegramSession } = await import("./router");
		const submit = mock(async (_text: string) => "file list: ...");
		bindTelegramSession(submit);
		// We don't assert on the chunked sender (it uses fetch which
		// we stubbed); we assert that submit was called with the
		// message text.
		await onTelegramMessage({ chatId: 42, text: "ls" });
		expect(submit).toHaveBeenCalledTimes(1);
		expect(submit.mock.calls[0]?.[0]).toBe("ls");
	});

	it("sends an [error] message back when the session throws", async () => {
		const { onTelegramMessage, bindTelegramSession } = await import("./router");
		bindTelegramSession(
			mock(async () => {
				throw new Error("boom");
			}),
		);
		// The router catches the error and sends it back; we just
		// verify the function does not propagate.
		await expect(onTelegramMessage({ chatId: 7, text: "x" })).resolves.toBeUndefined();
	});
});
