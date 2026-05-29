import type { AgentColorName } from './constants.js';
import { AGENT_COLORS } from './constants.js';

const agentColorMap = new Map<string, AgentColorName>();
const colorAssignments = new Map<AgentColorName, Set<string>>();

for (const color of AGENT_COLORS) {
  colorAssignments.set(color, new Set());
}

export function setAgentColor(agentType: string, color: AgentColorName): void {
  const existingColor = agentColorMap.get(agentType);
  if (existingColor) {
    colorAssignments.get(existingColor)?.delete(agentType);
  }

  agentColorMap.set(agentType, color);
  colorAssignments.get(color)?.add(agentType);
}

export function getAgentColor(agentType: string): AgentColorName | undefined {
  if (agentType === 'general-purpose') {
    return undefined;
  }

  const color = agentColorMap.get(agentType);
  if (color && AGENT_COLORS.includes(color)) {
    return color;
  }

  return undefined;
}

export function getOrAssignAgentColor(agentType: string): AgentColorName {
  let color = agentColorMap.get(agentType);

  if (color) {
    return color;
  }

  color = findLeastUsedColor();
  setAgentColor(agentType, color);
  return color;
}

function findLeastUsedColor(): AgentColorName {
  let minCount = Infinity;
  let leastUsedColor: AgentColorName = 'blue';

  for (const color of AGENT_COLORS) {
    const count = colorAssignments.get(color)?.size ?? 0;
    if (count < minCount) {
      minCount = count;
      leastUsedColor = color;
    }
  }

  return leastUsedColor;
}

export function getAllAgentColors(): Map<string, AgentColorName> {
  return new Map(agentColorMap);
}

export function clearAgentColors(): void {
  agentColorMap.clear();
  for (const color of AGENT_COLORS) {
    colorAssignments.get(color)?.clear();
  }
}

export const AGENT_COLOR_CSS: Record<AgentColorName, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  cyan: '#06b6d4',
};

export function getAgentColorCSS(color: AgentColorName): string {
  return AGENT_COLOR_CSS[color] ?? '#3b82f6';
}

export function getAgentThemeColor(agentType: string): string | undefined {
  const color = getAgentColor(agentType);
  if (!color) return undefined;
  return color;
}