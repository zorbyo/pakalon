/**
 * Hooks Index
 * Central export point for all hooks in the system
 */

// Core hook types and interfaces
export type {
  HookContext,
  HookResult,
  GenericHook,
  PreToolUseContext,
  PreToolUseResult,
  PostToolUseContext,
  PostToolUseResult,
} from './hookHelpers.js';

export type {
  PermissionApprovalSource,
  PermissionRejectionSource,
  PermissionQueueOps,
  ResolveOnce,
  PermissionContext,
} from './toolPermission/PermissionContext.js';

export type { PermissionLogContext, PermissionDecisionArgs } from './toolPermission/permissionLogging.js';

export type {
  HookDecision,
  HookRunResult,
  HookPayload,
  HookDefinition,
  HookEvent,
  LifecycleHookEvent,
  LegacyHookEvent,
  HooksConfig,
  HookContext as ClaudeHookContext,
} from '../ai/hooks.js';

// Hook helpers
export {
  getHookManager,
  registerHook,
  unregisterHook,
  executeHook,
  executeHooks,
  enableHook,
  disableHook,
  clearHooks,
  getHookCount,
  getEnabledHookCount,
} from './hookHelpers.js';

// Pre/Post Tool Use hooks
export {
  registerPreToolUseHook,
  executePreToolUseHooks,
  enablePreToolUseHook,
  disablePreToolUseHook,
  clearAllPreToolUseHooks,
  getPreToolUseHookCount,
  listPreToolUseHooks,
} from './preToolUse.js';

export {
  registerPostToolUseHook,
  executePostToolUseHooks,
  clearAllPostToolUseHooks,
  getPostToolUseHookCount,
} from './postToolUse.js';

// Tool permission hooks
export {
  createPermissionContext,
  createPermissionQueueOps,
  createResolveOnce,
} from './toolPermission/PermissionContext.js';

export {
  isCodeEditingTool,
  buildCodeEditToolAttributes,
  logPermissionDecision,
} from './toolPermission/permissionLogging.js';

// Claude Code compatible hooks (from ai/hooks.ts)
export {
  loadHooksConfig,
  reloadHooksConfig,
  areHooksDisabled,
  addHook,
  removeHook,
  setHooksDisabled,
  initHooksConfig,
  runHooks,
  fireLifecycleHook,
  getHookRunLog,
  onAsyncHookResult,
  runPreWriteHooks,
  runPostWriteHooks,
  runPreEditHooks,
  runPostEditHooks,
  runPrePatchHooks,
  runPostPatchHooks,
  runPreBashHooks,
  runPostBashHooks,
  runStopHook,
  runSubagentStopHook,
  runPreToolUseHook,
  runPostToolUseHook,
  runUserPromptSubmitHook,
  runSessionStartHook,
  wrapToolsWithPreToolUseHook,
  BLOCKING_EVENTS,
  registerLlmCallback,
  registerSubagentCallback,
} from '../ai/hooks.js';

// Manager utilities
export {
  getHooksConfigPath,
  listConfiguredHooks,
  listVendoredHookPresets,
  importVendoredHooks,
  removeConfiguredHookEntry,
  addConfiguredHookEntry,
} from './manager.js';

export type { HookScope, ConfiguredHookEntry, VendoredHookPreset, VendoredHookImportResult } from './manager.js';

// Session hooks
export { runSessionStartHook as sessionStartHook } from './sessionStart.js';
export { runStopHook as stopHook } from './stopHook.js';
export { runPostSamplingHook as postSamplingHook } from './postSampling.js';
export { runPreCompactHook as preCompactHook } from './preCompact.js';
export { runPostCompactHook as postCompactHook } from './postCompact.js';
export { runPermissionDeniedHook as permissionDeniedHook } from './permissionDenied.js';

// Suggestion hooks
export { generateUnifiedSuggestions } from './unifiedSuggestions.js';
export { generateFileSuggestions, type FileSuggestionResult } from './fileSuggestions.js';

// use* React hooks
export { useAfterFirstRender } from './useAfterFirstRender.js';
export { useInputBuffer, type BufferEntry, type UseInputBufferProps, type UseInputBufferResult } from './useInputBuffer.js';
export { useMergedTools } from './useMergedTools.js';
export { useMergedCommands } from './useMergedCommands.js';
export { mergeClients, useMergedClients } from './useMergedClients.js';
export { useCommandQueue } from './useCommandQueue.js';
export { useSettingsChange } from './useSettingsChange.js';
export { useSettings, type ReadonlySettings } from './useSettings.js';
export { useIdeConnectionStatus, type IdeStatus, type IdeConnectionResult } from './useIdeConnectionStatus.js';
export { useIdeSelection, type IDESelection, type SelectionPoint, type SelectionData } from './useIdeSelection.js';
export { useIdeAtMentioned, type IDEAtMentioned } from './useIdeAtMentioned.js';
export { useIdeLogging } from './useIdeLogging.js';
export { useDiffInIDE } from './useDiffInIDE.js';
export { useSearchInput } from './useSearchInput.js';
export { useTextInput } from './useTextInput.js';
export { useVimInput } from './useVimInput.js';
export { useArrowKeyHistory } from './useArrowKeyHistory.js';
export { useTypeahead } from './useTypeahead.js';
export { useDynamicConfig } from './useDynamicConfig.js';
export { useScheduledTasks } from './useScheduledTasks.js';
export { useInboxPoller } from './useInboxPoller.js';
export { useMailboxBridge } from './useMailboxBridge.js';
export { useDeferredHookMessages } from './useDeferredHookMessages.js';
export { useLogMessages } from './useLogMessages.js';
export { useCancelRequest } from './useCancelRequest.js';
export { useAwaySummary } from './useAwaySummary.js';
export { useMemoryUsage } from './useMemoryUsage.js';
export { useElapsedTime } from './useElapsedTime.js';
export { useMinDisplayTime } from './useMinDisplayTime.js';
export { useTimeout } from './useTimeout.js';
export { useDoublePress } from './useDoublePress.js';
export { useExitOnCtrlCD } from './useExitOnCtrlCD.js';
export { useExitOnCtrlCDWithKeybindings } from './useExitOnCtrlCDWithKeybindings.js';
export { useGlobalKeybindings } from './useGlobalKeybindings.js';
export { CommandKeybindingHandlers } from './useCommandKeybindings.jsx';
export { usePasteHandler } from './usePasteHandler.js';
export { useClipboardImageHint } from './useClipboardImageHint.js';
export { useCopyOnSelect } from './useCopyOnSelect.js';
export { useBlink } from './useBlink.js';
export { useVirtualScroll } from './useVirtualScroll.js';
export { useHistorySearch } from './useHistorySearch.js';
export { useAssistantHistory } from './useAssistantHistory.js';
export { usePromptSuggestion } from './usePromptSuggestion.js';
export { useTurnDiffs } from './useTurnDiffs.js';
export { useDiffData } from './useDiffData.js';
export { useTaskListWatcher } from './useTaskListWatcher.js';
export { useTasksV2 } from './useTasksV2.js';
export { useQueueProcessor } from './useQueueProcessor.js';
export { useTerminalSize } from './useTerminalSize.js';
export { useRemoteSession } from './useRemoteSession.js';
export { useSSHSession } from './useSSHSession.js';
export { useDirectConnect } from './useDirectConnect.js';
export { useTeleportResume } from './useTeleportResume.js';
export { useSessionBackgrounding } from './useSessionBackgrounding.js';
export { useBackgroundTaskNavigation } from './useBackgroundTaskNavigation.js';
export { useManagePlugins } from './useManagePlugins.js';
export { useSkillsChange } from './useSkillsChange.js';
export { useSkillImprovementSurvey } from './useSkillImprovementSurvey.js';
export { useUpdateNotification } from './useUpdateNotification.js';
export { useNotifyAfterTimeout } from './useNotifyAfterTimeout.js';
export { useFileHistorySnapshotInit } from './useFileHistorySnapshotInit.js';
export { usePrStatus } from './usePrStatus.js';
export { useVoiceEnabled } from './useVoiceEnabled.js';
export { useVoice } from './useVoice.js';
export { useMainLoopModel } from './useMainLoopModel.js';
export { useSwarmInitialization } from './useSwarmInitialization.js';
export { useSwarmPermissionPoller } from './useSwarmPermissionPoller.js';
export { useTeammateViewAutoExit } from './useTeammateViewAutoExit.js';
export { useIssueFlagBanner } from './useIssueFlagBanner.js';
export { renderPlaceholder, type PlaceholderRendererProps } from './renderPlaceholder.js';
export { usePluginRecommendationBase, installPluginAndNotify } from './usePluginRecommendationBase.js';