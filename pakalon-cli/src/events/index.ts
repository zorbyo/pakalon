/**
 * Session Events — typed event catalog for extensions and components.
 */
export type {
  SessionEventType,
  SessionEvent,
  SessionEventListener,
  Unsubscribe,
  AssistantMessageEvent,
  ToolExecutionStartEvent,
  ToolExecutionCompleteEvent,
  ToolExecutionErrorEvent,
  UserMessageEvent,
  SessionStartEvent,
  SessionIdleEvent,
  SessionErrorEvent,
  SessionShutdownEvent,
  PermissionRequestedEvent,
  PermissionDecidedEvent,
  ExtensionLoadedEvent,
  ExtensionUnloadedEvent,
  ExtensionErrorEvent,
  SessionCompactionEvent,
  TurnStartEvent,
  TurnEndEvent,
  // New events from harness.md implementation
  QueueUpdateEvent,
  SavePointEvent,
  AbortEvent,
  SettledEvent,
  ModelSelectEvent,
  ThinkingLevelSelectEvent,
  ResourcesUpdateEvent,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  SessionBeforeTreeEvent,
  SessionTreeEvent,
  ProviderBeforeRequestEvent,
  ProviderBeforePayloadEvent,
  ProviderAfterResponseEvent,
} from "./session-events.js";

export {
  SessionEventBus,
  getSessionEventBus,
  resetSessionEventBus,
} from "./session-events.js";
