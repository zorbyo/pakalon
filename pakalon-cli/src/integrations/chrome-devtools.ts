/**
 * Chrome DevTools MCP Integration
 *
 * Provides visual testing capabilities using Chrome DevTools Protocol.
 * Enables:
 * - Screenshot capture
 * - Element inspection
 * - Console log monitoring
 * - Network request tracking
 * - Performance metrics
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChromeDevToolsConfig {
  /** Chrome debugging port */
  port?: number;
  /** Chrome host */
  host?: string;
  /** Whether to use headless mode */
  headless?: boolean;
  /** Screenshot directory */
  screenshotDir?: string;
}

export interface ScreenshotOptions {
  /** Screenshot format */
  format?: 'png' | 'jpeg';
  /** Quality (for jpeg) */
  quality?: number;
  /** Full page screenshot */
  fullPage?: boolean;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
}

export interface ElementInfo {
  /** Element selector */
  selector: string;
  /** Element tag name */
  tagName: string;
  /** Element text content */
  textContent?: string;
  /** Element attributes */
  attributes: Record<string, string>;
  /** Bounding box */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ConsoleMessage {
  /** Message level */
  level: 'log' | 'info' | 'warning' | 'error';
  /** Message text */
  text: string;
  /** Timestamp */
  timestamp: Date;
  /** Source URL */
  source?: string;
  /** Line number */
  line?: number;
}

export interface NetworkRequest {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Response status */
  status?: number;
  /** Response headers */
  responseHeaders?: Record<string, string>;
  /** Request timing */
  timing?: { start: number; end: number; duration: number };
}

export interface PerformanceMetrics {
  /** DOM content loaded time */
  domContentLoaded: number;
  /** Load event time */
  loadEvent: number;
  /** First paint time */
  firstPaint: number;
  /** First contentful paint time */
  firstContentfulPaint: number;
  /** Largest contentful paint time */
  largestContentfulPaint: number;
  /** Total blocking time */
  totalBlockingTime: number;
  /** Cumulative layout shift */
  cumulativeLayoutShift: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: ChromeDevToolsConfig = {
  port: 9222,
  host: 'localhost',
  headless: true,
  screenshotDir: './screenshots',
};

let isConnected = false;
let ws: WebSocket | null = null;
let messageId = 0;
const pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();
const consoleMessages: ConsoleMessage[] = [];
const networkRequests: NetworkRequest[] = [];

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

/**
 * Configure Chrome DevTools connection
 */
export function configure(configOverrides: Partial<ChromeDevToolsConfig>): void {
  config = { ...config, ...configOverrides };
  logger.info(`[chrome-devtools] Configured: port=${config.port}, host=${config.host}`);
}

/**
 * Connect to Chrome DevTools
 */
export async function connect(): Promise<{ success: boolean; error?: string }> {
  try {
    // Get WebSocket debugger URL
    const response = await fetch(`http://${config.host}:${config.port}/json/version`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return { success: false, error: `Failed to connect to Chrome: HTTP ${response.status}` };
    }

    const data = await response.json() as { webSocketDebuggerUrl?: string };

    if (!data.webSocketDebuggerUrl) {
      return { success: false, error: 'No WebSocket debugger URL available' };
    }

    // Connect to WebSocket
    ws = new WebSocket(data.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      ws!.onopen = () => {
        isConnected = true;
        logger.info('[chrome-devtools] Connected');
        resolve();
      };

      ws!.onerror = (error) => {
        reject(error);
      };

      ws!.onclose = () => {
        isConnected = false;
        ws = null;
        logger.info('[chrome-devtools] Disconnected');
      };
    });

    // Set up message handler
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as { id?: number; method?: string; params?: unknown };
        handleMessage(message);
      } catch (error) {
        logger.error(`[chrome-devtools] Failed to parse message: ${error}`);
      }
    };

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[chrome-devtools] Connection failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Disconnect from Chrome DevTools
 */
export function disconnect(): void {
  if (ws) {
    ws.close();
    ws = null;
    isConnected = false;
    logger.info('[chrome-devtools] Disconnected');
  }
}

/**
 * Check if connected
 */
export function getConnectionStatus(): boolean {
  return isConnected;
}

// ---------------------------------------------------------------------------
// Message Handling
// ---------------------------------------------------------------------------

function handleMessage(message: { id?: number; method?: string; params?: unknown }): void {
  // Handle responses to our requests
  if (message.id !== undefined && pendingRequests.has(message.id)) {
    const pending = pendingRequests.get(message.id)!;
    pendingRequests.delete(message.id);
    pending.resolve(message);
    return;
  }

  // Handle events
  if (message.method) {
    handleEvent(message.method, message.params);
  }
}

function handleEvent(method: string, params: unknown): void {
  switch (method) {
    case 'Console.messageAdded':
      const consoleParams = params as { message: { level: string; text: string; source?: string; line?: number } };
      consoleMessages.push({
        level: consoleParams.message.level as ConsoleMessage['level'],
        text: consoleParams.message.text,
        timestamp: new Date(),
        source: consoleParams.message.source,
        line: consoleParams.message.line,
      });
      break;

    case 'Network.requestWillBeSent':
      const requestParams = params as { requestId: string; request: { url: string; method: string; headers?: Record<string, string> } };
      networkRequests.push({
        url: requestParams.request.url,
        method: requestParams.request.method,
        headers: requestParams.request.headers,
        timing: { start: Date.now(), end: 0, duration: 0 },
      });
      break;

    case 'Network.responseReceived':
      const responseParams = params as { requestId: string; response: { status: number; headers?: Record<string, string> } };
      const request = networkRequests.find((r) => r.url && !r.status);
      if (request) {
        request.status = responseParams.response.status;
        request.responseHeaders = responseParams.response.headers;
        if (request.timing) {
          request.timing.end = Date.now();
          request.timing.duration = request.timing.end - request.timing.start;
        }
      }
      break;
  }
}

async function sendRequest(method: string, params?: unknown): Promise<unknown> {
  if (!ws || !isConnected) {
    throw new Error('Not connected to Chrome DevTools');
  }

  const id = ++messageId;
  const message = { id, method, params };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    ws!.send(JSON.stringify(message));

    // Timeout after 10 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 10_000);
  });
}

// ---------------------------------------------------------------------------
// Screenshot Functions
// ---------------------------------------------------------------------------

/**
 * Take a screenshot
 */
export async function takeScreenshot(options?: ScreenshotOptions): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const result = await sendRequest('Page.captureScreenshot', {
      format: options?.format ?? 'png',
      quality: options?.quality,
      captureBeyondViewport: options?.fullPage ?? false,
      clip: options?.clip,
    }) as { data?: string };

    if (result.data) {
      return { success: true, data: result.data };
    }

    return { success: false, error: 'No screenshot data received' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Take a full page screenshot
 */
export async function takeFullPageScreenshot(): Promise<{ success: boolean; data?: string; error?: string }> {
  return takeScreenshot({ fullPage: true });
}

// ---------------------------------------------------------------------------
// Element Functions
// ---------------------------------------------------------------------------

/**
 * Get element info by selector
 */
export async function getElementInfo(selector: string): Promise<{ success: boolean; element?: ElementInfo; error?: string }> {
  try {
    const result = await sendRequest('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            tagName: el.tagName,
            textContent: el.textContent?.slice(0, 1000),
            attributes: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value])),
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        })()
      `,
      returnByValue: true,
    }) as { result?: { value?: ElementInfo } };

    if (result.result?.value) {
      return { success: true, element: result.result.value, };
    }

    return { success: false, error: 'Element not found' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Click an element
 */
export async function clickElement(selector: string): Promise<{ success: boolean; error?: string }> {
  try {
    await sendRequest('Runtime.evaluate', {
      expression: `document.querySelector('${selector}')?.click()`,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Type text into an element
 */
export async function typeIntoElement(selector: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    await sendRequest('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${selector}');
          if (el) {
            el.value = '${text.replace(/'/g, "\\'")}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Console Functions
// ---------------------------------------------------------------------------

/**
 * Get console messages
 */
export function getConsoleMessages(): ConsoleMessage[] {
  return [...consoleMessages];
}

/**
 * Clear console messages
 */
export function clearConsoleMessages(): void {
  consoleMessages.length = 0;
}

// ---------------------------------------------------------------------------
// Network Functions
// ---------------------------------------------------------------------------

/**
 * Get network requests
 */
export function getNetworkRequests(): NetworkRequest[] {
  return [...networkRequests];
}

/**
 * Clear network requests
 */
export function clearNetworkRequests(): void {
  networkRequests.length = 0;
}

// ---------------------------------------------------------------------------
// Navigation Functions
// ---------------------------------------------------------------------------

/**
 * Navigate to a URL
 */
export async function navigateTo(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    await sendRequest('Page.navigate', { url });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Wait for page load
 */
export async function waitForPageLoad(timeout: number = 30_000): Promise<{ success: boolean; error?: string }> {
  try {
    await sendRequest('Page.enable');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout')), timeout);
      // Page.loadEventFired will be handled by message handler
      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, timeout);
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Performance Functions
// ---------------------------------------------------------------------------

/**
 * Get performance metrics
 */
export async function getPerformanceMetrics(): Promise<{ success: boolean; metrics?: PerformanceMetrics; error?: string }> {
  try {
    const result = await sendRequest('Performance.enable');
    const data = await sendRequest('Performance.getMetrics') as { metrics?: Array<{ name: string; value: number }> };

    if (data.metrics) {
      const metricsMap = new Map(data.metrics.map((m) => [m.name, m.value]));
      const metrics: PerformanceMetrics = {
        domContentLoaded: metricsMap.get('DomContentLoaded') ?? 0,
        loadEvent: metricsMap.get('LoadEvent') ?? 0,
        firstPaint: metricsMap.get('FirstPaint') ?? 0,
        firstContentfulPaint: metricsMap.get('FirstContentfulPaint') ?? 0,
        largestContentfulPaint: metricsMap.get('LargestContentfulPaint') ?? 0,
        totalBlockingTime: metricsMap.get('TotalBlockingTime') ?? 0,
        cumulativeLayoutShift: metricsMap.get('CumulativeLayoutShift') ?? 0,
      };
      return { success: true, metrics };
    }

    return { success: false, error: 'No metrics available' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
