import { tool } from 'ai';
import { z } from 'zod';
import { useStore } from '@/store/index.js';

export type PlanMode = 'plan' | 'edit';

let currentPlanMode: PlanMode = 'edit';
let planModeHistory: PlanMode[] = [];

export function isPlanMode(): boolean {
  return currentPlanMode === 'plan';
}

export function isEditMode(): boolean {
  return currentPlanMode === 'edit';
}

export function getCurrentPlanMode(): PlanMode {
  return currentPlanMode;
}

export function enterPlanMode(): { success: boolean; previousMode: PlanMode } {
  const previousMode = currentPlanMode;

  if (previousMode !== 'plan') {
    planModeHistory.push(previousMode);
    currentPlanMode = 'plan';

    const { permissionMode } = useStore.getState();
    useStore.getState().setPermissionMode('plan');
  }

  return { success: true, previousMode };
}

export function exitPlanMode(): { success: boolean; previousMode: PlanMode } {
  const previousMode = currentPlanMode;

  if (previousMode === 'plan' && planModeHistory.length > 0) {
    currentPlanMode = planModeHistory.pop()!;

    const { permissionMode } = useStore.getState();
    if (currentPlanMode === 'edit') {
      useStore.getState().setPermissionMode('normal');
    }
  }

  return { success: true, previousMode };
}

export function togglePlanMode(): { previousMode: PlanMode; newMode: PlanMode } {
  const previousMode = currentPlanMode;

  if (previousMode === 'plan') {
    exitPlanMode();
  } else {
    enterPlanMode();
  }

  return { previousMode, newMode: currentPlanMode };
}

export function getPlanModeHistory(): PlanMode[] {
  return [...planModeHistory];
}

export function clearPlanModeHistory(): void {
  planModeHistory = [];
}

export function isWriteToolBlocked(toolName: string): boolean {
  if (!isPlanMode()) {
    return false;
  }

  const writeTools = [
    'Write',
    'Edit',
    'Bash',
    'NotebookEdit',
    'MultiEdit',
    'FileWrite',
    'FileEdit',
  ];

  const dangerousTools = [
    'Bash',
    'PowerShell',
    'Agent',
    'TaskCreate',
    'TaskUpdate',
    'Delete',
    'Remove',
    'Install',
    'Uninstall',
    'NpmInstall',
    'NpmUninstall',
    'GitPush',
    'GitCommit',
  ];

  return writeTools.includes(toolName) || dangerousTools.includes(toolName);
}

export function getPlanModeBlockMessage(toolName: string): string {
  return `Tool '${toolName}' is blocked in plan mode. ` +
    `Plan mode is read-only. ` +
    `Use 'exit_plan_mode' to return to edit mode.`;
}

export const enterPlanModeTool = tool({
  description: 'Enter plan mode. In plan mode, all file modification and shell command tools are blocked. Only read-only tools like Read, Glob, Grep, WebSearch, and WebFetch are allowed. Use this when you need to think through a problem before making changes.',
  inputSchema: z.object({}),
  execute: async () => {
    const result = enterPlanMode();
    return {
      success: result.success,
      mode: 'plan',
      message: `Entered plan mode. All write operations are now blocked.`,
    };
  },
});

export const exitPlanModeTool = tool({
  description: 'Exit plan mode and return to edit mode. In edit mode, all tools are available including file modifications and shell commands.',
  inputSchema: z.object({}),
  execute: async () => {
    const result = exitPlanMode();
    return {
      success: result.success,
      mode: 'edit',
      message: `Exited plan mode. All tools are now available.`,
    };
  },
});

export const togglePlanModeTool = tool({
  description: 'Toggle between plan mode and edit mode.',
  inputSchema: z.object({}),
  execute: async () => {
    const result = togglePlanMode();
    return {
      success: true,
      previousMode: result.previousMode,
      newMode: result.newMode,
      message: `Switched from ${result.previousMode} mode to ${result.newMode} mode.`,
    };
  },
});

export const getPlanModeStatusTool = tool({
  description: 'Get the current plan mode status',
  inputSchema: z.object({}),
  execute: async () => {
    return {
      currentMode: getCurrentPlanMode(),
      isPlanMode: isPlanMode(),
      isEditMode: isEditMode(),
      historyLength: planModeHistory.length,
    };
  },
});

export function getAllPlanModeTools() {
  return {
    enter_plan_mode: enterPlanModeTool,
    exit_plan_mode: exitPlanModeTool,
    toggle_plan_mode: togglePlanModeTool,
    plan_mode_status: getPlanModeStatusTool,
  };
}