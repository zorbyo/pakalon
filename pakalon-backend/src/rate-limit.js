"use strict";

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;

const ROUTE_LIMITS = [
  { method: "POST", prefix: "/auth/devices", limit: 10 },
  { method: "POST", prefix: "/auth/confirm", limit: 20 },
  { method: "POST", prefix: "/billing", limit: 30 },
  { method: "POST", prefix: "/webhooks", limit: 200 },
  { method: "POST", prefix: "/sessions", limit: 50 },
];

const AI_PLAN_LIMITS = [
  {
    method: "POST",
    prefix: "/ai/chat",
    limits: { free: 60, pro: 300, default: 60 },
  },
];

function resolveRouteLimit(method, pathname, plan) {
  for (const route of AI_PLAN_LIMITS) {
    if (method === route.method && pathname.startsWith(route.prefix)) {
      return route.limits[plan] ?? route.limits.default;
    }
  }

  for (const route of ROUTE_LIMITS) {
    if (method === route.method && pathname.startsWith(route.prefix)) {
      return route.limit;
    }
  }

  return DEFAULT_LIMIT;
}

function buildRateLimitHeaders(result) {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.retryAfter > 0 ? { "Retry-After": String(Math.ceil(result.retryAfter / 1000)) } : {}),
  };
}

class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.events = new Map();
  }

  check(key, limit, now = Date.now()) {
    const windowStart = now - this.windowMs;
    const bucket = (this.events.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    const allowed = bucket.length < limit;

    if (allowed) {
      bucket.push(now);
    }

    this.events.set(key, bucket);

    const oldest = bucket[0] ?? now;
    const resetAt = oldest + this.windowMs;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.length),
      resetAt,
      retryAfter: allowed ? 0 : Math.max(0, resetAt - now),
    };
  }

  cleanup(now = Date.now()) {
    const windowStart = now - this.windowMs;
    for (const [key, bucket] of this.events.entries()) {
      const next = bucket.filter((timestamp) => timestamp > windowStart);
      if (next.length === 0) this.events.delete(key);
      else this.events.set(key, next);
    }
  }
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_MS,
  SlidingWindowRateLimiter,
  buildRateLimitHeaders,
  resolveRouteLimit,
};
