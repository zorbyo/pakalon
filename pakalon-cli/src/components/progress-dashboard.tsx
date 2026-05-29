import React from 'react';
import { Box, Text } from 'ink';
import type { AgentStatus } from '@/agents/types.js';

type Props = {
  agents: AgentStatus[];
};

const statusColor: Record<AgentStatus['status'], string> = {
  queued: 'gray',
  running: 'yellow',
  completed: 'green',
  failed: 'red',
  blocked: 'magenta',
};

export function renderProgressDashboard(agents: AgentStatus[]): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyanBright">Phase 3 Progress</Text>
      {agents.map(agent => (
        <Box key={agent.name} justifyContent="space-between">
          <Text color={statusColor[agent.status]}>{agent.name}</Text>
          <Text>{agent.status} {agent.progress}% {agent.eta ? `ETA ${agent.eta}` : ''}</Text>
        </Box>
      ))}
    </Box>
  );
}

const ProgressDashboard: React.FC<Props> = ({ agents }) => renderProgressDashboard(agents);

export default ProgressDashboard;
