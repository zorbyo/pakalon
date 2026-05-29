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
} from "./session-events.js";

export {
  SessionEventBus,
  getSessionEventBus,
  resetSessionEventBus,
} from "./session-events.js";
