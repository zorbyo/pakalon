export {
  type EventType,
  type AnalyticsEvent,
  type LogEventMetadata,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  type AnalyticsSink,
  type QueuedEvent,
  type GrowthBookUserAttributes,
  type TraceEventPhase,
  type DiagnosticLogLevel,
  type DiagnosticLogEntry,
  stripProtoFields,
} from './events.js';

export {
  logEvent,
  logEventAsync,
  attachAnalyticsSink,
  _resetForTesting,
} from './analyticsService.js';

export {
  telemetry,
  createTracker,
  getGlobalTracker,
  type TelemetryConfig,
  type TelemetryMetrics,
} from './telemetry.js';

export {
  initializeGrowthBook,
  getFeatureValue,
  getFeatureValue_CACHED_MAY_BE_STALE,
  checkGate_CACHED_OR_BLOCKING,
  getAllGrowthBookFeatures,
  hasGrowthBookEnvOverride,
  onGrowthBookRefresh,
  refreshGrowthBookAfterAuthChange,
  resetGrowthBook,
  type GrowthBookUserAttributes as GBUserAttributes,
} from './growthbook.js';

export {
  logForDiagnosticsNoPII,
  withDiagnosticsTiming,
} from './diagLogs.js';

export {
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
  registerAgent,
  unregisterAgent,
  startLLMRequestPerfettoSpan,
  endLLMRequestPerfettoSpan,
  startToolPerfettoSpan,
  endToolPerfettoSpan,
  startUserInputPerfettoSpan,
  endUserInputPerfettoSpan,
  emitPerfettoInstant,
  emitPerfettoCounter,
  startInteractionPerfettoSpan,
  endInteractionPerfettoSpan,
  getPerfettoEvents,
  resetPerfettoTracer,
  type TraceEvent,
} from './perfetto.js';

export {
  sessionTracing,
  startSessionTrace,
  endSessionTrace,
  recordError,
  startSpan,
  endSpan,
  getTracingMetrics,
  onSessionEvent,
} from './sessionTracing.js';