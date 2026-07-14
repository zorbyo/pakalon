import { logger } from "@oh-my-pi/pi-utils";
import type { PolarWebhookEvent } from "./polar";
import { handleWebhookEvent, verifyWebhookSignature } from "./polar";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebhookServerConfig {
	port: number;
	host?: string;
	webhookPath?: string;
}

export interface WebhookServer {
	close: () => Promise<void>;
	port: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: WebhookServerConfig = {
	port: 7433,
	host: "127.0.0.1",
	webhookPath: "/webhooks/polar",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Webhook server
// ═══════════════════════════════════════════════════════════════════════════════

export async function startWebhookServer(config?: Partial<WebhookServerConfig>): Promise<WebhookServer> {
	const cfg: WebhookServerConfig = { ...DEFAULT_CONFIG, ...config };
	const { port, host, webhookPath } = cfg;

	return startBunWebhookServer(port, host!, webhookPath!);
}

function startBunWebhookServer(port: number, host: string, webhookPath: string): Promise<WebhookServer> {
	return new Promise(resolve => {
		const server = Bun.serve({
			port,
			hostname: host,
			async fetch(request: Request): Promise<Response> {
				const url = new URL(request.url);

				if (url.pathname === "/health") {
					return new Response(JSON.stringify({ status: "ok" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}

				if (url.pathname === webhookPath && request.method === "POST") {
					return handleIncomingWebhook(request);
				}

				return new Response("Not Found", { status: 404 });
			},
		});

		logger.info("Polar webhook server listening", {
			url: `http://${host}:${port}${webhookPath}`,
		});
		resolve({
			close: async () => {
				server.stop();
				logger.info("Polar webhook server stopped");
			},
			port,
		});
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Webhook handler
// ═══════════════════════════════════════════════════════════════════════════════

async function handleIncomingWebhook(request: Request): Promise<Response> {
	try {
		const body = await request.text();
		const signature = request.headers.get("x-webhook-signature") ?? "";

		if (!(await verifyWebhookSignature(body, signature))) {
			logger.warn("Invalid Polar webhook signature");
			return new Response(JSON.stringify({ error: "Invalid signature" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		let event: PolarWebhookEvent;
		try {
			event = JSON.parse(body) as PolarWebhookEvent;
		} catch {
			return new Response(JSON.stringify({ error: "Invalid JSON" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const result = await handleWebhookEvent(event);
		logger.info("Polar webhook processed", {
			type: event.type,
			action: result.action ?? "ok",
		});

		return new Response(JSON.stringify({ received: true, action: result.action }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		logger.error("Polar webhook error", { error });
		return new Response(JSON.stringify({ error: "Internal error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Convenience exports
// ═══════════════════════════════════════════════════════════════════════════════

export function getDefaultWebhookUrl(port?: number): string {
	return `http://127.0.0.1:${port ?? DEFAULT_CONFIG.port}${DEFAULT_CONFIG.webhookPath}`;
}

export { DEFAULT_CONFIG };
