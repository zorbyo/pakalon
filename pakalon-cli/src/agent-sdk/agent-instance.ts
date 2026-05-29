import type { AgentConfig, AgentMemory, AgentResult, Tool } from "./index.js";

const createMemoryStore = (): AgentMemory => {
  const store = new Map<string, unknown>();

  return {
    async get(key: string) {
      return store.get(key);
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
};

export class AgentInstance {
  private config: AgentConfig;
  private tools: Tool[];
  private memory: AgentMemory;

  constructor(config: AgentConfig, tools: Tool[], memory: AgentMemory) {
    this.config = config;
    this.tools = tools;
    this.memory = memory;
  }

  async run(prompt: string): Promise<AgentResult> {
    await this.memory.set("lastPrompt", prompt);

    return {
      success: true,
      output: prompt,
      filesCreated: [],
      filesModified: [],
      tokensUsed: 0,
      duration: 0,
    };
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  getMemory(): AgentMemory {
    return this.memory;
  }
}

export { createMemoryStore };
