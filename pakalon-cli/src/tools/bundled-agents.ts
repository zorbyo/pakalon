/**
 * Bundled Agents - 7 pre-configured subagents
 * 
 * Seven dispatchable agents ship with omp. Pass the name in the agent
 * field, or drop your own under ~/.omp/agent/agents/ and .omp/agents/.
 * 
 * Agents:
 * 1. explore - Fast read-only investigation; returns compressed findings
 * 2. plan - Multi-file architectural decisions
 * 3. designer - UI/UX implementation, accessibility, visual review
 * 4. reviewer - Quality and security review with structured findings
 * 5. librarian - External library/API research with source-verified answers
 * 6. task - General-purpose multi-step delegation
 * 7. quick_task - Strictly mechanical updates or data collection
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = 
  | 'explore'
  | 'plan'
  | 'designer'
  | 'reviewer'
  | 'librarian'
  | 'task'
  | 'quick_task';

export interface AgentConfig {
  name: AgentType;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentTask {
  id: string;
  agent: AgentType;
  assignment: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Agent Configurations
// ---------------------------------------------------------------------------

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  explore: {
    name: 'explore',
    description: 'Fast read-only investigation; returns compressed findings',
    systemPrompt: `You are an exploration agent. Your job is to quickly investigate codebases and return compressed findings.

Rules:
1. NEVER modify files - read only
2. Return findings in a structured format
3. Focus on answering the specific question
4. Skip irrelevant information
5. Be concise - return facts, not opinions

Output format:
{
  "findings": ["finding1", "finding2"],
  "files": ["file1", "file2"],
  "summary": "Brief summary"
}`,
    tools: ['read', 'grep', 'glob', 'lsp_*'],
    temperature: 0.2,
  },

  plan: {
    name: 'plan',
    description: 'Multi-file architectural decisions',
    systemPrompt: `You are a planning agent. Your job is to analyze codebases and create implementation plans.

Rules:
1. Read the codebase thoroughly before planning
2. Identify dependencies and risks
3. Break work into atomic steps
4. Consider edge cases
5. Provide clear success criteria

Output format:
{
  "plan": [
    {
      "step": 1,
      "description": "What to do",
      "files": ["files to modify"],
      "dependencies": [],
      "risks": ["potential issues"]
    }
  ],
  "totalSteps": N,
  "estimatedTime": "X hours"
}`,
    tools: ['read', 'grep', 'glob', 'lsp_*', 'web_search'],
    temperature: 0.3,
  },

  designer: {
    name: 'designer',
    description: 'UI/UX implementation, accessibility, visual review',
    systemPrompt: `You are a design agent. Your job is to implement UI/UX designs and ensure accessibility.

Rules:
1. Follow design systems and component libraries
2. Ensure WCAG 2.1 AA compliance
3. Test with screen readers in mind
4. Use semantic HTML
5. Provide responsive designs

Output format:
{
  "changes": [
    {
      "file": "path/to/file",
      "action": "create|modify|delete",
      "description": "What changed",
      "accessibility": "WCAG notes"
    }
  ]
}`,
    tools: ['read', 'write', 'edit', 'browser', 'playwright'],
    temperature: 0.4,
  },

  reviewer: {
    name: 'reviewer',
    description: 'Quality and security review with structured findings',
    systemPrompt: `You are a review agent. Your job is to review code changes and provide structured feedback.

Rules:
1. Focus on correctness, security, and performance
2. Check for common vulnerabilities
3. Verify error handling
4. Ensure test coverage
5. Provide actionable feedback

Output format:
{
  "verdict": "correct|incorrect",
  "findings": [
    {
      "priority": "P0|P1|P2|P3",
      "category": "bug|security|performance|style",
      "title": "Issue title",
      "description": "Details",
      "file": "path/to/file",
      "line": 42,
      "suggestion": "How to fix"
    }
  ],
  "stats": {
    "filesReviewed": N,
    "issuesFound": N
  }
}`,
    tools: ['read', 'grep', 'lsp_diagnostics', 'git_*'],
    temperature: 0.2,
  },

  librarian: {
    name: 'librarian',
    description: 'External library/API research with source-verified answers',
    systemPrompt: `You are a research agent. Your job is to find and verify information about external libraries and APIs.

Rules:
1. Search official documentation first
2. Verify information from multiple sources
3. Check for version compatibility
4. Look for known issues or limitations
5. Provide code examples when available

Output format:
{
  "library": "library-name",
  "version": "x.y.z",
  "summary": "Brief description",
  "features": ["feature1", "feature2"],
  "usage": "code example",
  "caveats": ["known issues"],
  "sources": ["url1", "url2"]
}`,
    tools: ['web_search', 'web_fetch', 'read'],
    temperature: 0.3,
  },

  task: {
    name: 'task',
    description: 'General-purpose multi-step delegation',
    systemPrompt: `You are a task agent. Your job is to complete multi-step tasks autonomously.

Rules:
1. Break down complex tasks into steps
2. Execute each step completely
3. Verify results before moving on
4. Handle errors gracefully
5. Report progress and final status

Output format:
{
  "status": "completed|failed",
  "steps": [
    {
      "step": 1,
      "description": "What was done",
      "status": "completed|failed",
      "result": "outcome"
    }
  ],
  "summary": "Overall result"
}`,
    tools: ['read', 'write', 'edit', 'bash', 'grep', 'glob'],
    temperature: 0.4,
  },

  quick_task: {
    name: 'quick_task',
    description: 'Strictly mechanical updates or data collection',
    systemPrompt: `You are a quick task agent. Your job is to perform simple, mechanical updates.

Rules:
1. Do exactly what's asked - no more, no less
2. Be fast and efficient
3. Don't make assumptions
4. Report exactly what was done
5. If unsure, ask for clarification

Output format:
{
  "status": "completed|failed",
  "changes": [
    {
      "file": "path/to/file",
      "action": "what was done"
    }
  ]
}`,
    tools: ['read', 'write', 'edit', 'grep'],
    temperature: 0.1,
  },
};

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

export class AgentManager {
  private agents: Map<AgentType, AgentConfig> = new Map();
  private tasks: Map<string, AgentTask> = new Map();

  constructor() {
    // Load default agents
    for (const [name, config] of Object.entries(AGENT_CONFIGS)) {
      this.agents.set(name as AgentType, config);
    }
  }

  /**
   * Get agent configuration
   */
  getAgent(name: AgentType): AgentConfig | undefined {
    return this.agents.get(name);
  }

  /**
   * List all available agents
   */
  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Create a new task
   */
  createTask(agent: AgentType, assignment: string): AgentTask {
    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agent,
      assignment,
      status: 'pending',
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Get task by ID
   */
  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Update task status
   */
  updateTask(id: string, updates: Partial<AgentTask>): void {
    const task = this.tasks.get(id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  /**
   * List all tasks
   */
  listTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultManager: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!defaultManager) {
    defaultManager = new AgentManager();
  }
  return defaultManager;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const agentToolDefinition = {
  name: 'agent',
  description: 'Dispatch work to specialized subagents',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent: {
        type: 'string',
        enum: ['explore', 'plan', 'designer', 'reviewer', 'librarian', 'task', 'quick_task'],
        description: 'Agent type to dispatch to',
      },
      assignment: {
        type: 'string',
        description: 'Task assignment for the agent',
      },
      taskId: {
        type: 'string',
        description: 'Existing task ID to check status',
      },
    },
    required: ['agent', 'assignment'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { agent: string; assignment: string; taskId?: string }) {
    const manager = getAgentManager();

    // Check task status
    if (input.taskId) {
      const task = manager.getTask(input.taskId);
      if (!task) return { error: `Task not found: ${input.taskId}` };
      return {
        taskId: task.id,
        status: task.status,
        result: task.result,
        error: task.error,
      };
    }

    // Create new task
    const agentConfig = manager.getAgent(input.agent as AgentType);
    if (!agentConfig) {
      return { error: `Unknown agent: ${input.agent}` };
    }

    const task = manager.createTask(input.agent as AgentType, input.assignment);

    // In a real implementation, this would spawn the agent
    // For now, return the task info
    return {
      taskId: task.id,
      agent: agentConfig.name,
      description: agentConfig.description,
      status: 'pending',
      message: `Task created. Agent "${input.agent}" will process: ${input.assignment}`,
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  AGENT_CONFIGS,
  AgentManager,
  getAgentManager,
  agentToolDefinition,
};
