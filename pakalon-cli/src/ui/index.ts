/**
 * UI module — structured dialog components for user interaction.
 */
export {
  ElicitationManager,
  getElicitationManager,
  confirm,
  prompt,
  select,
} from "./elicitation.js";

export type {
  ElicitationField,
  ElicitationAction,
  ElicitationRequest,
  ElicitationResult,
} from "./elicitation.js";

// Command Indicators (blinking animation for running commands)
export {
  initCommandIndicators,
  getCommandIndicators,
  startCommandIndicator,
  completeCommandIndicator,
  updateCommandIndicator,
  cancelCommandIndicator,
} from "./command-indicators.js";

export type {
  CommandIndicator,
  CommandStatus,
  IndicatorConfig,
} from "./command-indicators.js";
