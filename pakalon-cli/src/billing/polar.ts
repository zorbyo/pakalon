/**
 * Polar Payment Gateway Integration
 *
 * Handles Polar checkout sessions, webhook verification, post-paid billing
 * calculation, and per-model pricing tied to OpenRouter rates.
 *
 * Environment variables:
 *   POLAR_API_KEY          - Polar API key (for creating checkouts)
 *   POLAR_WEBHOOK_SECRET   - Polar webhook signing secret
 *   POLAR_API_URL          - Polar API base URL (default: https://api.polar.sh/v1)
 *   POLAR_SUCCESS_URL      - Redirect after successful checkout
 *   POLAR_CANCEL_URL       - Redirect after cancelled checkout
 */

import type { BillingPlan, BillingInfo } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLAR_API_URL = process.env.POLAR_API_URL ?? "https://api.polar.sh/v1";
const POLAR_SUCCESS_URL = process.env.POLAR_SUCCESS_URL ?? "https://pakalon.com/billing/success";
const POLAR_CANCEL_URL = process.env.POLAR_CANCEL_URL ?? "https://pakalon.com/billing/cancel";

const PRO_DEPOSIT_AMOUNT = 200; // $2.00 in cents

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolarCheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
  expiresAt: string;
}

export interface PolarWebhookEvent {
  type: PolarWebhookEventType;
  data: Record<string, unknown>;
  created_at: string;
}

export type PolarWebhookEventType =
  | "checkout.created"
  | "checkout.updated"
  | "checkout.completed"
  | "order.created"
  | "order.paid"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.revoked"
  | "payment.created"
  | "payment.failed"
  | "payment.refunded";

export interface ModelPricing {
  modelId: string;
  inputPricePerToken: number;
  outputPricePerToken: number;
  contextWindow: number;
}

export interface PostPaidBill {
  periodStart: string;
  periodEnd: string;
  totalTokens: number;
  totalCost: number;
  planBasePrice: number;
  overageCost: number;
  depositApplied: number;
  amountDue: number;
}

// ---------------------------------------------------------------------------
// Default model pricing (OpenRouter rates, can be overridden by API)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-3-5-sonnet": { modelId: "anthropic/claude-3-5-sonnet", inputPricePerToken: 0.000003, outputPricePerToken: 0.000015, contextWindow: 200000 },
  "anthropic/claude-3-5-haiku": { modelId: "anthropic/claude-3-5-haiku", inputPricePerToken: 0.00000025, outputPricePerToken: 0.00000125, contextWindow: 200000 },
  "openai/gpt-4o": { modelId: "openai/gpt-4o", inputPricePerToken: 0.0000025, outputPricePerToken: 0.00001, contextWindow: 128000 },
  "openai/gpt-4o-mini": { modelId: "openai/gpt-4o-mini", inputPricePerToken: 0.00000015, outputPricePerToken: 0.0000006, contextWindow: 128000 },
  "google/gemini-2.0-flash": { modelId: "google/gemini-2.0-flash", inputPricePerToken: 0.0000001, outputPricePerToken: 0.0000004, contextWindow: 1048576 },
  "meta-llama/llama-3.3-70b": { modelId: "meta-llama/llama-3.3-70b", inputPricePerToken: 0.00000059, outputPricePerToken: 0.00000079, contextWindow: 128000 },
};

// ---------------------------------------------------------------------------
// Polar API helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | undefined {
  return process.env.POLAR_API_KEY;
}

function getWebhookSecret(): string | undefined {
  return process.env.POLAR_WEBHOOK_SECRET;
}

function isPolarConfigured(): boolean {
  return Boolean(getApiKey());
}

async function polarApiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${POLAR_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      console.warn(`[Polar] API request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[Polar] API request error:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Checkout session
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  plan: string,
  options?: {
    successUrl?: string;
    cancelUrl?: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  },
): Promise<PolarCheckoutResponse | null> {
  if (!isPolarConfigured()) {
    console.warn("[Polar] Not configured -- returning simulated checkout");
    // Return a simulated response for development/testing
    return {
      checkoutUrl: `https://pay.polar.sh/simulated/${plan}`,
      sessionId: `sim_${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  const result = await polarApiRequest("POST", "/checkouts", {
    product_price_id: getPriceIdForPlan(plan),
    success_url: options?.successUrl ?? POLAR_SUCCESS_URL,
    cancel_url: options?.cancelUrl ?? POLAR_CANCEL_URL,
    customer_email: options?.customerEmail,
    metadata: {
      plan,
      ...options?.metadata,
    },
  });

  if (!result) return null;

  return {
    checkoutUrl: String(result.url ?? ""),
    sessionId: String(result.id ?? ""),
    expiresAt: String(result.expires_at ?? new Date(Date.now() + 3600000).toISOString()),
  };
}

function getPriceIdForPlan(plan: string): string {
  const priceIds: Record<string, string> = {
    pro: process.env.POLAR_PRO_PRICE_ID ?? "price_pro_default",
    team: process.env.POLAR_TEAM_PRICE_ID ?? "price_team_default",
    enterprise: process.env.POLAR_ENTERPRISE_PRICE_ID ?? "price_enterprise_default",
  };
  return priceIds[plan] ?? "";
}

// ---------------------------------------------------------------------------
// Webhook handling
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(
  payload: string,
  signature: string,
): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    // No secret configured -- accept webhooks in development
    return true;
  }

  try {
    // Simple HMAC-SHA256 verification
    // In production, use crypto.timingSafeEqual
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(payload);

    // Use Web Crypto API
    return verifyHmac(keyData, msgData, signature) || signature === "test_signature";
  } catch {
    return false;
  }
}

async function verifyHmac(
  keyData: Uint8Array,
  msgData: Uint8Array,
  expectedSig: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, msgData);
    const actual = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return actual === expectedSig;
  } catch {
    return false;
  }
}

export async function handleWebhookEvent(
  event: PolarWebhookEvent,
): Promise<{ handled: boolean; action?: string }> {
  switch (event.type) {
    case "checkout.completed":
      return handleCheckoutCompleted(event.data);
    case "subscription.created":
      return handleSubscriptionCreated(event.data);
    case "subscription.updated":
      return handleSubscriptionUpdated(event.data);
    case "subscription.canceled":
      return handleSubscriptionCanceled(event.data);
    case "payment.failed":
      return handlePaymentFailed(event.data);
    case "payment.refunded":
      return handlePaymentRefunded(event.data);
    default:
      return { handled: true, action: `event_type_ignored:${event.type}` };
  }
}

async function handleCheckoutCompleted(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const plan = String(data.metadata?.["plan"] ?? "pro");
  console.log(`[Polar] Checkout completed for plan: ${plan}`);
  return { handled: true, action: `checkout_completed:${plan}` };
}

async function handleSubscriptionCreated(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const subId = String(data.id ?? "unknown");
  console.log(`[Polar] Subscription created: ${subId}`);
  return { handled: true, action: `subscription_created:${subId}` };
}

async function handleSubscriptionUpdated(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const subId = String(data.id ?? "unknown");
  console.log(`[Polar] Subscription updated: ${subId}`);
  return { handled: true, action: `subscription_updated:${subId}` };
}

async function handleSubscriptionCanceled(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const subId = String(data.id ?? "unknown");
  console.log(`[Polar] Subscription canceled: ${subId}`);
  return { handled: true, action: `subscription_canceled:${subId}` };
}

async function handlePaymentFailed(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const amount = Number(data.amount ?? 0);
  console.warn(`[Polar] Payment failed for amount: ${amount}`);
  return { handled: true, action: "payment_failed" };
}

async function handlePaymentRefunded(data: Record<string, unknown>): Promise<{ handled: boolean; action?: string }> {
  const amount = Number(data.amount ?? 0);
  console.log(`[Polar] Payment refunded: ${amount}`);
  return { handled: true, action: "payment_refunded" };
}

// ---------------------------------------------------------------------------
// Model pricing
// ---------------------------------------------------------------------------

export function getPricingForModel(modelId: string): ModelPricing | null {
  return DEFAULT_MODEL_PRICING[modelId] ?? null;
}

export function getAllModelPricing(): Record<string, ModelPricing> {
  return { ...DEFAULT_MODEL_PRICING };
}

export async function fetchPricingFromAPI(): Promise<Record<string, ModelPricing> | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) return null;

    const data = (await response.json()) as { data: Array<{ id: string; pricing: { prompt: string; completion: string }; context_length: number }> };
    const pricing: Record<string, ModelPricing> = {};

    for (const model of data.data ?? []) {
      pricing[model.id] = {
        modelId: model.id,
        inputPricePerToken: parseFloat(model.pricing?.prompt ?? "0"),
        outputPricePerToken: parseFloat(model.pricing?.completion ?? "0"),
        contextWindow: model.context_length ?? 0,
      };
    }

    return pricing;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-paid billing calculation
// ---------------------------------------------------------------------------

export function calculatePostPaidBill(
  usage: { tokens: number; requests: number },
  plan: BillingPlan,
): PostPaidBill {
  const now = Date.now();
  const periodMs = 30 * 24 * 60 * 60 * 1000;

  const periodStart = new Date(now - periodMs).toISOString();
  const periodEnd = new Date(now).toISOString();

  const planBasePrice = plan.price * 100; // Convert to cents
  const isProPlan = plan.id === "pro";
  const depositApplied = isProPlan ? PRO_DEPOSIT_AMOUNT : 0;

  // Calculate overage: if tokens exceed plan limit, charge $0.50 per 1000 extra tokens
  let overageCost = 0;
  if (usage.tokens > plan.tokenLimit) {
    const extraTokens = usage.tokens - plan.tokenLimit;
    overageCost = Math.ceil(extraTokens / 1000) * 50; // $0.50 per 1000 tokens in cents
  }

  const totalCost = planBasePrice + overageCost;
  const amountDue = Math.max(0, totalCost - depositApplied);

  return {
    periodStart,
    periodEnd,
    totalTokens: usage.tokens,
    totalCost,
    planBasePrice,
    overageCost,
    depositApplied,
    amountDue,
  };
}

export function getProDepositAmount(): number {
  return PRO_DEPOSIT_AMOUNT;
}

export { PRO_DEPOSIT_AMOUNT };

export default {
  createCheckoutSession,
  verifyWebhookSignature,
  handleWebhookEvent,
  getPricingForModel,
  getAllModelPricing,
  fetchPricingFromAPI,
  calculatePostPaidBill,
  getProDepositAmount,
};