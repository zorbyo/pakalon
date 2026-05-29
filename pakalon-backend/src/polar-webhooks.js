"use strict";

const crypto = require("node:crypto");

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function getHeader(headers, name) {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function decodeWebhookSecret(secret) {
  if (!secret || typeof secret !== "string") {
    throw new Error("POLAR_WEBHOOK_SECRET is required");
  }

  const value = secret.trim();
  if (value.startsWith("whsec_")) {
    return Buffer.from(value.slice("whsec_".length), "base64");
  }

  return Buffer.from(value, "utf8");
}

function normalizeSignatureToken(token) {
  const value = token.trim();
  if (!value) return "";

  const commaParts = value.split(",");
  if (commaParts.length === 2 && /^v\d+$/.test(commaParts[0])) {
    return commaParts[1].trim();
  }

  const equalsParts = value.split("=");
  if (equalsParts.length === 2 && /^v\d+$/.test(equalsParts[0])) {
    return equalsParts[1].trim();
  }

  return value;
}

function extractSignatures(signatureHeader) {
  if (!signatureHeader) return [];
  return String(signatureHeader)
    .split(/\s+/)
    .flatMap((part) => part.split(";"))
    .map(normalizeSignatureToken)
    .filter(Boolean);
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function matchesSignature(candidate, expectedBase64, expectedHex) {
  if (timingSafeEqual(candidate, expectedBase64)) return true;
  if (timingSafeEqual(candidate.toLowerCase(), expectedHex)) return true;

  try {
    const decoded = Buffer.from(candidate, "base64").toString("hex");
    return timingSafeEqual(decoded, expectedHex);
  } catch {
    return false;
  }
}

function verifyPolarWebhookSignature(rawBody, headers, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS) {
  const webhookId = getHeader(headers, "webhook-id") ?? getHeader(headers, "svix-id");
  const timestamp = getHeader(headers, "webhook-timestamp") ?? getHeader(headers, "svix-timestamp");
  const signatureHeader = getHeader(headers, "webhook-signature") ?? getHeader(headers, "svix-signature");

  if (!webhookId || !timestamp || !signatureHeader) {
    return { ok: false, reason: "missing required webhook signature headers" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "invalid webhook timestamp" };
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, reason: "webhook timestamp outside tolerance" };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const signedContent = `${webhookId}.${timestamp}.${body}`;
  const secretBytes = decodeWebhookSecret(secret);
  const digest = crypto.createHmac("sha256", secretBytes).update(signedContent).digest();
  const expectedBase64 = digest.toString("base64");
  const expectedHex = digest.toString("hex");

  const verified = extractSignatures(signatureHeader).some((candidate) =>
    matchesSignature(candidate, expectedBase64, expectedHex),
  );

  return verified
    ? { ok: true, webhookId, timestamp: timestampSeconds }
    : { ok: false, reason: "invalid webhook signature" };
}

function processPolarEvent(payload, telemetryStore) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const eventType = payload?.type ?? payload?.event_type ?? payload?.event ?? "unknown";
  const eventId = payload?.id ?? payload?.event_id ?? data.id ?? null;
  const subscriptionId = data.subscription_id ?? data.subscription?.id ?? data.id ?? null;
  const customerId = data.customer_id ?? data.customer?.id ?? null;
  const userId = metadata.user_id ?? metadata.userId ?? data.customer?.external_id ?? null;
  const status = data.status ?? data.subscription?.status ?? null;

  const normalized = {
    eventId,
    eventType,
    subscriptionId,
    customerId,
    userId,
    status,
    processedAt: new Date().toISOString(),
  };

  if (telemetryStore) {
    telemetryStore.record({
      eventName: `webhook.polar.${eventType}`,
      userId,
      properties: {
        eventId,
        subscriptionId,
        customerId,
        status,
      },
    });
  }

  return normalized;
}

module.exports = {
  DEFAULT_TOLERANCE_SECONDS,
  decodeWebhookSecret,
  extractSignatures,
  processPolarEvent,
  verifyPolarWebhookSignature,
};
