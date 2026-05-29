import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '@/utils/logger.js';

export type EventType =
  | 'session.start'
  | 'session.end'
  | 'session.error'
  | 'tool.use'
  | 'tool.result'
  | 'tool.error'
  | 'agent.spawn'
  | 'agent.complete'
  | 'agent.error'
  | 'agent.message'
  | 'mcp.connect'
  | 'mcp.disconnect'
  | 'mcp.error'
  | 'api.request'
  | 'api.response'
  | 'api.error'
  | 'ui.interaction'
  | 'config.change'
  | 'hook.execute'
  | 'workflow.start'
  | 'workflow.complete'
  | 'workflow.error';

export interface AnalyticsEvent {
  id: string;
  type: EventType;
  timestamp: number;
  userId?: string;
  sessionId?: string;
  data: Record<string, unknown>;
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TelemetryConfig {
  enabled?: boolean;
  endpoint?: string;
  apiKey?: string;
  sampleRate?: number;
  batchSize?: number;
  flushInterval?: number;
  retryAttempts?: number;
  retryDelay?: number;
  includeErrors?: boolean;
  includePerformance?: boolean;
  redactPII?: boolean;
}

export interface TelemetryMetrics {
  counter(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  timing(name: string, duration: number, tags?: Record<string, string>): void;
}

interface MetricPoint {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

interface CounterMap {
  [key: string]: number;
}

class TelemetryService extends EventEmitter {
  private config: Required<TelemetryConfig>;
  private events: AnalyticsEvent[] = [];
  private counters: Map<string, CounterMap> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;
  private userId: string | null = null;
  private isShuttingDown = false;

  constructor(config: TelemetryConfig = {}) {
    super();

    this.config = {
      enabled: config.enabled ?? true,
      endpoint: config.endpoint || process.env.TELEMETRY_ENDPOINT || '',
      apiKey: config.apiKey || process.env.TELEMETRY_API_KEY || '',
      sampleRate: config.sampleRate ?? 1.0,
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      includeErrors: config.includeErrors ?? true,
      includePerformance: config.includePerformance ?? true,
      redactPII: config.redactPII ?? true,
    };

    if (this.config.enabled && this.config.endpoint) {
      this.startFlushTimer();
    }
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  trackEvent(event: Omit<AnalyticsEvent, 'id' | 'timestamp'>): void {
    if (!this.config.enabled) {
      return;
    }

    if (Math.random() > this.config.sampleRate) {
      return;
    }

    const analyticsEvent: AnalyticsEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
      sessionId: event.sessionId || this.sessionId || undefined,
      userId: event.userId || this.userId || undefined,
    };

    if (this.config.redactPII) {
      this.redactPII(analyticsEvent);
    }

    this.events.push(analyticsEvent);
    this.emit('event', analyticsEvent);

    if (this.events.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private redactPII(event: AnalyticsEvent): void {
    const piiFields = ['email', 'name', 'password', 'token', 'apiKey', 'secret', 'creditCard'];

    const redactValue = (obj: Record<string, unknown>): void => {
      for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();
        if (piiFields.some((pii) => lowerKey.includes(pii))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactValue(obj[key] as Record<string, unknown>);
        }
      }
    };

    if (event.data) {
      redactValue(event.data);
    }

    if (event.metadata) {
      redactValue(event.metadata);
    }
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    const eventsToFlush = [...this.events];
    this.events = [];

    try {
      if (this.config.endpoint) {
        await this.sendToEndpoint(eventsToFlush);
      }

      this.persistToLocal(eventsToFlush);

      this.emit('flush', eventsToFlush);
    } catch (err) {
      logger.error('Telemetry flush failed:', err);
      this.events.unshift(...eventsToFlush);
      this.scheduleRetry(eventsToFlush);
    }
  }

  private async sendToEndpoint(events: AnalyticsEvent[]): Promise<void> {
    if (!this.config.endpoint) {
      return;
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        events,
        timestamp: Date.now(),
        sessionId: this.sessionId,
        userId: this.userId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Telemetry endpoint returned ${response.status}`);
    }
  }

  private persistToLocal(events: AnalyticsEvent[]): void {
    const localPath = path.join(os.tmpdir(), 'pakalon-telemetry', 'events.jsonl');

    try {
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(localPath, lines, 'utf-8');
    } catch (err) {
      logger.warn('Failed to persist telemetry events locally:', err);
    }
  }

  private scheduleRetry(events: AnalyticsEvent[]): void {
    if (this.isShuttingDown) {
      return;
    }

    setTimeout(async () => {
      try {
        await this.sendToEndpoint(events);
        this.emit('retrySuccess', events.length);
      } catch (err) {
        this.emit('retryFailed', err);
      }
    }, this.config.retryDelay);
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  getMetrics(): TelemetryMetrics {
    return {
      counter: (name: string, value = 1, tags: Record<string, string> = {}) => {
        this.incrementCounter(name, value, tags);
      },

      gauge: (name: string, value: number, tags: Record<string, string> = {}) => {
        this.setGauge(name, value, tags);
      },

      histogram: (name: string, value: number, tags: Record<string, string> = {}) => {
        this.recordHistogram(name, value, tags);
      },

      timing: (name: string, duration: number, tags: Record<string, string> = {}) => {
        this.recordHistogram(`timing.${name}`, duration, tags);
      },
    };
  }

  private incrementCounter(name: string, value: number, tags: Record<string, string>): void {
    const key = this.getMetricKey(name, tags);

    if (!this.counters.has(name)) {
      this.counters.set(name, {});
    }

    const counter = this.counters.get(name)!;
    counter[key] = (counter[key] || 0) + value;
  }

  private setGauge(name: string, value: number, tags: Record<string, string>): void {
    const key = this.getMetricKey(name, tags);
    this.gauges.set(key, value);
  }

  private recordHistogram(name: string, value: number, tags: Record<string, string>): void {
    const key = this.getMetricKey(name, tags);

    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }

    const values = this.histograms.get(key)!;
    values.push(value);

    if (values.length > 1000) {
      values.shift();
    }
  }

  private getMetricKey(name: string, tags: Record<string, string>): string {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    return tagString ? `${name}[${tagString}]` : name;
  }

  getCounter(name: string, tags?: Record<string, string>): number {
    const counter = this.counters.get(name);
    if (!counter) {
      return 0;
    }

    const key = tags ? this.getMetricKey(name, tags) : name;
    return counter[key] || counter[name] || 0;
  }

  getGauge(name: string, tags?: Record<string, string>): number {
    const key = tags ? this.getMetricKey(name, tags) : name;
    return this.gauges.get(key) || 0;
  }

  getHistogram(name: string, tags?: Record<string, string>): {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const key = tags ? this.getMetricKey(name, tags) : name;
    const values = this.histograms.get(key) || [];

    if (values.length === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }
}

export const telemetry = new TelemetryService();

export function createTracker(sessionId?: string, userId?: string) {
  return {
    trackEvent: (event: Omit<AnalyticsEvent, 'id' | 'timestamp'>) => {
      telemetry.trackEvent({
        ...event,
        sessionId: event.sessionId || sessionId,
        userId: event.userId || userId,
      });
    },

    trackToolUse: (toolName: string, args: Record<string, unknown>, duration?: number) => {
      telemetry.trackEvent({
        type: 'tool.use',
        data: { toolName, args },
        duration,
      });
    },

    trackToolResult: (toolName: string, result: unknown, duration?: number) => {
      telemetry.trackEvent({
        type: 'tool.result',
        data: { toolName, success: true },
        duration,
      });
    },

    trackToolError: (toolName: string, error: string) => {
      telemetry.trackEvent({
        type: 'tool.error',
        data: { toolName },
        error,
      });
    },

    trackAgentSpawn: (agentType: string, agentId: string) => {
      telemetry.trackEvent({
        type: 'agent.spawn',
        data: { agentType, agentId },
      });
    },

    trackAgentComplete: (agentId: string, duration: number) => {
      telemetry.trackEvent({
        type: 'agent.complete',
        data: { agentId },
        duration,
      });
    },

    trackAgentError: (agentId: string, error: string) => {
      telemetry.trackEvent({
        type: 'agent.error',
        data: { agentId },
        error,
      });
    },

    trackApiRequest: (endpoint: string, method: string) => {
      telemetry.trackEvent({
        type: 'api.request',
        data: { endpoint, method },
      });
    },

    trackApiResponse: (endpoint: string, method: string, statusCode: number, duration: number) => {
      telemetry.trackEvent({
        type: 'api.response',
        data: { endpoint, method, statusCode },
        duration,
      });
    },

    trackApiError: (endpoint: string, method: string, error: string) => {
      telemetry.trackEvent({
        type: 'api.error',
        data: { endpoint, method },
        error,
      });
    },

    trackSessionStart: (sessionId: string) => {
      telemetry.trackEvent({
        type: 'session.start',
        sessionId,
        data: {},
      });
    },

    trackSessionEnd: (sessionId: string, duration: number) => {
      telemetry.trackEvent({
        type: 'session.end',
        sessionId,
        data: {},
        duration,
      });
    },

    trackSessionError: (sessionId: string, error: string) => {
      telemetry.trackEvent({
        type: 'session.error',
        sessionId,
        data: {},
        error,
      });
    },

    trackWorkflowStart: (workflowName: string) => {
      telemetry.trackEvent({
        type: 'workflow.start',
        data: { workflowName },
      });
    },

    trackWorkflowComplete: (workflowName: string, duration: number, steps: number) => {
      telemetry.trackEvent({
        type: 'workflow.complete',
        data: { workflowName, steps },
        duration,
      });
    },

    trackWorkflowError: (workflowName: string, error: string) => {
      telemetry.trackEvent({
        type: 'workflow.error',
        data: { workflowName },
        error,
      });
    },

    getMetrics: () => telemetry.getMetrics(),
  };
}

export function getGlobalTracker() {
  return createTracker();
}