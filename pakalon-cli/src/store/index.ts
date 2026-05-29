/**
 * Zustand store — combines all slices into a single app store.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { useShallow } from "zustand/shallow";

import { createAgentDefinitionsSlice, type AgentDefinitionsState } from "@/store/slices/agentDefinitions.slice.js";
import { createAuthSlice, type AuthState } from "@/store/slices/auth.slice.js";
import { createComputerUseSlice, type ComputerUseState } from "@/store/slices/computerUse.slice.js";
import { createSessionSlice, type SessionState } from "@/store/slices/session.slice.js";
import { createInboxSlice, type InboxState } from "@/store/slices/inbox.slice.js";
import { createMcpConnectionSlice, type MCPConnectionState } from "@/store/slices/mcpConnection.slice.js";
import { createModelSlice, type ModelState } from "@/store/slices/model.slice.js";
import { createModeSlice, type ModeState } from "@/store/slices/mode.slice.js";
import { createPluginManagerSlice, type PluginManagerState } from "@/store/slices/pluginManager.slice.js";
import { createPromptSuggestionSlice, type PromptSuggestionState } from "@/store/slices/promptSuggestion.slice.js";
import { createStreamingSlice, type StreamingState } from "@/store/slices/streaming.slice.js";
import { createReplBridgeSlice, type ReplBridgeState } from "@/store/slices/replBridge.slice.js";
import { createTaskStateSlice, type TaskStateSlice } from "@/store/slices/taskState.slice.js";
import { createCreditsSlice, type CreditsState } from "@/store/slices/credits.slice.js";
import { createFileChangesSlice, type FileChangesState } from "@/store/slices/fileChanges.slice.js";
import { createTeamContextSlice, type TeamContextState } from "@/store/slices/teamContext.slice.js";
import { createTodoSlice, type TodoState } from "@/store/slices/todo.slice.js";
import { createPhaseSlice, type PhaseState, setOnPhaseActionCallback, clearOnPhaseActionCallback } from "@/store/slices/phase.slice.js";
import { createPermissionsSlice, type PermissionsState } from "@/store/slices/permissions.slice.js";

export type {
  AgentDefinition,
  AgentDefinitionsState,
} from "@/store/slices/agentDefinitions.slice.js";
export type {
  ComputerUseState,
  ComputerUseConnectionStatus,
  ScreenshotQuality,
} from "@/store/slices/computerUse.slice.js";
export type { InboxMessage, InboxState } from "@/store/slices/inbox.slice.js";
export type { MCPConnectionState, MCPConnectionStatus, MCPServerConnectionState } from "@/store/slices/mcpConnection.slice.js";
export type { PluginManagerState, PluginInstallationStatus } from "@/store/slices/pluginManager.slice.js";
export type { PromptSuggestionState } from "@/store/slices/promptSuggestion.slice.js";
export type { ReplBridgeState, ReplBridgeMode, ReplBridgeStatusLineType } from "@/store/slices/replBridge.slice.js";
export type { TaskRecord, TaskState, TaskStateSlice, TaskStatus } from "@/store/slices/taskState.slice.js";
export type { TeamContextState, TeamMember } from "@/store/slices/teamContext.slice.js";

export type AppStore = AuthState &
  SessionState &
  ModelState &
  ModeState &
  StreamingState &
  CreditsState &
  FileChangesState &
  TodoState &
  PhaseState &
  PermissionsState &
  MCPConnectionState &
  PluginManagerState &
  ReplBridgeState &
  TaskStateSlice &
  AgentDefinitionsState &
  PromptSuggestionState &
  InboxState &
  TeamContextState &
  ComputerUseState;

function getPersistDir(): string {
  const base =
    process.env.PAKALON_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "pakalon")
      : path.join(os.homedir(), ".config", "pakalon"));
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  }
  return base;
}

const filePersistStorage: StateStorage = {
  getItem: (name) => {
    try {
      const filePath = path.join(getPersistDir(), `${name}.json`);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const filePath = path.join(getPersistDir(), `${name}.json`);
      fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Best-effort persistence only; auth credentials are still stored separately.
    }
  },
  removeItem: (name) => {
    try {
      const filePath = path.join(getPersistDir(), `${name}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup failures.
    }
  },
};

export const useStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createSessionSlice(...args),
      ...createModelSlice(...args),
      ...createModeSlice(...args),
      ...createMcpConnectionSlice(...args),
      ...createPluginManagerSlice(...args),
      ...createReplBridgeSlice(...args),
      ...createTaskStateSlice(...args),
      ...createAgentDefinitionsSlice(...args),
      ...createPromptSuggestionSlice(...args),
      ...createInboxSlice(...args),
      ...createTeamContextSlice(...args),
      ...createComputerUseSlice(...args),
      ...createStreamingSlice(...args),
      ...createCreditsSlice(...args),
      ...createFileChangesSlice(...args),
      ...createTodoSlice(...args),
      ...createPhaseSlice(...args),
      ...createPermissionsSlice(...args),
    }),
    {
      name: "pakalon-store",
      storage: createJSONStorage(() => filePersistStorage),
      // Only persist auth-related fields
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
        plan: state.plan,
        isLoggedIn: state.isLoggedIn,
        githubLogin: state.githubLogin,
        displayName: state.displayName,
        trialDaysRemaining: state.trialDaysRemaining,
        billingDaysRemaining: state.billingDaysRemaining,
        selectedModel: state.selectedModel,
        hasEverLoggedIn: state.hasEverLoggedIn,
      }),
    }
  )
);

// Convenience selector hooks
export const useAuth = () =>
  useStore(useShallow((s) => ({
    token: s.token,
    userId: s.userId,
    plan: s.plan,
    isLoggedIn: s.isLoggedIn,
    githubLogin: s.githubLogin,
    displayName: s.displayName,
    trialDaysRemaining: s.trialDaysRemaining,
    billingDaysRemaining: s.billingDaysRemaining,
    hasEverLoggedIn: s.hasEverLoggedIn,
    login: s.login,
    logout: s.logout,
    syncProfile: s.syncProfile,
    restoreSession: s.restoreSession,
    markLaunched: s.markLaunched,
  })));

export const useSession = () =>
  useStore(useShallow((s) => ({
    sessionId: s.sessionId,
    messages: s.messages,
    isLoading: s.isLoading,
    isStreaming: s.isStreaming,
    remainingPct: s.remainingPct,
    runtimeTokensUsed: s.runtimeTokensUsed,
    sessionStartedAt: s.sessionStartedAt,
    setRemainingPct: s.setRemainingPct,
    setRuntimeTokensUsed: s.setRuntimeTokensUsed,
    incrementRuntimeTokensUsed: s.incrementRuntimeTokensUsed,
    resetRuntimeMetrics: s.resetRuntimeMetrics,
    addMessage: s.addMessage,
    updateLastMessage: s.updateLastMessage,
    appendToLastMessage: s.appendToLastMessage,
    updateMessageById: s.updateMessageById,
    appendToMessage: s.appendToMessage,
    finalizeStreamingMessage: s.finalizeStreamingMessage,
    clearMessages: s.clearMessages,
    clearSession: s.clearSession,
    setSessionStartedAt: s.setSessionStartedAt,
    setLoading: s.setLoading,
    setStreaming: s.setStreaming,
  })));

export const useModel = () =>
  useStore(useShallow((s) => ({
    selectedModel: s.selectedModel,
    availableModels: s.availableModels,
    autoModel: s.autoModel,
    isLoadingModels: s.isLoadingModels,
    lastModelsFetchAt: s.lastModelsFetchAt,
    setSelectedModel: s.setSelectedModel,
    setAvailableModels: s.setAvailableModels,
    setAutoModel: s.setAutoModel,
    refreshModels: s.refreshModels,
  })));

export const useMode = () =>
  useStore(useShallow((s) => ({
    mode: s.mode,
    permissionMode: s.permissionMode,
    thinkingEnabled: s.thinkingEnabled,
    isAgentRunning: s.isAgentRunning,
    agentCurrentStep: s.agentCurrentStep,
    agentProgress: s.agentProgress,
    verbose: s.verbose,
    privacyLevel: s.privacyLevel,
    autoCompact: s.autoCompact,
    autoCompactThreshold: s.autoCompactThreshold,
    setMode: s.setMode,
    cyclePermissionMode: s.cyclePermissionMode,
    setPermissionMode: s.setPermissionMode,
    toggleThinking: s.toggleThinking,
    toggleVerbose: s.toggleVerbose,
    setPrivacyLevel: s.setPrivacyLevel,
    setPrivacyMode: s.setPrivacyMode,
    toggleAutoCompact: s.toggleAutoCompact,
    setAutoCompact: s.setAutoCompact,
    setAutoCompactThreshold: s.setAutoCompactThreshold,
    setAgentRunning: s.setAgentRunning,
    setAgentStep: s.setAgentStep,
    setAgentProgress: s.setAgentProgress,
    runningCommands: s.runningCommands,
    startCommand: s.startCommand,
    completeCommand: s.completeCommand,
    isCommandRunning: s.isCommandRunning,
  })));

export const useStreaming = () =>
  useStore(useShallow((s) => ({
    isStreaming: s.isStreaming,
    isThinking: s.isThinking,
    thinkContent: s.thinkContent,
    streamTokenCount: s.streamTokenCount,
    appendStreamChunk: s.appendStreamChunk,
    setThinkContent: s.setThinkContent,
    setThinking: s.setThinking,
    appendThinkChunk: s.appendThinkChunk,
    reset: s.reset,
    resetStream: s.resetStream,
  })));
export const useCredits = () =>
  useStore(useShallow((s) => ({
    creditBalance: s.creditBalance,
    creditsLoading: s.creditsLoading,
    fetchCredits: s.fetchCredits,
    setCreditsBalance: s.setCreditsBalance,
  })));

export const useFileChanges = () =>
  useStore(useShallow((s) => ({
    sessionLinesAdded: s.sessionLinesAdded,
    sessionLinesDeleted: s.sessionLinesDeleted,
    changedFiles: s.changedFiles,
    recordFileChange: s.recordFileChange,
    clearFileChanges: s.clearFileChanges,
  })));

export const useTodos = () =>
  useStore(useShallow((s) => ({
    todos: s.todos,
    showTodos: s.showTodos,
    addTodo: s.addTodo,
    updateTodo: s.updateTodo,
    removeTodo: s.removeTodo,
    toggleTodoStatus: s.toggleTodoStatus,
    getTodos: s.getTodos,
    setShowTodos: s.setShowTodos,
    clearCompleted: s.clearCompleted,
  })));

export const usePhase = () =>
  useStore(useShallow((s) => ({
    currentPhase: s.currentPhase,
    buttons: s.buttons,
    messageId: s.messageId,
    isAwaitingAction: s.isAwaitingAction,
    designApproved: s.designApproved,
    editConfirmed: s.editConfirmed,
    auditFindings: s.auditFindings,
    setCurrentPhase: s.setCurrentPhase,
    setActionButtons: s.setActionButtons,
    clearActionButtons: s.clearActionButtons,
    triggerPhaseAction: s.triggerPhaseAction,
    setDesignApproved: s.setDesignApproved,
    setEditConfirmed: s.setEditConfirmed,
    setAuditFindings: s.setAuditFindings,
    setAwaitingAction: s.setAwaitingAction,
  })));

export { setOnPhaseActionCallback, clearOnPhaseActionCallback };

export * from "@/store/slices/agentDefinitions.slice.js";
export * from "@/store/slices/computerUse.slice.js";
export * from "@/store/slices/inbox.slice.js";
export * from "@/store/slices/mcpConnection.slice.js";
export * from "@/store/slices/pluginManager.slice.js";
export * from "@/store/slices/promptSuggestion.slice.js";
export * from "@/store/slices/replBridge.slice.js";
export * from "@/store/slices/taskState.slice.js";
export * from "@/store/slices/teamContext.slice.js";
