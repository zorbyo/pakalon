import logger from '@/utils/logger.js';

export interface FastModeConfig {
  enabled: boolean;
  maxTokens: number;
  skipThinking: boolean;
  reducedTools: boolean;
  fastModel?: string;
}

const DEFAULT_FAST_MODE_CONFIG: FastModeConfig = {
  enabled: false,
  maxTokens: 2048,
  skipThinking: true,
  reducedTools: true,
  fastModel: 'anthropic/claude-3-haiku',
};

let fastModeConfig: FastModeConfig = { ...DEFAULT_FAST_MODE_CONFIG };

export function isFastModeEnabled(): boolean {
  return fastModeConfig.enabled || process.env.PAKALON_FAST_MODE === '1';
}

export function isFastModeAvailable(): boolean {
  return true;
}

export function isFastModeSupportedByModel(model?: string): boolean {
  const fastModels = ['haiku', 'claude-3-haiku', 'gpt-4o-mini', 'gpt-3.5-turbo'];
  if (!model) {
    return true;
  }
  return fastModels.some((m) => model.toLowerCase().includes(m));
}

export function getFastModeConfig(): FastModeConfig {
  return { ...fastModeConfig };
}

export function setFastModeConfig(config: Partial<FastModeConfig>): void {
  fastModeConfig = { ...fastModeConfig, ...config };
}

export function enableFastMode(): void {
  fastModeConfig.enabled = true;
  process.env.PAKALON_FAST_MODE = '1';
  logger.info('Fast mode enabled');
}

export function disableFastMode(): void {
  fastModeConfig.enabled = false;
  delete process.env.PAKALON_FAST_MODE;
  logger.info('Fast mode disabled');
}

export function toggleFastMode(): boolean {
  if (isFastModeEnabled()) {
    disableFastMode();
  } else {
    enableFastMode();
  }
  return isFastModeEnabled();
}

export function getFastModeState(): {
  enabled: boolean;
  available: boolean;
  supported: boolean;
  config: FastModeConfig;
} {
  return {
    enabled: isFastModeEnabled(),
    available: isFastModeAvailable(),
    supported: isFastModeSupportedByModel(),
    config: fastModeConfig,
  };
}

export function getFastModeTools(): string[] | null {
  if (!isFastModeEnabled()) {
    return null;
  }

  return [
    'Read',
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    'Bash',
    'Edit',
    'Write',
  ];
}

export function getFastModeMaxTokens(): number {
  return fastModeConfig.maxTokens;
}

export function shouldSkipThinking(): boolean {
  return isFastModeEnabled() && fastModeConfig.skipThinking;
}

export function getFastModeModel(): string {
  return fastModeConfig.fastModel || 'anthropic/claude-3-haiku';
}

export interface FastModeMetrics {
  timeSaved: number;
  tokensSaved: number;
  requestsOptimized: number;
}

const fastModeMetrics: FastModeMetrics = {
  timeSaved: 0,
  tokensSaved: 0,
  requestsOptimized: 0,
};

export function recordFastModeUsage(tokensSaved: number, timeSaved: number): void {
  fastModeMetrics.tokensSaved += tokensSaved;
  fastModeMetrics.timeSaved += timeSaved;
  fastModeMetrics.requestsOptimized++;
}

export function getFastModeMetrics(): FastModeMetrics {
  return { ...fastModeMetrics };
}

export function resetFastModeMetrics(): void {
  fastModeMetrics.timeSaved = 0;
  fastModeMetrics.tokensSaved = 0;
  fastModeMetrics.requestsOptimized = 0;
}