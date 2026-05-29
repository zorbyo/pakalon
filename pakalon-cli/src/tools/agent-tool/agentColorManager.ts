/**
 * Agent Color Manager
 * Manages colors for different agent types for visual distinction
 */
import type { AgentColorName } from './types.js';
import { AGENT_COLORS } from './constants.js';

const agentColorMap = new Map<string, AgentColorName>();
const defaultColors: AgentColorName[] = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan'];

let colorIndex = 0;

export function setAgentColor(agentType: string, color: AgentColorName): void {
  if (AGENT_COLORS.includes(color)) {
    agentColorMap.set(agentType, color);
  }
}

export function getAgentColor(agentType: string): AgentColorName {
  const existingColor = agentColorMap.get(agentType);
  if (existingColor) {
    return existingColor;
  }

  const color = defaultColors[colorIndex % defaultColors.length];
  colorIndex++;

  agentColorMap.set(agentType, color);
  return color;
}

export function getAgentColorHex(agentType: string): string {
  const color = getAgentColor(agentType);

  const colorMap: Record<AgentColorName, string> = {
    slate: '#64748b',
    gray: '#6b7280',
    zinc: '#71717a',
    neutral: '#737373',
    stone: '#78716c',
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    yellow: '#eab308',
    lime: '#84cc16',
    green: '#22c55e',
    emerald: '#10b981',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    sky: '#0ea5e9',
    blue: '#3b82f6',
    indigo: '#6366f1',
    violet: '#8b5cf6',
    purple: '#a855f7',
    fuchsia: '#d946ef',
    pink: '#ec4899',
    rose: '#f43f5e',
  };

  return colorMap[color] || '#3b82f6';
}

export function clearAgentColor(agentType: string): void {
  agentColorMap.delete(agentType);
}

export function clearAllAgentColors(): void {
  agentColorMap.clear();
}

export { AGENT_COLORS };
export type { AgentColorName };