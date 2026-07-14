/**
 * Tests for the at-rest API key encryption.
 *
 * Per code.md §4, the API key in `auth.json` is encrypted with a
 * machine-specific AES-256-CBC key so the on-disk file is not
 * readable without the host's hostname + username.
 */
import { describe, expect, it } from "bun:test";
import { apiKeyDecrypt, apiKeyEncrypt } from "./openrouter-auth";

describe("apiKeyEncrypt / apiKeyDecrypt", () => {
	it("round-trips a value", () => {
		const original = "sk-or-v1-abc123def456";
		const encrypted = apiKeyEncrypt(original);
		expect(encrypted).not.toBe(original);
		expect(encrypted).toContain(":");
		const decrypted = apiKeyDecrypt(encrypted);
		expect(decrypted).toBe(original);
	});

	it("produces a different ciphertext on each call (random IV)", () => {
		const original = "sk-or-v1-test";
		const a = apiKeyEncrypt(original);
		const b = apiKeyEncrypt(original);
		// Random IV means the same plaintext produces different ciphertexts.
		expect(a).not.toBe(b);
		// Both still decrypt to the original.
		expect(apiKeyDecrypt(a)).toBe(original);
		expect(apiKeyDecrypt(b)).toBe(original);
	});

	it("falls back to plaintext for legacy values without iv prefix", () => {
		// Older builds may have stored the key unencrypted. The decrypt
		// path must accept that input unchanged.
		const legacy = "sk-or-v1-legacy-key";
		expect(apiKeyDecrypt(legacy)).toBe(legacy);
	});
});
