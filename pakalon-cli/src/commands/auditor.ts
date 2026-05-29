import type { CommandDefinition } from './types.js';
import { AuditorAgent } from '@/agents/auditor/index.js';

export const auditorCommand: CommandDefinition = {
  name: 'auditor',
  description: 'Run the read-only auditor against the current project',
  usage: '/auditor [--yolo]',
  category: 'advanced',
  async execute(context, args) {
    const yolo = args.includes('--yolo');
    const projectDir = context.cwd ?? process.cwd();

    const agent = new AuditorAgent(
      {
        agentId: 'auditor',
        agentName: 'auditor',
        agentType: 'auditor',
        userPrompt: 'Inspect the codebase against requirements.',
        projectDir,
        permissionMode: yolo ? 'auto-accept' : 'plan',
        tools: [],
        disallowedTools: yolo ? [] : ['write', 'delete', 'shell'],
        background: false,
        isolation: 'remote',
        isYolo: yolo,
      },
      {
        projectDir,
        maxIterations: 10,
        readOnly: !yolo,
        autoRemediate: yolo,
      },
    );

    const result = await agent.execute();
    return {
      success: true,
      message: result.message,
      data: result.data,
    };
  },
};

export default auditorCommand;
