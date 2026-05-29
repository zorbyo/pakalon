import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import { z } from 'zod';
import type { SdkMcpToolDefinition } from '../sdk/runtimeTypes.js';
import logger from '@/utils/logger.js';

type ChromeSessionTransport = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export interface ChromeDevToolsOptions {
  host?: string;
  port?: number;
  websocketUrl?: string;
  /** Path to Chrome/Chromium executable. Auto-detected if not set. */
  chromePath?: string;
  /** Headless mode — false means visible window (default: true). */
  headless?: boolean;
  /** Additional Chrome CLI flags. */
  extraArgs?: string[];
}

export interface ChromeDevToolsToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

async function createTransport(options: ChromeDevToolsOptions): Promise<ChromeSessionTransport> {
  const port = options.port ?? 9222;
  const websocketUrl = options.websocketUrl;

  if (websocketUrl) {
    const WebSocketCtor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => WebSocket }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error('WebSocket is not available in this runtime');
    }

    const socket = new WebSocketCtor(websocketUrl);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        socket.removeEventListener('open', onOpen);
        const error = event instanceof ErrorEvent
          ? event.error ?? new Error(event.message)
          : new Error('Chrome DevTools WebSocket connection failed');
        reject(error);
      };
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });

    let id = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    socket.addEventListener('message', (event) => {
      const data = 'data' in event ? (event as MessageEvent).data : event;
      const message = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          entry?.reject(new Error(message.error.message || 'Chrome DevTools error'));
        } else {
          entry?.resolve(message.result);
        }
      }
    });

    return {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const nextId = ++id;
        const payload = JSON.stringify({ id: nextId, method, params });
        const response = await new Promise<unknown>((resolve) => {
          pending.set(nextId, { resolve, reject: (error) => resolve(error) });
          socket.send(payload);
        });
        if (response instanceof Error) {
          throw response;
        }
        return response;
      },
      async close(): Promise<void> {
        socket.close();
      },
    };
  }

  const response = await fetch(`http://${options.host ?? '127.0.0.1'}:${port}/json/version`);
  const version = await response.json() as { webSocketDebuggerUrl: string };
  return createTransport({ ...options, websocketUrl: version.webSocketDebuggerUrl });
}

export class ChromeDevToolsMCP extends EventEmitter {
  private transport?: ChromeSessionTransport;
  private options: ChromeDevToolsOptions;
  private chromeProcess?: ChildProcess;

  constructor(options: ChromeDevToolsOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Launch a Chrome/Chromium instance with remote debugging enabled.
   * Auto-detects the executable on common platforms.
   */
  async launchChrome(): Promise<ChromeDevToolsToolResult> {
    if (this.chromeProcess) {
      return { success: true, message: 'Chrome is already running' };
    }

    const port = this.options.port ?? 9222;
    const headless = this.options.headless ?? true;

    const possiblePaths: string[] = [
      this.options.chromePath ?? '',
      // Windows
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chromium.exe',
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].filter(Boolean);

    let chromePath = possiblePaths[0] ?? 'chrome';
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          chromePath = p;
          break;
        }
      } catch {
        // ignore
      }
    }

    const args: string[] = [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync-preferences',
      '--no-startup-window',
      ...(headless ? ['--headless=new'] : []),
      ...(this.options.extraArgs ?? []),
      'about:blank',
    ];

    try {
      const chromeProcess = spawn(chromePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      this.chromeProcess = chromeProcess;

      chromeProcess.stdout?.on('data', (data: Buffer) => {
        logger.debug(`[ChromeDevTools] ${data.toString().trim()}`);
      });
      chromeProcess.stderr?.on('data', (data: Buffer) => {
        logger.debug(`[ChromeDevTools] ${data.toString().trim()}`);
      });
      chromeProcess.on('error', (err) => {
        logger.warn(`[ChromeDevTools] Process error: ${err.message}`);
      });
      chromeProcess.on('exit', (code) => {
        logger.info(`[ChromeDevTools] Process exited with code ${code}`);
        this.chromeProcess = undefined;
      });

      // Wait briefly for Chrome to start listening
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Chrome start timeout')), 15000);
        const poll = async () => {
          for (let i = 0; i < 30; i++) {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/json/version`);
              if (res.ok) {
                clearTimeout(timeout);
                resolve();
                return;
              }
            } catch {
              // not ready yet
            }
            await new Promise(r => setTimeout(r, 500));
          }
          clearTimeout(timeout);
          reject(new Error('Chrome did not start in time'));
        };
        poll();
      });

      return { success: true, message: `Chrome launched on port ${port} (headless: ${headless})` };
    } catch (error) {
      return { success: false, message: 'Failed to launch Chrome', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async connect(): Promise<void> {
    this.transport = await createTransport(this.options);
  }

  async disconnect(): Promise<void> {
    await this.transport?.close();
    this.transport = undefined;
  }

  async killChrome(): Promise<ChromeDevToolsToolResult> {
    if (this.chromeProcess) {
      this.chromeProcess.kill('SIGTERM');
      this.chromeProcess = undefined;
      return { success: true, message: 'Chrome process terminated' };
    }
    return { success: true, message: 'No Chrome process to terminate' };
  }

  async captureNetworkLog(): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('Network.enable');
      return { success: true, message: 'Network logging enabled', data: result };
    } catch (error) {
      return { success: false, message: 'Failed to capture network log', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async runLighthouseAudit(): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('Performance.getMetrics');
      return { success: true, message: 'Lighthouse-style metrics collected', data: result };
    } catch (error) {
      return { success: false, message: 'Failed to run audit', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async inspectElement(selector: string): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('DOM.querySelector', { nodeId: 1, selector });
      return { success: true, message: `Inspected ${selector}`, data: result };
    } catch (error) {
      return { success: false, message: 'Failed to inspect element', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async evaluateExpression(expression: string): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('Runtime.evaluate', { expression, returnByValue: true });
      return { success: true, message: 'Expression evaluated', data: result };
    } catch (error) {
      return { success: false, message: 'Failed to evaluate expression', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async navigate(url: string): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('Page.enable');
      const navResult = await this.transport!.send('Page.navigate', { url });
      return { success: true, message: `Navigated to ${url}`, data: navResult };
    } catch (error) {
      return { success: false, message: 'Failed to navigate', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async captureScreenshot(options?: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean }): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      const result = await this.transport!.send('Page.captureScreenshot', {
        format: options?.format ?? 'png',
        quality: options?.quality,
        captureBeyondViewport: options?.fullPage ?? false,
      });
      return { success: true, message: 'Screenshot captured', data: result };
    } catch (error) {
      return { success: false, message: 'Failed to capture screenshot', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getConsoleLog(): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      await this.transport!.send('Console.enable');
      // Console messages are captured via events — return the enable confirmation
      return { success: true, message: 'Console logging enabled' };
    } catch (error) {
      return { success: false, message: 'Failed to enable console logging', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getCoverage(): Promise<ChromeDevToolsToolResult> {
    try {
      await this.ensureConnected();
      await this.transport!.send('CSS.enable');
      const result = await this.transport!.send('CSS.getCoverage');
      return { success: true, message: 'CSS coverage collected', data: result };
    } catch (error) {
      return { success: false, message: 'Failed to get CSS coverage', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.transport) {
      await this.launchChrome();
      await this.connect();
    }
  }
}

/**
 * Shared Chrome instance for tool definitions.
 * Tools reuse the same instance across calls within a session.
 */
let _sharedClient: ChromeDevToolsMCP | null = null;

function getSharedClient(): ChromeDevToolsMCP {
  if (!_sharedClient) {
    _sharedClient = new ChromeDevToolsMCP();
  }
  return _sharedClient;
}

export async function resetSharedClient(): Promise<void> {
  if (_sharedClient) {
    await _sharedClient.killChrome();
    await _sharedClient.disconnect();
    _sharedClient = null;
  }
}

export const chromeDevToolsLaunchToolDefinition: SdkMcpToolDefinition<{ port?: number; headless?: boolean }> = {
  name: 'chrome_launch',
  description: 'Launch Chrome/Chromium with DevTools remote debugging enabled',
  inputSchema: z.object({ port: z.number().optional(), headless: z.boolean().optional() }),
  async execute(input): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    if (input.port) client['options'].port = input.port;
    if (input.headless !== undefined) client['options'].headless = input.headless;
    return client.launchChrome();
  },
};

export const chromeDevToolsKillToolDefinition: SdkMcpToolDefinition<Record<string, never>> = {
  name: 'chrome_kill',
  description: 'Terminate the Chrome/Chromium process',
  inputSchema: z.object({}),
  async execute(): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.killChrome();
  },
};

export const chromeDevToolsNavigateToolDefinition: SdkMcpToolDefinition<{ url: string }> = {
  name: 'chrome_navigate',
  description: 'Navigate Chrome to a URL via DevTools Protocol',
  inputSchema: z.object({ url: z.string().describe('Full URL to navigate to (e.g. https://localhost:3000)') }),
  async execute(input): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.navigate(input.url);
  },
};

export const chromeDevToolsScreenshotToolDefinition: SdkMcpToolDefinition<{ format?: 'png' | 'jpeg'; fullPage?: boolean }> = {
  name: 'chrome_screenshot',
  description: 'Capture a screenshot of the current page via DevTools Protocol',
  inputSchema: z.object({
    format: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional().describe('Capture full scrollable page'),
  }),
  async execute(input): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.captureScreenshot(input);
  },
};

export const chromeDevToolsCaptureNetworkLogToolDefinition: SdkMcpToolDefinition<Record<string, never>> = {
  name: 'chrome_capture_network',
  description: 'Enable and capture Chrome DevTools network events for the current page',
  inputSchema: z.object({}),
  async execute(): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.captureNetworkLog();
  },
};

export const chromeDevToolsRunLighthouseAuditToolDefinition: SdkMcpToolDefinition<Record<string, never>> = {
  name: 'chrome_performance',
  description: 'Collect page performance metrics via Chrome DevTools (Lighthouse-style)',
  inputSchema: z.object({}),
  async execute(): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.runLighthouseAudit();
  },
};

export const chromeDevToolsInspectElementToolDefinition: SdkMcpToolDefinition<{ selector: string }> = {
  name: 'chrome_inspect',
  description: 'Inspect a DOM element by CSS selector',
  inputSchema: z.object({ selector: z.string() }),
  async execute(input): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.inspectElement(input.selector);
  },
};

export const chromeDevToolsEvaluateExpressionToolDefinition: SdkMcpToolDefinition<{ expression: string }> = {
  name: 'chrome_evaluate',
  description: 'Execute JavaScript in the Chrome page context and return the result',
  inputSchema: z.object({ expression: z.string() }),
  async execute(input): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.evaluateExpression(input.expression);
  },
};

export const chromeDevToolsConsoleToolDefinition: SdkMcpToolDefinition<Record<string, never>> = {
  name: 'chrome_console',
  description: 'Enable console log capture for the current page (call before interacting)',
  inputSchema: z.object({}),
  async execute(): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.getConsoleLog();
  },
};

export const chromeDevToolsCoverageToolDefinition: SdkMcpToolDefinition<Record<string, never>> = {
  name: 'chrome_coverage',
  description: 'Collect CSS coverage information for the current page',
  inputSchema: z.object({}),
  async execute(): Promise<ChromeDevToolsToolResult> {
    const client = getSharedClient();
    return client.getCoverage();
  },
};

export default {
  ChromeDevToolsMCP,
  resetSharedClient,
  chromeDevToolsLaunchToolDefinition,
  chromeDevToolsKillToolDefinition,
  chromeDevToolsNavigateToolDefinition,
  chromeDevToolsScreenshotToolDefinition,
  chromeDevToolsCaptureNetworkLogToolDefinition,
  chromeDevToolsRunLighthouseAuditToolDefinition,
  chromeDevToolsInspectElementToolDefinition,
  chromeDevToolsEvaluateExpressionToolDefinition,
  chromeDevToolsConsoleToolDefinition,
  chromeDevToolsCoverageToolDefinition,
};
