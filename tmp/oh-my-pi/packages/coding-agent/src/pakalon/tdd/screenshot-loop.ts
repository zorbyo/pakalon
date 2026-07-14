/**
 * Test-driven development screenshot loop for Pakalon.
 *
 * Used by phase 2 and phase 3: render the output (SVG wireframe
 * or live frontend), capture a screenshot, and ask the LLM to
 * compare the screenshot against the requirement. If the match is
 * < threshold, regenerate.
 *
 * Uses the existing `tools/inspect-image.ts` for the visual
 * comparison (which itself calls the configured vision model).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLM } from "../llm/invoker";

const TDD_PROMPTS = {
	wireframe: `You are a strict visual reviewer. The image is a generated wireframe. Compare it against the requirement list. For each requirement return either "PASS" or "FAIL" with a one-line reason. Then return a single final verdict on the last line as "VERDICT: PASS" or "VERDICT: FAIL".`,
	frontend: `You are a strict visual reviewer. The image is a live frontend screenshot. Compare it against the requirement list. Return a "PASS"/"FAIL" line per requirement, then a final line "VERDICT: PASS" or "VERDICT: FAIL".`,
} as const;

export interface TDDResult {
	pass: boolean;
	notes: string;
	verdict: "PASS" | "FAIL";
}

/**
 * Load an image file (PNG/JPEG) and submit it to the LLM via
 * the multimodal `invokePhaseLLM` path. The result is a structured
 * `TDDResult`.
 */
export async function reviewScreenshot(
	screenshotPath: string,
	requirement: string,
	kind: keyof typeof TDD_PROMPTS = "wireframe",
): Promise<TDDResult> {
	if (!fs.existsSync(screenshotPath)) {
		throw new Error(`screenshot not found: ${screenshotPath}`);
	}
	const bytes = fs.readFileSync(screenshotPath);
	const base64 = bytes.toString("base64");
	const dataUri = `data:image/${path.extname(screenshotPath).slice(1) || "png"};base64,${base64}`;
	const userPrompt = JSON.stringify({ screenshot: dataUri, requirement });
	const result = await invokePhaseLLM(TDD_PROMPTS[kind], userPrompt, { cwd: process.cwd(), phase: "phase-2" });
	const verdictMatch = result.text.match(/VERDICT:\s*(PASS|FAIL)/i);
	const verdict = (verdictMatch?.[1]?.toUpperCase() ?? "FAIL") as "PASS" | "FAIL";
	return {
		pass: verdict === "PASS",
		notes: result.text,
		verdict,
	};
}

/**
 * Capture a screenshot of `url` using a real headless browser and
 * write the PNG to `outPath`. Tries in order:
 *   1. `playwright` (if installed and on PATH)
 *   2. `chromium` / `chrome` / `chrome-headless-shell` (if on PATH)
 *   3. `chromium-browser` via the headless CLI flags
 *
 * Returns `true` on success, `false` if no browser was found. The
 * caller is expected to fall back to its own static-render path on
 * `false`.
 */
export async function captureScreenshot(
	url: string,
	outPath: string,
	opts: { viewport?: { width: number; height: number }; fullPage?: boolean } = {},
): Promise<boolean> {
	const { width = 1440, height = 900 } = opts.viewport ?? {};
	const fullPage = opts.fullPage ?? false;
	const args = [
		"--headless",
		"--disable-gpu",
		"--no-sandbox",
		`--window-size=${width},${height}`,
		`--screenshot=${outPath}`,
	];
	if (fullPage) args.push("--full-page-screenshot");
	// Try playwright first (the canonical Pakalon browser tool).
	const playwright = Bun.which("playwright");
	if (playwright) {
		const proc = Bun.spawn([playwright, "screenshot", ...(fullPage ? ["--full-page"] : []), url, outPath], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exit = await proc.exited;
		if (exit === 0 && fs.existsSync(outPath)) return true;
	}
	// Fall back to the system Chrome/Chromium headless.
	for (const browser of ["chrome", "chromium", "chromium-browser", "google-chrome", "chrome-headless-shell"]) {
		const path = Bun.which(browser);
		if (!path) continue;
		try {
			const proc = Bun.spawn([path, ...args, url], { stdout: "ignore", stderr: "ignore" });
			const exit = await proc.exited;
			if (exit === 0 && fs.existsSync(outPath)) return true;
		} catch {
			/* try next browser */
		}
	}
	return false;
}

/**
 * Run the TDD loop: render, screenshot, review, regenerate. Up
 * to `maxAttempts` attempts; returns the last screenshot path
 * + the review notes.
 */
export interface TDDLoopOptions {
	outDir: string;
	requirement: string;
	render: (attempt: number, outDir: string) => Promise<string>;
	kind?: keyof typeof TDD_PROMPTS;
	maxAttempts?: number;
	/**
	 * Optional URL to render in a real headless browser. When
	 * provided, `captureScreenshot` is invoked before the LLM review
	 * to produce a real PNG screenshot. The `render` callback is
	 * still invoked first; the browser screenshot is layered on top
	 * of whatever the callback wrote.
	 */
	browserUrl?: string;
}

export interface TDDLoopResult {
	screenshot: string;
	review: TDDResult;
	attempts: number;
	passed: boolean;
}

/**
 * Run a TDD loop with a custom `render` callback. The callback
 * is invoked on each attempt to produce the next screenshot.
 *
 * If `opts.browserUrl` is set, a real headless browser is also
 * invoked (`captureScreenshot`) to produce a second screenshot
 * per attempt. The browser PNG becomes the artifact the LLM
 * reviews; the callback's screenshot stays on disk for the human
 * reviewer.
 */
export async function runTDDLoop(opts: TDDLoopOptions): Promise<TDDLoopResult> {
	fs.mkdirSync(opts.outDir, { recursive: true });
	const max = opts.maxAttempts ?? 3;
	let lastReview: TDDResult = { pass: false, notes: "", verdict: "FAIL" };
	let lastScreenshot = "";
	for (let i = 1; i <= max; i++) {
		const screenshot = await opts.render(i, opts.outDir);
		lastScreenshot = screenshot;
		// If the caller supplied a browser URL, take a real
		// headless-browser screenshot too and use that for the LLM
		// review (the static SVG/HTML is only useful for static
		// visual comparison; the browser screenshot is the real
		// production view).
		let reviewTarget = screenshot;
		if (opts.browserUrl) {
			const browserShot = path.join(opts.outDir, `attempt-${i}.png`);
			const ok = await captureScreenshot(opts.browserUrl, browserShot);
			if (ok && fs.existsSync(browserShot)) {
				reviewTarget = browserShot;
			}
		}
		lastReview = await reviewScreenshot(reviewTarget, opts.requirement, opts.kind ?? "wireframe");
		if (lastReview.pass) {
			logger.info("tdd: pass", { attempt: i, usedBrowser: reviewTarget !== screenshot });
			return { screenshot: reviewTarget, review: lastReview, attempts: i, passed: true };
		}
		logger.warn("tdd: fail, regenerating", { attempt: i, notes: lastReview.notes.slice(0, 200) });
	}
	return { screenshot: lastScreenshot, review: lastReview, attempts: max, passed: false };
}
