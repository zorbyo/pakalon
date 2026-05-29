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
  | 'workflow.error'
  | 'analytics_sink_attached'
  | 'command.start'
  | 'command.complete'
  | 'error.unhandled';

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

export type LogEventMetadata = { [key: string]: boolean | number | undefined | string };

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never;

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never;

export function stripProtoFields<V>(metadata: Record<string, V>): Record<string, V> {
  let result: Record<string, V> | undefined;
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata };
      }
      delete result[key];
    }
  }
  return result ?? metadata;
}

export interface QueuedEvent {
  eventName: string;
  metadata: LogEventMetadata;
  async: boolean;
}

export interface AnalyticsSink {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void;
  logEventAsync: (eventName: string, metadata: LogEventMetadata) => Promise<void>;
}

export interface GrowthBookUserAttributes {
  id: string;
  sessionId: string;
  deviceID: string;
  platform: 'win32' | 'darwin' | 'linux';
  apiBaseUrlHost?: string;
  organizationUUID?: string;
  accountUUID?: string;
  userType?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  firstTokenTime?: number;
  email?: string;
  appVersion?: string;
  github?: {
    actions?: boolean;
    workflow?: string;
    runner?: string;
  };
}

export type TraceEventPhase =
  | 'B'
  | 'E'
  | 'X'
  | 'i'
  | 'C'
  | 'b'
  | 'n'
  | 'e'
  | 'M';

export interface TraceEvent {
  name: string;
  cat: string;
  ph: TraceEventPhase;
  ts: number;
  pid: number;
  tid: number;
  dur?: number;
  args?: Record<string, unknown>;
  id?: string;
  scope?: string;
}

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLogEntry {
  timestamp: string;
  level: DiagnosticLogLevel;
  event: string;
  data: Record<string, unknown>;
}