"use strict";

const http = require("node:http");
const { URL } = require("node:url");

const {
  SlidingWindowRateLimiter,
  buildRateLimitHeaders,
  resolveRouteLimit,
} = require("./rate-limit");
const { TelemetryStore } = require("./telemetry");
const { processPolarEvent, verifyPolarWebhookSignature } = require("./polar-webhooks");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(rawBody) {
  if (!rawBody.length) return {};
  return JSON.parse(rawBody.toString("utf8"));
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function getClientKey(req, pathname) {
  const userId = req.headers["x-user-id"];
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor ?? "").split(",")[0].trim();
  return `${pathname}:${userId || ip || req.socket.remoteAddress || "anonymous"}`;
}

function createServer(options = {}) {
  const limiter = options.rateLimiter ?? new SlidingWindowRateLimiter({ windowMs: options.rateWindowMs });
  const telemetryStore = options.telemetryStore ?? new TelemetryStore();
  const polarSecret = options.polarWebhookSecret ?? process.env.POLAR_WEBHOOK_SECRET;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname !== "/health") {
      const plan = req.headers["x-user-plan"] ?? "free";
      const limit = resolveRouteLimit(req.method, pathname, String(plan));
      const rateResult = limiter.check(getClientKey(req, pathname), limit);
      const rateHeaders = buildRateLimitHeaders(rateResult);

      if (!rateResult.allowed) {
        sendJson(res, 429, { detail: "Rate limit exceeded" }, rateHeaders);
        return;
      }
    }

    try {
      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true, runtime: "node" });
        return;
      }

      if (req.method === "POST" && pathname === "/telemetry") {
        const rawBody = await readBody(req);
        const event = telemetryStore.record(parseJson(rawBody));
        sendJson(res, 202, { accepted: true, event });
        return;
      }

      if (req.method === "GET" && pathname === "/telemetry/aggregate") {
        const days = Number(url.searchParams.get("days") ?? 30);
        sendJson(res, 200, telemetryStore.aggregate({ days }));
        return;
      }

      if (req.method === "POST" && pathname === "/webhooks/polar") {
        if (!polarSecret) {
          sendJson(res, 503, { detail: "Polar webhook secret is not configured" });
          return;
        }

        const rawBody = await readBody(req);
        const verification = verifyPolarWebhookSignature(rawBody, req.headers, polarSecret);
        if (!verification.ok) {
          sendJson(res, 403, { detail: verification.reason });
          return;
        }

        const event = processPolarEvent(parseJson(rawBody), telemetryStore);
        sendJson(res, 202, { received: true, webhookId: verification.webhookId, event });
        return;
      }

      sendJson(res, 404, { detail: "Not found" });
    } catch (error) {
      const detail = error instanceof SyntaxError ? "Invalid JSON body" : "Internal server error";
      sendJson(res, error instanceof SyntaxError ? 400 : 500, { detail });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8000);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Pakalon Node backend listening on http://${host}:${port}`);
  });
}

module.exports = {
  createServer,
  parseJson,
  readBody,
};
