import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface CdpTarget {
	id: string;
	url: string;
	title: string;
	type: "page" | "background_page" | "service_worker" | "other";
}

export interface ScreenshotResult {
	success: boolean;
	data?: Buffer;
	path?: string;
}

export interface ConsoleEntry {
	level: "log" | "info" | "warn" | "error";
	text: string;
	timestamp: number;
}

export interface TestResult {
	name: string;
	passed: boolean;
	message: string;
}

export interface ChromeDevToolsOptions {
	port?: number;
	headless?: boolean;
	chromePath?: string;
	userDataDir?: string;
	args?: string[];
}

export interface PageTestOptions {
	url: string;
	viewport?: { width: number; height: number };
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	timeout?: number;
}

export class ChromeDevTools {
	#port: number;
	#headless: boolean;
	#chromePath: string;
	#userDataDir: string;
	#extraArgs: string[];
	#process: import("bun").Subprocess | null = null;
	#cdpWsUrl: string | null = null;
	#consoleEntries: ConsoleEntry[] = [];
	#ws: import("bun").WebSocket | null = null;
	#messageId = 0;
	#pendingResponses: Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = new Map();

	static readonly DEFAULT_PORT = 9222;

	constructor(options: ChromeDevToolsOptions = {}) {
		this.#port = options.port ?? ChromeDevTools.DEFAULT_PORT;
		this.#headless = options.headless ?? true;
		this.#chromePath = options.chromePath ?? this.#findChrome();
		this.#userDataDir = options.userDataDir ?? path.join(process.cwd(), ".pakalon", "chrome-data");
		this.#extraArgs = options.args ?? [];
	}

	async launch(): Promise<void> {
		if (this.#process) {
			logger.info("Chrome already running", { port: this.#port });
			return;
		}

		const args = [
			`--remote-debugging-port=${this.#port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-extensions",
			"--disable-background-networking",
			"--disable-sync",
			"--disable-translate",
			`--user-data-dir=${this.#userDataDir}`,
			...this.#extraArgs,
		];

		if (this.#headless) {
			args.push("--headless=new");
		}

		fs.mkdirSync(this.#userDataDir, { recursive: true });

		logger.info("Launching Chrome", { port: this.#port, headless: this.#headless });

		this.#process = Bun.spawn([this.#chromePath, ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		this.#process.unref();

		await this.#waitForDebugger();
		await this.#connectWebSocket();
	}

	async close(): Promise<void> {
		if (this.#ws) {
			try {
				this.#ws.close();
			} catch {
				/* ignore */
			}
			this.#ws = null;
		}

		if (this.#process) {
			try {
				this.#process.kill("SIGTERM");
				await Bun.sleep(2000);
				if (this.#process.killed) {
					this.#process.kill("SIGKILL");
				}
			} catch {
				/* ignore */
			}
			this.#process = null;
		}

		this.#consoleEntries = [];
		this.#cdpWsUrl = null;
	}

	async listTargets(): Promise<CdpTarget[]> {
		const resp = await fetch(`http://127.0.0.1:${this.#port}/json`);
		const data = (await resp.json()) as Array<{
			id: string;
			url: string;
			title: string;
			type: string;
		}>;
		return data.map(t => ({
			id: t.id,
			url: t.url,
			title: t.title,
			type: this.#mapTargetType(t.type),
		}));
	}

	async navigateToPage(options: PageTestOptions): Promise<TestResult[]> {
		await this.#ensurePageTarget();
		const results: TestResult[] = [];

		const navResult = await this.#sendCdpCommand("Page.enable", {});
		if (!navResult) {
			results.push({ name: "Page.navigate", passed: false, message: "Failed to enable Page domain" });
			return results;
		}

		await this.#sendCdpCommand("Page.navigate", { url: options.url });
		results.push({ name: "Page.navigate", passed: true, message: `Navigated to ${options.url}` });

		if (options.viewport) {
			await this.#sendCdpCommand("Emulation.setDeviceMetricsOverride", {
				width: options.viewport.width,
				height: options.viewport.height,
				deviceScaleFactor: 1,
				mobile: false,
			});
		}

		await this.#sendCdpCommand("Runtime.enable", {});
		results.push({ name: "Runtime.enable", passed: true, message: "Runtime domain enabled" });

		return results;
	}

	async captureScreenshot(outputPath?: string): Promise<ScreenshotResult> {
		const result = (await this.#sendCdpCommand("Page.captureScreenshot", {
			format: "png",
			fromSurface: true,
		})) as { data?: string } | null;

		if (!result?.data) {
			return { success: false };
		}

		const buf = Buffer.from(result.data, "base64");

		if (outputPath) {
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, buf);
		}

		return { success: true, data: buf, path: outputPath };
	}

	getConsoleEntries(): ConsoleEntry[] {
		return [...this.#consoleEntries];
	}

	clearConsole(): void {
		this.#consoleEntries = [];
	}

	isRunning(): boolean {
		return this.#process !== null && this.#process.killed === false;
	}

	port(): number {
		return this.#port;
	}

	async evaluate(expression: string): Promise<unknown> {
		const result = (await this.#sendCdpCommand("Runtime.evaluate", {
			expression,
			returnByValue: true,
		})) as { result?: { value?: unknown; type?: string } } | null;

		return result?.result?.value;
	}

	#findChrome(): string {
		const candidates: string[] = [];

		if (process.platform === "win32") {
			candidates.push(
				"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
				"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
				path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
				path.join(process.env.PROGRAMFILES ?? "", "Google\\Chrome\\Application\\chrome.exe"),
			);
		} else if (process.platform === "darwin") {
			candidates.push(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				path.join(process.env.HOME ?? "", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
			);
		} else {
			candidates.push(
				"/usr/bin/google-chrome",
				"/usr/bin/chromium",
				"/usr/bin/chromium-browser",
				"/snap/bin/chromium",
			);
		}

		for (const candidate of candidates) {
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				/* try next */
			}
		}

		return "google-chrome";
	}

	async #waitForDebugger(maxWaitMs = 15000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < maxWaitMs) {
			try {
				const resp = await fetch(`http://127.0.0.1:${this.#port}/json/version`);
				if (resp.ok) {
					const data = (await resp.json()) as { webSocketDebuggerUrl?: string };
					if (data.webSocketDebuggerUrl) {
						this.#cdpWsUrl = data.webSocketDebuggerUrl;
						return;
					}
				}
			} catch {
				/* not ready yet */
			}
			await Bun.sleep(200);
		}
		throw new Error(`Chrome DevTools did not start within ${maxWaitMs}ms on port ${this.#port}`);
	}

	async #connectWebSocket(): Promise<void> {
		if (!this.#cdpWsUrl) {
			throw new Error("No WebSocket debugger URL available");
		}

		return new Promise((resolve, reject) => {
			const ws = new WebSocket(this.#cdpWsUrl!);

			ws.onopen = () => {
				logger.info("CDP WebSocket connected");
				resolve();
			};

			ws.onerror = err => {
				logger.error("CDP WebSocket error", { error: err });
				reject(err);
			};

			ws.onmessage = event => {
				try {
					const msg = JSON.parse(event.data as string) as Record<string, unknown>;
					if (msg.id !== undefined && typeof msg.id === "number") {
						const pending = this.#pendingResponses.get(msg.id);
						if (pending) {
							this.#pendingResponses.delete(msg.id);
							if (msg.error) {
								pending.reject(new Error(String(msg.error)));
							} else {
								pending.resolve(msg.result);
							}
						}
					}

					if (msg.method === "Runtime.consoleAPICalled") {
						const params = msg.params as
							| { args?: Array<{ value?: unknown }>; timestamp?: number; type?: string }
							| undefined;
						if (params) {
							const text = (params.args ?? []).map(a => String(a.value ?? "")).join(" ");
							this.#consoleEntries.push({
								level: this.#mapConsoleLevel(params.type),
								text,
								timestamp: params.timestamp ?? Date.now(),
							});
						}
					}
				} catch {
					/* ignore parse errors */
				}
			};

			ws.onclose = () => {
				logger.info("CDP WebSocket closed");
			};

			this.#ws = ws as unknown as import("bun").WebSocket;
		});
	}

	async #ensurePageTarget(): Promise<void> {
		const targets = await this.listTargets();
		const pageTarget = targets.find(t => t.type === "page");
		if (pageTarget) {
			const wsUrl = `ws://127.0.0.1:${this.#port}/devtools/page/${pageTarget.id}`;
			this.#cdpWsUrl = wsUrl;
			await this.#connectWebSocket();
			return;
		}

		const resp = await fetch(`http://127.0.0.1:${this.#port}/json/new`, { method: "PUT" });
		const data = (await resp.json()) as { id?: string; webSocketDebuggerUrl?: string };

		if (data.webSocketDebuggerUrl) {
			this.#cdpWsUrl = data.webSocketDebuggerUrl;
			await this.#connectWebSocket();
		}
	}

	async #sendCdpCommand(method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = ++this.#messageId;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#pendingResponses.delete(id);
				reject(new Error(`CDP command ${method} timed out`));
			}, 30000);

			this.#pendingResponses.set(id, {
				resolve: val => {
					clearTimeout(timeout);
					resolve(val);
				},
				reject: err => {
					clearTimeout(timeout);
					reject(err);
				},
			});

			const msg = JSON.stringify({ id, method, params });

			try {
				this.#ws?.send(msg);
			} catch (err) {
				this.#pendingResponses.delete(id);
				clearTimeout(timeout);
				reject(err);
			}
		});
	}

	#mapTargetType(type: string): CdpTarget["type"] {
		switch (type) {
			case "page":
				return "page";
			case "background_page":
				return "background_page";
			case "service_worker":
				return "service_worker";
			default:
				return "other";
		}
	}

	#mapConsoleLevel(type?: string): ConsoleEntry["level"] {
		switch (type) {
			case "warning":
				return "warn";
			case "error":
				return "error";
			case "info":
				return "info";
			default:
				return "log";
		}
	}
}
