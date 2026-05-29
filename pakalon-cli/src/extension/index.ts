/**
 * Extension System - Copilot CLI parity.
 *
 * Extensions run as separate Node.js child processes communicating via
 * JSON-RPC over stdio. They can register custom tools, lifecycle hooks,
 * subscribe to session events, and send programmatic messages.
 *
 * Discovery:
 * - Project: .pakalon/extensions/[name]/extension.mjs
 * - User: ~/.pakalon/extensions/[name]/extension.mjs
 *
 * Hot-reload: File changes trigger automatic extension restart.
 */
export type {
  ExtensionManifest,
  ExtensionInstance,
  ExtensionStatus,
  ToolRegistration,
  HookRegistration,
  HookType,
  HookContext,
  HookDecision,
  SessionEventType,
  SessionEvent,
  SessionEventListener,
  ElicitationRequest,
  ElicitationResult,
  ElicitationField,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ExtensionSDK,
} from "./types.js";

export { JsonRpcChannel, JSON_RPC_ERROR_CODES } from "./rpc.js";
export { ExtensionRuntime } from "./runtime.js";
export {
  ExtensionManager,
  discoverExtensions,
} from "./registry.js";
export type { DiscoveredExtension } from "./registry.js";
export {
  HotReloadWatcher,
  createAutoReloadWatcher,
} from "./hot-reload.js";
