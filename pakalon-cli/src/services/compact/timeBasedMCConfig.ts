export interface TimeWindowConfig {
  startHour: number;
  endHour: number;
  label: string;
  keepLatestToolResults: number;
  minResultChars: number;
  tokenBudget: number;
  placeholder: string;
}

export interface TimeBasedMCConfig {
  enabled: boolean;
  keepLatestToolResults: number;
  minResultChars: number;
  tokenBudget: number;
  placeholder: string;
  windows: TimeWindowConfig[];
}

export const DEFAULT_TIME_BASED_MC_CONFIG: TimeBasedMCConfig = {
  enabled: true,
  keepLatestToolResults: 12,
  minResultChars: 200,
  tokenBudget: 32_000,
  placeholder: "[Old tool result content cleared by time-based microcompact]",
  windows: [
    { startHour: 0, endHour: 6, label: "overnight", keepLatestToolResults: 8, minResultChars: 120, tokenBudget: 24_000, placeholder: "[Overnight result compacted]" },
    { startHour: 6, endHour: 12, label: "morning", keepLatestToolResults: 12, minResultChars: 200, tokenBudget: 32_000, placeholder: "[Morning result compacted]" },
    { startHour: 12, endHour: 18, label: "afternoon", keepLatestToolResults: 14, minResultChars: 240, tokenBudget: 36_000, placeholder: "[Afternoon result compacted]" },
    { startHour: 18, endHour: 24, label: "evening", keepLatestToolResults: 10, minResultChars: 180, tokenBudget: 28_000, placeholder: "[Evening result compacted]" },
  ],
};

export function getMCConfigForTimeWindow(hour: number, config: TimeBasedMCConfig = DEFAULT_TIME_BASED_MC_CONFIG): TimeWindowConfig {
  const normalized = ((hour % 24) + 24) % 24;
  return config.windows.find((window) => normalized >= window.startHour && normalized < window.endHour) ?? config.windows[0]!;
}

export function getMCConfigForCurrentTime(config: TimeBasedMCConfig = DEFAULT_TIME_BASED_MC_CONFIG, date = new Date()): TimeWindowConfig {
  return getMCConfigForTimeWindow(date.getHours(), config);
}
