/**
 * Automation Types for Pakalon CLI
 */

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  recommendedConnectors: string[];
  defaultCron: string;
  promptHint: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  description?: string | null;
  prompt: string;
  templateKey?: string | null;
  inferredConfig: Record<string, any>;
  requiredConnectors: string[];
  scheduleCron?: string | null;
  scheduleTimezone: string;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  missingConnectors?: string[];
}

export interface ConnectorRecord {
  provider: string;
  displayName: string;
  category: string;
  oauthSupported: boolean;
  enabled: boolean;
  connected: boolean;
  connectionStatus: string;
  accountLabel?: string | null;
  scopes: string[];
  comingSoon: boolean;
}

export interface ConnectorCatalog {
  connected: ConnectorRecord[];
  available: ConnectorRecord[];
}

export interface AutomationLogRecord {
  id: string;
  automationId: string;
  triggerType: string;
  status: string;
  summary?: string | null;
  details: Record<string, any>;
  startedAt: string;
  completedAt?: string | null;
}

export interface CronJobRecord {
  automationId: string;
  automationName: string;
  scheduleCron: string;
  scheduleTimezone: string;
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
}

export interface AutomationCreateInput {
  name: string;
  prompt: string;
  requiredConnectors?: string[];
  scheduleCron?: string;
  scheduleTimezone?: string;
  templateKey?: string;
}

export interface SlackConfig {
  webhookUrl: string;
  channel?: string;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
}

export interface AutomationRunResult {
  success: boolean;
  automationId: string;
  summary?: string;
  error?: string;
  details?: Record<string, any>;
  startedAt: string;
  completedAt: string;
}

export type AutomationStatus = 'idle' | 'running' | 'success' | 'failed' | 'disabled';
