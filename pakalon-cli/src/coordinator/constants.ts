/**
 * Coordinator Mode Constants
 * 
 * Tool constants for coordinator mode and worker restrictions.
 * These define which tools are available to the coordinator and workers.
 */

export { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from '../agents/agent-tool/constants.js';
export {
  ASYNC_AGENT_ALLOWED_TOOLS,
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
} from '../agents/agent-tool/constants.js';

import { AGENT_TOOL_NAME } from '../agents/agent-tool/constants.js';
import { SEND_MESSAGE_TOOL_NAME } from '../tools/send-message-tool/constants.js';
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../tools/synthetic-output-tool/SyntheticOutputTool.js';

export const TEAM_CREATE_TOOL_NAME = 'TeamCreate';
export const TEAM_DELETE_TOOL_NAME = 'TeamDelete';

/**
 * Tools that are internal to the worker/team system and should be
 * filtered out when presenting available tools to workers.
 */
export const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
]);

/**
 * Tools allowed for the coordinator in coordinator mode.
 * The coordinator has access to agent management and messaging tools
 * to orchestrate workers.
 */
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,
  'TaskStop',
  'SendMessage',
  SYNTHETIC_OUTPUT_TOOL_NAME,
]);

/**
 * Additional tools available to workers in simple mode (restricted set).
 * Used when CLAUDE_CODE_SIMPLE is enabled.
 */
export const SIMPLE_MODE_WORKER_TOOLS = new Set([
  'Bash',
  'Read',
  'Edit',
]);

/**
 * Environment variable for coordinator mode toggle
 */
export const COORDINATOR_MODE_ENV_VAR = 'PAKALON_COORDINATOR_MODE';

/**
 * Feature flag name for coordinator mode
 */
export const COORDINATOR_MODE_FEATURE_FLAG = 'COORDINATOR_MODE';