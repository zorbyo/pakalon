import { describe, expect, it } from "vitest";
import type { CoreMessage } from "ai";

import {
  canAttemptAutoCompact,
  createAutoCompactTrackingState,
  recordAutoCompactFailure,
  recordAutoCompactSuccess,
} from "@/ai/auto-compaction.js";
import { collapseSearchReadSequences } from "@/ai/context-collapse.js";
import { estimateMessagesTokens } from "@/ai/context.js";
import { microcompactMessages } from "@/ai/microcompact.js";
import { snipCompactIfNeeded } from "@/ai/snip.js";
import { buildTokenEfficientMessages } from "@/ai/token-budget.js";

function toolResultMessage(toolName: string, content: string, id: string): CoreMessage {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        toolName,
        toolUseId: id,
        content,
      },
    ],
  } as CoreMessage;
}

describe("context reduction layers", () => {
  it("microcompacts old tool results while keeping the newest results intact", () => {
    const messages = [
      toolResultMessage("readFile", "old result ".repeat(100), "old-1"),
      toolResultMessage("readFile", "new result ".repeat(100), "new-1"),
    ];

    const result = microcompactMessages(messages, {
      keepLatestToolResults: 1,
      minResultChars: 10,
    });

    expect(result.changed).toBe(true);
    expect(result.clearedResults).toBe(1);
    expect(result.cacheEditToolUseIds).toEqual(["old-1"]);

    const oldContent = (result.messages[0] as { content: Array<{ content: string }> }).content[0]?.content;
    const newContent = (result.messages[1] as { content: Array<{ content: string }> }).content[0]?.content;
    expect(oldContent).toContain("cleared by microcompact");
    expect(newContent).toContain("new result");
  });

  it("collapses repeated search/read sequences but keeps the latest item expanded", () => {
    const messages = [
      toolResultMessage("grepSearch", "match a\n".repeat(300), "grep-1"),
      toolResultMessage("readFile", "file body\n".repeat(300), "read-1"),
      toolResultMessage("listDir", "entry\n".repeat(300), "list-1"),
    ];

    const result = collapseSearchReadSequences(messages, {
      minSequenceLength: 3,
      maxInlineChars: 240,
    });

    expect(result.changed).toBe(true);
    expect(result.collapsedMessages).toBe(2);
    expect(String((result.messages[0] as { content: unknown }).content)).toContain("Collapsed search/read result");
    expect(JSON.stringify(result.messages[2])).toContain("entry");
  });

  it("snips oldest API rounds and preserves system messages", () => {
    const messages: CoreMessage[] = [
      { role: "system", content: "Keep this system instruction." } as CoreMessage,
      ...Array.from({ length: 8 }, (_, index) => [
        { role: "user", content: `question ${index} ${"x".repeat(500)}` } as CoreMessage,
        { role: "assistant", content: `answer ${index} ${"y".repeat(500)}` } as CoreMessage,
      ]).flat(),
    ];

    const result = snipCompactIfNeeded(messages, {
      maxTokens: 800,
      keepLatestGroups: 2,
    });

    expect(result.changed).toBe(true);
    expect(result.messages[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(result.messages)).toContain("earlier conversation truncated");
    expect(JSON.stringify(result.messages)).toContain("question 7");
    expect(JSON.stringify(result.messages)).not.toContain("question 0");
  });

  it("builds a smaller model request with layered reductions", () => {
    const messages: CoreMessage[] = [
      { role: "system", content: "system" } as CoreMessage,
      ...Array.from({ length: 10 }, (_, index) =>
        toolResultMessage("readFile", `file ${index}\n${"0123456789\n".repeat(1_000)}`, `read-${index}`),
      ),
      { role: "user", content: "Summarize the latest findings." } as CoreMessage,
    ];

    const before = estimateMessagesTokens(messages);
    const reduced = buildTokenEfficientMessages(messages, 5_000, true);
    const after = estimateMessagesTokens(reduced);

    expect(after).toBeLessThan(before);
    expect(JSON.stringify(reduced)).toContain("Summarize the latest findings");
  });

  it("stops auto-compaction retries after repeated failures and resets after success", () => {
    let state = createAutoCompactTrackingState();

    state = recordAutoCompactFailure(state, "one");
    state = recordAutoCompactFailure(state, "two");
    expect(canAttemptAutoCompact(state)).toBe(true);

    state = recordAutoCompactFailure(state, "three");
    expect(canAttemptAutoCompact(state)).toBe(false);

    state = recordAutoCompactSuccess(state);
    expect(canAttemptAutoCompact(state)).toBe(true);
    expect(state.consecutiveFailures).toBe(0);
  });
});
