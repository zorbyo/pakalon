/**
 * Polar Webhook Server
 *
 * Local HTTP server that receives Polar payment webhooks and processes them.
 * Uses the built-in Bun HTTP server for zero-dependency operation.
 */

import { handleWebhookEvent, verifyWebhookSignature } from "./polar.js";
import type { PolarWebhookEvent } from "./polar.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookServerConfig {
  port: number;
  host?: string;
  webhookPath?: string;
}

export interface WebhookServer {
  close: () => Promise<void>;
  port: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: WebhookServerConfig = {
  port: 7433,
  host: "127.0.0.1",
  webhookPath: "/webhooks/polar",
};

// ---------------------------------------------------------------------------
// Request body parser
// ---------------------------------------------------------------------------

async function parseBody(request: Request): Promise<string> {
  return await request.text();
}

// ---------------------------------------------------------------------------
// Webhook server
// ---------------------------------------------------------------------------

export async function startWebhookServer(
  config?: Partial<WebhookServerConfig>,
): Promise<WebhookServer> {
  const cfg: WebhookServerConfig = { ...DEFAULT_CONFIG, ...config };
  const { port, host, webhookPath } = cfg;

  // Check if Bun is available (for Bun.serve)
  const isBun = typeof Bun !== "undefined" && typeof Bun.serve === "function";

  if (isBun) {
    return startBunWebhookServer(port, host!, webhookPath!);
  }

  // Fallback: start a simple Node-compatible server using createServer
  return startNodeWebhookServer(port, host!, webhookPath!);
}

function startBunWebhookServer(
  port: number,
  host: string,
  webhookPath: string,
): Promise<WebhookServer> {
  return new Promise((resolve) => {
    // Use Bun.serve for HTTP server
    const server = Bun.serve({
      port,
      hostname: host,
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Health check
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Webhook endpoint
        if (url.pathname === webhookPath && request.method === "POST") {
          return handleIncomingWebhook(request);
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    logger.info(`[Polar] Webhook server listening on http://${host}:${port}${webhookPath}`);
    resolve({
      close: async () => {
        server.stop();
        logger.info("[Polar] Webhook server stopped");
      },
      port,
    });
  });
}

function startNodeWebhookServer(
  port: number,
  host: string,
  webhookPath: string,
): Promise<WebhookServer> {
  return new Promise((resolve, reject) => {
    const http = require("http");
    const server = http.createServer(async (req: any, res: any) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      // Health check
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // Webhook endpoint
      if (url.pathname === webhookPath && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", async () => {
          const request = new Request(`http://${host}:${port}${webhookPath}`, {
            method: "POST",
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body,
          });
          const response = await handleIncomingWebhook(request);
          const responseBody = await response.text();
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(responseBody);
        });
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(port, host, () => {
      logger.info(`[Polar] Webhook server listening on http://${host}:${port}${webhookPath}`);
      resolve({
        close: async () => {
          server.close();
          logger.info("[Polar] Webhook server stopped");
        },
        port,
      });
    });

    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

async function handleIncomingWebhook(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request);
    const signature = request.headers.get("x-webhook-signature") ?? "";

    // Verify signature
    if (!verifyWebhookSignature(body, signature)) {
      logger.warn("[Polar] Invalid webhook signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse event
    let event: PolarWebhookEvent;
    try {
      event = JSON.parse(body) as PolarWebhookEvent;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle event
    const result = await handleWebhookEvent(event);
    logger.info(`[Polar] Webhook processed: ${event.type} -> ${result.action ?? "ok"}`);

    return new Response(
      JSON.stringify({ received: true, action: result.action }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    logger.error(`[Polar] Webhook error: ${error}`);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export function getDefaultWebhookUrl(port?: number): string {
  return `http://127.0.0.1:${port ?? DEFAULT_CONFIG.port}${DEFAULT_CONFIG.webhookPath}`;
}

export { DEFAULT_CONFIG };

export default {
  startWebhookServer,
  getDefaultWebhookUrl,
};