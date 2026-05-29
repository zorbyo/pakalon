import { EventEmitter } from 'events';
import { getSessionId } from '@/session/index.js';

type SessionEventType =
  | 'session_start'
  | 'session_end'
  | 'session_error'
  | 'interaction_start'
  | 'interaction_end'
  | 'tool_call'
  | 'api_call'
  | 'agent_spawn'
  | 'agent_complete';

interface SessionSpan {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  eventType: SessionEventType;
  metadata?: Record<string, unknown>;
  success?: boolean;
  error?: string;
}

interface SessionMetrics {
  totalInteractions: number;
  totalToolCalls: number;
  totalApiCalls: number;
  totalErrors: number;
  totalDuration: number;
  agentCount: number;
}

class SessionTracing extends EventEmitter {
  private spans: Map<string, SessionSpan> = new Map();
  private currentSessionId: string | null = null;
  private startTime: number = 0;
  private metrics: SessionMetrics = {
    totalInteractions: 0,
    totalToolCalls: 0,
    totalApiCalls: 0,
    totalErrors: 0,
    totalDuration: 0,
    agentCount: 0,
  };

  private spanIdCounter: number = 0;

  constructor() {
    super();
  }

  startSession(sessionId?: string): string {
    const id = sessionId || getSessionId() || this.generateId();
    this.currentSessionId = id;
    this.startTime = Date.now();
    this.spans.clear();
    this.resetMetrics();

    this.emit('session_start', { sessionId: id, timestamp: this.startTime });

    return id;
  }

  endSession(sessionId?: string): void {
    if (sessionId && sessionId !== this.currentSessionId) {
      return;
    }

    const endTime = Date.now();
    const duration = endTime - this.startTime;
    this.metrics.totalDuration = duration;

    this.emit('session_end', {
      sessionId: this.currentSessionId,
      duration,
      metrics: this.getMetrics(),
      timestamp: endTime,
    });

    this.currentSessionId = null;
    this.startTime = 0;
  }

  recordSessionError(error: string, metadata?: Record<string, unknown>): void {
    this.metrics.totalErrors++;
    this.emit('session_error', {
      sessionId: this.currentSessionId,
      error,
      metadata,
      timestamp: Date.now(),
    });
  }

  startSpan(
    name: string,
    eventType: SessionEventType,
    metadata?: Record<string, unknown>,
  ): string {
    const id = this.generateId();
    const span: SessionSpan = {
      id,
      name,
      startTime: Date.now(),
      eventType,
      metadata,
    };

    this.spans.set(id, span);

    if (eventType === 'interaction_start') {
      this.metrics.totalInteractions++;
    } else if (eventType === 'tool_call') {
      this.metrics.totalToolCalls++;
    } else if (eventType === 'api_call') {
      this.metrics.totalApiCalls++;
    } else if (eventType === 'agent_spawn') {
      this.metrics.agentCount++;
    }

    return id;
  }

  endSpan(
    spanId: string,
    options?: { success?: boolean; error?: string; metadata?: Record<string, unknown> },
  ): void {
    const span = this.spans.get(spanId);
    if (!span) {
      return;
    }

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.success = options?.success ?? true;
    span.error = options?.error;
    span.metadata = { ...span.metadata, ...options?.metadata };

    this.emit('span_end', span);

    if (span.eventType === 'session_end') {
      this.emit('session_end', {
        sessionId: this.currentSessionId,
        duration: span.duration,
        timestamp: span.endTime,
      });
    }
  }

  getSpan(spanId: string): SessionSpan | undefined {
    return this.spans.get(spanId);
  }

  getActiveSpans(): SessionSpan[] {
    return Array.from(this.spans.values()).filter((span) => !span.endTime);
  }

  getCompletedSpans(): SessionSpan[] {
    return Array.from(this.spans.values()).filter((span) => span.endTime !== undefined);
  }

  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }

  getSessionDuration(): number {
    if (this.startTime === 0) {
      return 0;
    }
    return Date.now() - this.startTime;
  }

  private resetMetrics(): void {
    this.metrics = {
      totalInteractions: 0,
      totalToolCalls: 0,
      totalApiCalls: 0,
      totalErrors: 0,
      totalDuration: 0,
      agentCount: 0,
    };
  }

  private generateId(): string {
    return `span_${++this.spanIdCounter}_${Date.now()}`;
  }

  clearSpans(): void {
    this.spans.clear();
  }

  reset(): void {
    this.spans.clear();
    this.currentSessionId = null;
    this.startTime = 0;
    this.resetMetrics();
    this.spanIdCounter = 0;
    this.removeAllListeners();
  }
}

export const sessionTracing = new SessionTracing();

export function startSessionTrace(sessionId?: string): string {
  return sessionTracing.startSession(sessionId);
}

export function endSessionTrace(sessionId?: string): void {
  sessionTracing.endSession(sessionId);
}

export function recordError(error: string, metadata?: Record<string, unknown>): void {
  sessionTracing.recordSessionError(error, metadata);
}

export function startSpan(
  name: string,
  eventType: SessionEventType,
  metadata?: Record<string, unknown>,
): string {
  return sessionTracing.startSpan(name, eventType, metadata);
}

export function endSpan(
  spanId: string,
  options?: { success?: boolean; error?: string; metadata?: Record<string, unknown> },
): void {
  sessionTracing.endSpan(spanId, options);
}

export function getTracingMetrics(): SessionMetrics {
  return sessionTracing.getMetrics();
}

export function onSessionEvent(
  event: 'session_start' | 'session_end' | 'session_error' | 'span_end',
  callback: (data: unknown) => void,
): () => void {
  sessionTracing.on(event, callback);
  return () => {
    sessionTracing.off(event, callback);
  };
}