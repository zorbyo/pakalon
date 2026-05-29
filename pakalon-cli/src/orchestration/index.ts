import { BaseAgent } from '@/agents/base-agent.js';
import type { AgentConfig, AgentContext } from '@/agents/types.js';
import { handleExitCode } from '@/tools/executor.js';

export type GraphContext = Map<string, unknown>;

export type GraphNodeState = 'pending' | 'running' | 'completed' | 'error';

export type GraphEdgeKind = 'sequential' | 'parallel' | 'conditional' | 'loop';

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  condition?: (context: GraphContext, output?: string) => boolean | Promise<boolean>;
  maxIterations?: number;
  label?: string;
}

export interface GraphNodeOptions {
  id: string;
  brief: string;
  model: string;
  systemPrompt?: string;
  agentName?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GraphNodeExecutionResult {
  nodeId: string;
  state: GraphNodeState;
  output: string;
  exitCode: number;
  duration: number;
  error?: string;
  iteration: number;
}

export interface GraphExecutionResult {
  success: boolean;
  duration: number;
  executionOrder: string[];
  results: Map<string, GraphNodeExecutionResult[]>;
  context: GraphContext;
  failedNodes: string[];
}

function stringifyContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export class GraphNode {
  public readonly id: string;
  public readonly brief: string;
  public readonly model: string;
  public readonly systemPrompt: string;
  public readonly agentName: string;
  public readonly maxTokens: number;
  public readonly temperature: number;
  public state: GraphNodeState = 'pending';
  public executionCount = 0;

  constructor(options: GraphNodeOptions) {
    this.id = options.id;
    this.brief = options.brief;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? 'You are a focused sub-agent. Follow the brief exactly.';
    this.agentName = options.agentName ?? options.id;
    this.maxTokens = options.maxTokens ?? 4096;
    this.temperature = options.temperature ?? 0.2;
  }

  public buildPrompt(context: GraphContext): string {
    const contextEntries = Array.from(context.entries()).map(([key, value]) => `- ${key}: ${stringifyContextValue(value)}`);
    const contextBlock = contextEntries.length > 0 ? `\n\nShared context:\n${contextEntries.join('\n')}` : '';
    return `${this.brief}${contextBlock}`;
  }

  public async execute(context: GraphContext): Promise<GraphNodeExecutionResult> {
    this.state = 'running';
    this.executionCount += 1;
    const startedAt = Date.now();

    const agentContext: AgentContext = {
      agentId: this.id,
      agentName: this.agentName,
      agentType: 'graph-node',
      permissionMode: 'auto',
      tools: [],
      disallowedTools: [],
      background: false,
      projectDir: typeof context.get('projectDir') === 'string' ? (context.get('projectDir') as string) : undefined,
      model: this.model,
    };

    const agentConfig: AgentConfig = {
      name: this.agentName,
      model: this.model,
      systemPrompt: this.systemPrompt,
      tools: [],
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    };

    try {
      const agent = new BaseAgent(agentConfig, agentContext);
      const output = await agent.run(this.buildPrompt(context));
      const handled = handleExitCode(0, output, '');
      this.state = 'completed';
      return {
        nodeId: this.id,
        state: this.state,
        output: handled.output,
        exitCode: handled.exitCode,
        duration: Date.now() - startedAt,
        iteration: this.executionCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const handled = handleExitCode(2, '', message);
      this.state = 'error';
      return {
        nodeId: this.id,
        state: this.state,
        output: handled.output,
        exitCode: handled.exitCode,
        error: handled.error,
        duration: Date.now() - startedAt,
        iteration: this.executionCount,
      };
    }
  }
}

interface GraphNodeRuntime {
  node: GraphNode;
  outgoing: GraphEdge[];
}

export class AgentGraph {
  private readonly nodes = new Map<string, GraphNodeRuntime>();

  public addNode(node: GraphNode): this {
    if (this.nodes.has(node.id)) {
      throw new Error(`Graph node already exists: ${node.id}`);
    }

    this.nodes.set(node.id, { node, outgoing: [] });
    return this;
  }

  public addEdge(edge: GraphEdge): this {
    const source = this.nodes.get(edge.from);
    const target = this.nodes.get(edge.to);

    if (!source) {
      throw new Error(`Unknown source node: ${edge.from}`);
    }

    if (!target) {
      throw new Error(`Unknown target node: ${edge.to}`);
    }

    source.outgoing.push(edge);
    return this;
  }

  public getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId)?.node;
  }

  public async execute(startNodeId: string, initialContext: GraphContext = new Map<string, unknown>()): Promise<GraphExecutionResult> {
    const startedAt = Date.now();
    const context = initialContext;
    const results = new Map<string, GraphNodeExecutionResult[]>();
    const executionOrder: string[] = [];
    const failedNodes = new Set<string>();
    const activePath = new Set<string>();

    const runNode = async (nodeId: string, iteration = 1): Promise<void> => {
      const runtime = this.nodes.get(nodeId);
      if (!runtime) {
        throw new Error(`Unknown node: ${nodeId}`);
      }

      if (activePath.has(nodeId)) {
        throw new Error(`Cycle detected at node ${nodeId}`);
      }

      activePath.add(nodeId);
      executionOrder.push(nodeId);
      const result = await runtime.node.execute(context);

      const nodeResults = results.get(nodeId) ?? [];
      nodeResults.push({ ...result, iteration });
      results.set(nodeId, nodeResults);
      context.set(nodeId, result.output);
      context.set(`${nodeId}:state`, result.state);
      context.set(`${nodeId}:exitCode`, result.exitCode);

      if (result.state === 'error') {
        failedNodes.add(nodeId);
        activePath.delete(nodeId);
        return;
      }

      const outgoing = runtime.outgoing;
      const sequentialEdges = outgoing.filter((edge) => edge.kind === 'sequential' || edge.kind === 'conditional');
      const parallelEdges = outgoing.filter((edge) => edge.kind === 'parallel');
      const loopEdges = outgoing.filter((edge) => edge.kind === 'loop');

      if (parallelEdges.length > 0) {
        await Promise.all(
          parallelEdges.map(async (edge) => {
            if (edge.condition && !(await edge.condition(context, result.output))) {
              return;
            }

            await runNode(edge.to);
          })
        );
      }

      for (const edge of sequentialEdges) {
        if (edge.condition && !(await edge.condition(context, result.output))) {
          continue;
        }

        await runNode(edge.to);
      }

      for (const edge of loopEdges) {
        const maxIterations = edge.maxIterations ?? 1;

        for (let index = 0; index < maxIterations; index += 1) {
          if (edge.condition && !(await edge.condition(context, result.output))) {
            break;
          }

          await runNode(edge.to, iteration + index + 1);
        }
      }

      activePath.delete(nodeId);
    };

    await runNode(startNodeId);

    return {
      success: failedNodes.size === 0,
      duration: Date.now() - startedAt,
      executionOrder,
      results,
      context,
      failedNodes: Array.from(failedNodes),
    };
  }
}
