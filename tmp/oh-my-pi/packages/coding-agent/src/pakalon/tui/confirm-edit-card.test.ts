/**
 * Tests for the confirm-edit TUI card.
 *
 * Per CLI-req.md §225 and code.md §7.3, after the frontend sub-agent
 * (SA1) emits a milestone, the TUI shows a 2-button card. In YOLO
 * mode the card is auto-confirmed; in HIL mode the TUI event loop
 * resolves the choice.
 */
import { describe, expect, it } from "bun:test";
import { applyConfirmEditChoice, renderConfirmEditCard, resolveConfirmEdit } from "./confirm-edit-card";

describe("confirm-edit card", () => {
	describe("resolveConfirmEdit", () => {
		it("auto-confirms in YOLO mode", () => {
			expect(resolveConfirmEdit({ agentId: "SA1", summary: "ok", mode: "YOLO" })).toBe("confirm");
		});

		it("defers (skip) in HIL mode by default", () => {
			expect(resolveConfirmEdit({ agentId: "SA1", summary: "ok", mode: "HIL" })).toBe("skip");
		});
	});

	describe("applyConfirmEditChoice", () => {
		it("maps enter / y / c / 'confirm' to confirm", () => {
			expect(applyConfirmEditChoice("")).toBe("confirm");
			expect(applyConfirmEditChoice("y")).toBe("confirm");
			expect(applyConfirmEditChoice("c")).toBe("confirm");
			expect(applyConfirmEditChoice("confirm")).toBe("confirm");
		});

		it("maps m / make-changes to make-changes", () => {
			expect(applyConfirmEditChoice("m")).toBe("make-changes");
			expect(applyConfirmEditChoice("M")).toBe("make-changes");
			expect(applyConfirmEditChoice("make changes")).toBe("make-changes");
		});

		it("maps a / abort to abort", () => {
			expect(applyConfirmEditChoice("a")).toBe("abort");
			expect(applyConfirmEditChoice("abort")).toBe("abort");
		});

		it("falls through to skip for unknown input", () => {
			expect(applyConfirmEditChoice("??")).toBe("skip");
		});
	});

	describe("renderConfirmEditCard", () => {
		it("renders the agent id and summary in the card", () => {
			const text = renderConfirmEditCard({
				agentId: "SA1",
				summary: "Frontend complete",
				mode: "HIL",
			});
			expect(text).toContain("SA1");
			expect(text).toContain("Frontend complete");
			expect(text).toContain("Confirm edit");
			expect(text).toContain("Make changes");
		});

		it("lists changed files when provided", () => {
			const text = renderConfirmEditCard({
				agentId: "SA1",
				summary: "ok",
				mode: "HIL",
				changedFiles: ["src/foo.ts", "src/bar.ts"],
			});
			expect(text).toContain("src/foo.ts");
			expect(text).toContain("src/bar.ts");
		});
	});
});
