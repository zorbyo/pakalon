/**
 * Plan Mode Tools Module
 *
 * Tools for entering and exiting plan mode to review proposed changes
 * before applying them. In plan mode, file modifications and shell commands
 * are blocked - only read-only tools are allowed.
 *
 * @example
 * ```typescript
 * import { EnterPlanModeTool, ExitPlanModeTool, planModeTools } from './tools/plan-mode';
 *
 * // Or import individual tools
 * import { EnterPlanModeTool } from './tools/plan-mode/enter-plan-mode-tool';
 * import { ExitPlanModeTool } from './tools/plan-mode/exit-plan-mode-tool';
 * ```
 */

export { EnterPlanModeTool } from './enter-plan-mode-tool.js';
export type { Output as EnterPlanModeOutput } from './enter-plan-mode-tool.js';

export { ExitPlanModeTool } from './exit-plan-mode-tool.js';
export type {
  Output as ExitPlanModeOutput,
  AllowedPrompt,
} from './exit-plan-mode-tool.js';

export { ENTER_PLAN_MODE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from './constants.js';

export type {
  EnterPlanModeInput,
  EnterPlanModeOutput as EnterPlanModeToolOutput,
  ExitPlanModeInput,
  ExitPlanModeOutput as ExitPlanModeToolOutput,
  AllowedPrompt as PlanModeAllowedPrompt,
} from './types.js';

import { EnterPlanModeTool } from './enter-plan-mode-tool.js';
import { ExitPlanModeTool } from './exit-plan-mode-tool.js';

export const planModeTools = {
  EnterPlanMode: EnterPlanModeTool,
  ExitPlanMode: ExitPlanModeTool,
};

export default planModeTools;