import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface TddResult {
	passed: boolean;
	attempts: number;
	screenshots: string[];
	error?: string;
}

export interface TddOptions {
	maxAttempts: number;
	outputDir: string;
	svgPath: string;
}

export class TddScreenshotCapture {
	async captureScreenshots(options: TddOptions): Promise<TddResult> {
		logger.info("TDD: Starting screenshot capture", {
			svgPath: options.svgPath,
			outputDir: options.outputDir,
		});

		const result: TddResult = {
			passed: false,
			attempts: 0,
			screenshots: [],
		};

		if (!fs.existsSync(options.svgPath)) {
			result.error = `SVG file not found: ${options.svgPath}`;
			logger.warn(result.error);
			return result;
		}

		const svgContent = fs.readFileSync(options.svgPath, "utf-8");
		fs.mkdirSync(options.outputDir, { recursive: true });

		let success = false;
		for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
			result.attempts = attempt;
			const screenshotName = `screenshot-${Date.now()}-attempt-${attempt}.png`;
			const screenshotPath = path.join(options.outputDir, screenshotName);

			try {
				const htmlContent = this.#buildHtmlPage(svgContent);
				const htmlPath = path.join(options.outputDir, `__temp-${Date.now()}.html`);
				fs.writeFileSync(htmlPath, htmlContent);

				const captured = await this.#renderWithPlaywright(htmlPath, screenshotPath);
				fs.unlinkSync(htmlPath);

				if (captured) {
					result.screenshots.push(screenshotPath);
					logger.info(`TDD: Screenshot captured on attempt ${attempt}`, { path: screenshotPath });
					success = true;
					break;
				}
			} catch (err) {
				logger.warn(`TDD: Screenshot attempt ${attempt} failed`, { error: String(err) });
			}
		}

		result.passed = success;
		logger.info("TDD: Screenshot capture completed", {
			passed: success,
			attempts: result.attempts,
			screenshots: result.screenshots.length,
		});

		return result;
	}

	#buildHtmlPage(svgContent: string): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wireframe Preview</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #f8fafc; display: flex; justify-content: center; padding: 20px; }
  svg { max-width: 1240px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-radius: 8px; }
</style>
</head>
<body>
${svgContent}
</body>
</html>`;
	}

	async #renderWithPlaywright(htmlPath: string, outputPath: string): Promise<boolean> {
		const hasPlaywright = await this.#detectPlaywright();
		if (!hasPlaywright) {
			return this.#renderWithBrowser(htmlPath, outputPath);
		}

		try {
			const { chromium } = await import("playwright");
			const browser = await chromium.launch({ headless: true });
			const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
			await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
			await page.screenshot({ path: outputPath, fullPage: true });
			await browser.close();
			return fs.existsSync(outputPath);
		} catch (err) {
			logger.warn("Playwright screenshot failed, trying browser fallback", { error: String(err) });
			return this.#renderWithBrowser(htmlPath, outputPath);
		}
	}

	async #renderWithBrowser(htmlPath: string, outputPath: string): Promise<boolean> {
		try {
			const { $ } = await import("bun");
			const result = await $`npx playwright screenshot file://${htmlPath} ${outputPath} --full-page`
				.quiet()
				.nothrow();
			return result.exitCode === 0 && fs.existsSync(outputPath);
		} catch {
			return false;
		}
	}

	async #detectPlaywright(): Promise<boolean> {
		try {
			const resolved = await import.meta.resolve?.("playwright");
			return !!resolved;
		} catch {
			return false;
		}
	}
}

export function generateSyncJsScript(): string {
	return `#!/usr/bin/env node

// Pakalon Penpot Sync Bridge
// Watches local wireframe files and syncs changes to Penpot via WebSocket

const fs = require("fs");
const path = require("path");
const http = require("http");

const PHASE2_DIR = path.join(process.cwd(), ".pakalon-agents", "ai-agents", "phase-2");
const PENPOT_HOST = process.env.PENPOT_HOST || "http://localhost:3449";
const PENPOT_TOKEN = process.env.PENPOT_API_TOKEN || "";
const SYNC_PORT = parseInt(process.env.SYNC_PORT || "41789", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "3000", 10);

let lastSvgContent = "";
let lastPenpotContent = "";
let isSyncing = false;

function log(msg) {
	const ts = new Date().toISOString();
	console.log(\`[sync.js \${ts}] \${msg}\`);
}

function readFileSafe(filePath) {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

async function syncToPenpot(svgContent) {
	if (!PENPOT_TOKEN || isSyncing) return;
	isSyncing = true;
	try {
		const url = new URL("/api/v1/files/import", PENPOT_HOST);
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: \`Bearer \${PENPOT_TOKEN}\`,
			},
			body: JSON.stringify({
				name: "Pakalon Wireframe Sync",
				content: svgContent,
				format: "svg",
			}),
		});
		if (response.ok) {
			log("Synced wireframe to Penpot successfully");
			lastPenpotContent = svgContent;
		} else {
			log(\`Penpot sync failed: \${response.status} \${response.statusText}\`);
		}
	} catch (err) {
		log(\`Penpot sync error: \${err.message}\`);
	}
	isSyncing = false;
}

function pollWireframes() {
	const svgPath = path.join(PHASE2_DIR, "Wireframe_generated.svg");
	const penpotPath = path.join(PHASE2_DIR, "Wireframe_generated.penpot");

	const svgContent = readFileSafe(svgPath);
	const penpotContent = readFileSafe(penpotPath);

	if (svgContent && svgContent !== lastSvgContent) {
		log("Local wireframe changed, syncing to Penpot...");
		syncToPenpot(svgContent);
	}

	if (penpotContent && penpotContent !== lastPenpotContent) {
		log("Penpot file changed locally");
		lastPenpotContent = penpotContent;
	}
}

// Start file watcher
log(\`Sync bridge starting - watching \${PHASE2_DIR}\`);
log(\`Penpot host: \${PENPOT_HOST}\`);
log(\`Poll interval: \${POLL_INTERVAL}ms\`);

// Initial read
const svgContent = readFileSafe(path.join(PHASE2_DIR, "Wireframe_generated.svg"));
if (svgContent) {
	lastSvgContent = svgContent;
}

// Poll for changes
const pollTimer = setInterval(pollWireframes, POLL_INTERVAL);

// HTTP health endpoint
const server = http.createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "running", phase2Dir: PHASE2_DIR, penpotHost: PENPOT_HOST }));
		return;
	}
	res.writeHead(404);
	res.end("Not found");
});

server.listen(SYNC_PORT, () => {
	log(\`Sync bridge HTTP server running on port \${SYNC_PORT}\`);
	log(\`Health check: http://localhost:\${SYNC_PORT}/health\`);
});

// Graceful shutdown
process.on("SIGINT", () => {
	log("Shutting down sync bridge...");
	clearInterval(pollTimer);
	server.close();
	process.exit(0);
});

process.on("SIGTERM", () => {
	log("Shutting down sync bridge...");
	clearInterval(pollTimer);
	server.close();
	process.exit(0);
});
`;
}
