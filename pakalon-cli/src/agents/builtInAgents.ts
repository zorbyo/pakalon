/**
 * Built-in Agent Definitions
 * Specialized agents for different tasks
 */
import type { AgentDefinition, BuiltInAgentDefinition, AgentDefinitionsResult } from './types.js';
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js';
import { EXPLORE_AGENT } from './built-in/exploreAgent.js';
import { PLAN_AGENT } from './built-in/planAgent.js';
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js';

let builtInAgentsCache: AgentDefinition[] | null = null;

export function areExplorePlanAgentsEnabled(): boolean {
  return process.env.PAKALON_EXPLORE_PLAN_AGENTS !== 'false';
}

export function getBuiltInAgents(): AgentDefinition[] {
  if (builtInAgentsCache) {
    return builtInAgentsCache;
  }

  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
  ];

  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT);
  }

  builtInAgentsCache = agents;
  return builtInAgentsCache;
}

export function getBuiltInAgent(agentType: string): BuiltInAgentDefinition | undefined {
  const agents = getBuiltInAgents();
  return agents.find(
    (agent) => agent.agentType.toLowerCase() === agentType.toLowerCase()
  ) as BuiltInAgentDefinition | undefined;
}

export function clearBuiltInAgentsCache(): void {
  builtInAgentsCache = null;
}

export function getAgentDefinitionsResult(): AgentDefinitionsResult {
  const builtInAgents = getBuiltInAgents();
  return {
    activeAgents: builtInAgents,
    allAgents: builtInAgents,
  };
}

export { GENERAL_PURPOSE_AGENT, EXPLORE_AGENT, PLAN_AGENT, VERIFICATION_AGENT };