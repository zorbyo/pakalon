import { describe, expect, it } from "vitest";
import { normalizeMessagesForAPI } from "./messages";

describe("normalizeMessagesForAPI", () => {
	it("strips progress messages", () => {
		const input = [
			{ role: "user", content: "hello" },
			{ role: "progress", content: "typing..." },
			{ role: "assistant", content: "hi" },
		] as const;

		const result = normalizeMessagesForAPI(input);

		expect(result).toHaveLength(2);
		expect(result.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("preserves user assistant and system messages", () => {
		const input = [
			{ role: "user", content: "hello" },
			{ role: "system", content: "keep me", type: "compact-boundary" },
			{ role: "assistant", content: "hi" },
		] as const;

		const result = normalizeMessagesForAPI(input);

		expect(result).toHaveLength(3);
		expect(result.map((message) => message.role)).toEqual(["user", "system", "assistant"]);
	});

	it("handles empty array", () => {
		expect(normalizeMessagesForAPI([])).toEqual([]);
	});

	it("preserves compact metadata with boundary markers", () => {
		const input = [
			{
				role: "assistant",
				content: "summary",
				uuid: "msg-1",
				compactMetadata: {
					uuid: "compact-1",
					kind: "summary",
					summary: "session compacted",
				},
				isCompactSummary: true,
			},
		] as const;

		const result = normalizeMessagesForAPI(input);

		expect(result).toHaveLength(3);
		expect(result[0]?.role).toBe("system");
		expect(result[1]?.role).toBe("assistant");
		expect(result[2]?.role).toBe("system");
	});
});
