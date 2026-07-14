/**
 * Tests for the CLI flag parser.
 *
 * Per CLI-req.md Appendix B and code.md §28, the CLI must accept
 * the canonical short/long flag pairs:
 *   -h, --help
 *   -v, --version
 *   -r, --resume
 *   -c, --continue
 *   -p, --print
 * and the 4 short permission-mode aliases:
 *   -plan, -edit, -auto-accept, -bypass-permissions
 */
import { describe, expect, it } from "bun:test";
import { parseArgs } from "./args";

describe("CLI flag parser", () => {
	describe("short flag pairs", () => {
		it("-h sets help", () => {
			const r = parseArgs(["-h"]);
			expect(r.help).toBe(true);
		});
		it("--help sets help", () => {
			const r = parseArgs(["--help"]);
			expect(r.help).toBe(true);
		});
		it("-v sets version", () => {
			const r = parseArgs(["-v"]);
			expect(r.version).toBe(true);
		});
		it("--version sets version", () => {
			const r = parseArgs(["--version"]);
			expect(r.version).toBe(true);
		});
		it("-c sets continue", () => {
			const r = parseArgs(["-c"]);
			expect(r.continue).toBe(true);
		});
		it("--continue sets continue", () => {
			const r = parseArgs(["--continue"]);
			expect(r.continue).toBe(true);
		});
		it("-p sets print", () => {
			const r = parseArgs(["-p", "hello"]);
			expect(r.print).toBe(true);
			expect(r.messages).toContain("hello");
		});
		it("--print sets print", () => {
			const r = parseArgs(["--print", "hello"]);
			expect(r.print).toBe(true);
		});
		it("-r resumes the most recent session", () => {
			const r = parseArgs(["-r"]);
			expect(r.resume).toBe(true);
		});
		it("-r with id resumes a specific session", () => {
			const r = parseArgs(["-r", "ses_abc"]);
			expect(r.resume).toBe("ses_abc");
		});
		it("--resume with id resumes a specific session", () => {
			const r = parseArgs(["--resume", "ses_abc"]);
			expect(r.resume).toBe("ses_abc");
		});
	});

	describe("permission-mode shortcuts", () => {
		it("-plan sets plan mode", () => {
			const r = parseArgs(["-plan"]);
			expect(r.permissionMode).toBe("plan");
		});
		it("-edit sets edit mode", () => {
			const r = parseArgs(["-edit"]);
			expect(r.permissionMode).toBe("edit");
		});
		it("-auto-accept sets auto-accept mode", () => {
			const r = parseArgs(["-auto-accept"]);
			expect(r.permissionMode).toBe("auto-accept");
		});
		it("-bypass-permissions sets bypass mode", () => {
			const r = parseArgs(["-bypass-permissions"]);
			expect(r.permissionMode).toBe("bypass");
		});
		it("--permission-mode takes a value", () => {
			const r = parseArgs(["--permission-mode", "bypass"]);
			expect(r.permissionMode).toBe("bypass");
		});
	});

	describe("model + provider flags", () => {
		it("--model sets the model", () => {
			const r = parseArgs(["--model", "anthropic/claude-sonnet-4"]);
			expect(r.model).toBe("anthropic/claude-sonnet-4");
		});
		it("--provider sets the provider", () => {
			const r = parseArgs(["--provider", "openai"]);
			expect(r.provider).toBe("openai");
		});
		it("--smol / --short set the smol model", () => {
			const r = parseArgs(["--smol", "anthropic/claude-haiku"]);
			expect(r.smol).toBe("anthropic/claude-haiku");
		});
		it("--slow sets the slow model", () => {
			const r = parseArgs(["--slow", "anthropic/claude-opus"]);
			expect(r.slow).toBe("anthropic/claude-opus");
		});
	});

	describe("MCP", () => {
		it("--MCP is alias for --mcp-config", () => {
			const r = parseArgs(["--MCP", "playwright"]);
			expect(r.hooks).toContain("playwright");
		});
		it("--mcp-config takes a value", () => {
			const r = parseArgs(["--mcp-config", "chrome-devtools"]);
			expect(r.hooks).toContain("chrome-devtools");
		});
	});

	describe("selfhost", () => {
		it("--selfhost sets selfhost", () => {
			const r = parseArgs(["--selfhost"]);
			expect(r.selfhost).toBe(true);
		});
	});

	describe("positional messages", () => {
		it("collects non-flag tokens into messages", () => {
			const r = parseArgs(["hello", "world"]);
			expect(r.messages).toEqual(["hello", "world"]);
		});
	});
});
