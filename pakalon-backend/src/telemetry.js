"use strict";

const crypto = require("node:crypto");

function toIsoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function parseSince(days = 30) {
  return Date.now() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
}

class TelemetryStore {
  constructor() {
    this.events = [];
  }

  record(event) {
    const stored = {
      id: event.id ?? crypto.randomUUID(),
      eventName: String(event.eventName ?? event.event_name ?? "unknown"),
      userId: event.userId ?? event.user_id ?? null,
      sessionId: event.sessionId ?? event.session_id ?? null,
      properties: event.properties && typeof event.properties === "object" ? event.properties : {},
      createdAt: event.createdAt ?? event.created_at ?? new Date().toISOString(),
    };
    this.events.push(stored);
    return stored;
  }

  list(options = {}) {
    const since = options.since ?? parseSince(options.days ?? 30);
    return this.events.filter((event) => new Date(event.createdAt).getTime() >= since);
  }

  aggregate(options = {}) {
    const events = this.list(options);
    const byDay = new Map();
    const byEventName = new Map();
    const users = new Set();
    const numericTotals = {};

    for (const event of events) {
      const day = toIsoDay(event.createdAt);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      byEventName.set(event.eventName, (byEventName.get(event.eventName) ?? 0) + 1);
      if (event.userId) users.add(event.userId);

      for (const [key, value] of Object.entries(event.properties)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          numericTotals[key] = (numericTotals[key] ?? 0) + value;
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      windowDays: options.days ?? 30,
      totals: {
        events: events.length,
        uniqueUsers: users.size,
        ...numericTotals,
      },
      byDay: Object.fromEntries([...byDay.entries()].sort(([left], [right]) => left.localeCompare(right))),
      byEventName: Object.fromEntries([...byEventName.entries()].sort((left, right) => right[1] - left[1])),
      topEvents: [...byEventName.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([eventName, count]) => ({ eventName, count })),
    };
  }
}

module.exports = {
  TelemetryStore,
};
