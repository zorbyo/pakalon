/**
 * Mode slice — manages CLI interaction mode, verbose, and privacy flags.
 */
import type { StateCreator } from "zustand";

export type InteractionMode = "chat" | "agent" | "headless";

export type LegacyPermissionMode = "edit" | "bypass";

export type PrivacyLevel = "off" | "metadata" | "full";

export function normalizePrivacyLevel(value?: PrivacyLevel | boolean | null): PrivacyLevel {
  if (value === true) return "full";
  if (value === false) return "off";
  return value ?? "off";
}

/**
 * Permission mode controls how aggressively Pakalon acts autonomously.
 * Cycles via Shift+Tab key: plan → auto-accept → orchestration → normal → plan
 *
 * - plan:          Planning-first; no autonomous file changes
 * - auto-accept:   Applies edits and runs commands automatically
 * - orchestration: Brainstorming / Q&A mode with tooling disabled
 * - normal:        Interactive execution; asks for approval before tools run
 */
export type PermissionMode = "plan" | "normal" | "auto-accept" | "orchestration";
const PERMISSION_CYCLE: PermissionMode[] = ["plan", "auto-accept", "orchestration", "normal"];

export function normalizePermissionMode(mode?: PermissionMode | LegacyPermissionMode | null): PermissionMode {
  if (mode === "edit") return "normal";
  if (mode === "bypass") return "auto-accept";
  return mode ?? "normal";
}

/** Parameters for the 6-phase bridge pipeline launched via /build */
export interface BridgeModeParams {
  userPrompt: string;
  userId: string;
  userPlan: string;
  isYolo: boolean;
  privacyLevel?: PrivacyLevel;
  figmaUrl?: string;
  targetUrl?: string;
  startPhase?: number;
  endPhase?: number;
}

export type EffortLevel = "low" | "medium" | "high" | "extra-high";
export type DeepseekMode = "reasoning" | "chat";
export type AnthropicMode = "thinking" | "default";

export type ModelEffortConfig =
  | { provider: "openai"; effort: EffortLevel }
  | { provider: "gemini"; effort: EffortLevel }
  | { provider: "deepseek"; mode: DeepseekMode }
  | { provider: "anthropic"; mode: AnthropicMode }
  | { provider: "default"; effort: EffortLevel };

export interface CommandExecutionState {
  id: string;
  commandName: string;
  startTime: number;
  status: "running" | "completed" | "error";
  sessionId?: string;
}

export interface ModeState {
  mode: InteractionMode;
  permissionMode: PermissionMode;
  uiColorMode: "orange" | "blue" | "red" | "green";
  thinkingEnabled: boolean;
  isAgentRunning: boolean;
  agentCurrentStep: string | null;
  agentProgress: number;
  verbose: boolean;
  privacyLevel: PrivacyLevel;
  autoCompact: boolean;
  autoCompactThreshold: number;
  pendingBridgeMode: BridgeModeParams | null;
  modelEffortConfig: ModelEffortConfig | null;
  clipboardNotification: string | null;
  clipboardNotificationExpiry: number | null;
  runningCommands: CommandExecutionState[];
  setMode: (mode: InteractionMode) => void;
  cyclePermissionMode: () => void;
  cyclePermissionModeWithTheme: () => void;
  toggleUiColorMode: () => void;
  setPermissionMode: (mode: PermissionMode | LegacyPermissionMode) => void;
  toggleThinking: () => void;
  setAgentRunning: (running: boolean) => void;
  setAgentStep: (step: string | null) => void;
  setAgentProgress: (progress: number) => void;
  toggleVerbose: () => void;
  setPrivacyLevel: (level: PrivacyLevel) => void;
  setPrivacyMode: (enabled: boolean) => void;
  toggleAutoCompact: () => void;
  setAutoCompact: (enabled: boolean) => void;
  setAutoCompactThreshold: (threshold: number) => void;
  launchBridgePipeline: (params: BridgeModeParams) => void;
  clearBridgeMode: () => void;
  setModelEffortConfig: (config: ModelEffortConfig | null) => void;
  showClipboardNotification: (msg: string, durationMs?: number) => void;
  clearClipboardNotification: () => void;
  startCommand: (name: string, sessionId?: string) => string;
  completeCommand: (commandName: string, status?: "completed" | "error") => void;
  isCommandRunning: (commandName: string) => boolean;
}

export const createModeSlice: StateCreator<
   ModeState,
   [],
   [],
   ModeState
> = (set, get) => ({
   mode: "chat",
   permissionMode: "normal",
   uiColorMode: "orange",
   thinkingEnabled: false,
   isAgentRunning: false,
   agentCurrentStep: null,
   agentProgress: 0,
    verbose: false,
    privacyLevel: "off",
    autoCompact: true,
   autoCompactThreshold: 0.90,
   pendingBridgeMode: null,
   modelEffortConfig: null,
   clipboardNotification: null,
   clipboardNotificationExpiry: null,
   runningCommands: [],

   cyclePermissionModeWithTheme: () => set((s) => {
     const idx = PERMISSION_CYCLE.indexOf(s.permissionMode);
     const next = PERMISSION_CYCLE[(idx + 1) % PERMISSION_CYCLE.length];
     const nextColor = next === "plan"
       ? "blue"
       : next === "auto-accept"
         ? "red"
         : next === "orchestration"
           ? "green"
           : "orange";
     return { permissionMode: next, uiColorMode: nextColor };
   }),

   setMode: (mode) => set({ mode }),
   cyclePermissionMode: () =>
     set((s) => {
       const idx = PERMISSION_CYCLE.indexOf(s.permissionMode);
       const next = PERMISSION_CYCLE[(idx + 1) % PERMISSION_CYCLE.length];
       const nextColor = next === "plan"
         ? "blue"
         : next === "auto-accept"
           ? "red"
           : next === "orchestration"
             ? "green"
             : "orange";
       return { permissionMode: next, uiColorMode: nextColor };
     }),
   toggleUiColorMode: () => set((s) => ({ 
     uiColorMode: s.uiColorMode === "orange" ? "blue" : "orange" 
   })),
   setPermissionMode: (mode) => {
     const next = normalizePermissionMode(mode);
     const nextColor = next === "plan"
       ? "blue"
       : next === "auto-accept"
         ? "red"
         : next === "orchestration"
           ? "green"
           : "orange";
     set({ permissionMode: next, uiColorMode: nextColor });
   },
   toggleThinking: () => set((s) => ({ thinkingEnabled: !s.thinkingEnabled })),
   setAgentRunning: (running) => set({ isAgentRunning: running }),
   setAgentStep: (step) => set({ agentCurrentStep: step }),
   setAgentProgress: (progress) => set({ agentProgress: progress }),
   toggleVerbose: () => set((s) => ({ verbose: !s.verbose })),
    setPrivacyLevel: (level) => set({ privacyLevel: level }),
    setPrivacyMode: (enabled) => set({ privacyLevel: enabled ? "full" : "off" }),
    toggleAutoCompact: () => set((s) => ({ autoCompact: !s.autoCompact })),
   setAutoCompact: (enabled) => set({ autoCompact: enabled }),
   setAutoCompactThreshold: (threshold) => set({ autoCompactThreshold: Math.max(0.5, Math.min(0.99, threshold)) }),
   launchBridgePipeline: (params) => set({ pendingBridgeMode: params, mode: "agent" }),
   clearBridgeMode: () => set({ pendingBridgeMode: null }),
   setModelEffortConfig: (config) => set({ modelEffortConfig: config }),
   showClipboardNotification: (msg, durationMs = 5000) => set({
     clipboardNotification: msg,
     clipboardNotificationExpiry: Date.now() + durationMs,
   }),
   clearClipboardNotification: () => set({ clipboardNotification: null, clipboardNotificationExpiry: null }),

   startCommand: (name, sessionId) => {
     const id = `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
     const cmd: CommandExecutionState = {
       id,
       commandName: name,
       startTime: Date.now(),
       status: "running",
       sessionId,
     };
     set((s) => ({ runningCommands: [...s.runningCommands, cmd] }));
     return id;
   },

   completeCommand: (commandNameOrId, status = "completed") => {
      set((s) => {
        // Match by unique id first; fall back to command name for slash commands
        const hasIdMatch = s.runningCommands.some(
          (cmd) => cmd.id === commandNameOrId,
        );
        return {
          runningCommands: s.runningCommands.map((cmd) => {
            if (hasIdMatch) {
              return cmd.id === commandNameOrId ? { ...cmd, status } : cmd;
            }
            // Name-based match: update all running commands with this name
            if (cmd.commandName === commandNameOrId && cmd.status === "running") {
              return { ...cmd, status };
            }
            return cmd;
          }),
        };
      });
      // Auto-cleanup: remove completed/failed entries older than 10 seconds
      const cutoff = Date.now() - 10_000;
      setTimeout(() => {
        set((s) => ({
          runningCommands: s.runningCommands.filter(
            (cmd) => cmd.status === "running" || cmd.startTime > cutoff,
          ),
        }));
      }, 10_500);
   },

   isCommandRunning: (commandName) => {
     return get().runningCommands.some((cmd) => cmd.commandName === commandName && cmd.status === "running");
   },
 });
