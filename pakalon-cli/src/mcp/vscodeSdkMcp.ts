/**
 * VSCode SDK MCP
 * MCP server implementation for VSCode extension SDK integration
 */
import type { McpSdkServerConfigWithInstance } from '../../sdk/runtimeTypes.js';
import type { SdkMcpToolDefinition } from '../../sdk/runtimeTypes.js';
import { SdkControlServerTransport } from './SdkControlTransport.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface VscodeSdkMcpOptions {
  serverName: string;
  tools: SdkMcpToolDefinition<any>[];
  onRequest?: (request: JSONRPCMessage) => Promise<JSONRPCMessage>;
}

class VscodeSdkMcpServer {
  private serverName: string;
  private tools: SdkMcpToolDefinition<any>[];
  private transport: SdkControlServerTransport | null = null;
  private onRequest?: (request: JSONRPCMessage) => Promise<JSONRPCMessage>;

  constructor(options: VscodeSdkMcpOptions) {
    this.serverName = options.serverName;
    this.tools = options.tools;
    this.onRequest = options.onRequest;
  }

  async start(sendMessage: (message: JSONRPCMessage) => void): Promise<void> {
    this.transport = new SdkControlServerTransport(sendMessage);

    this.transport.onmessage = async (message) => {
      if (this.onRequest) {
        const response = await this.onRequest(message);
        this.transport?.send(response);
      }
    };

    await this.transport.start();
  }

  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  getServerName(): string {
    return this.serverName;
  }

  getTools(): SdkMcpToolDefinition<any>[] {
    return this.tools;
  }
}

export function createVscodeSdkMcpServer(
  options: VscodeSdkMcpOptions,
): VscodeSdkMcpServer {
  return new VscodeSdkMcpServer(options);
}

export async function createVscodeSdkMcpServerFromConfig(
  config: McpSdkServerConfigWithInstance,
  sendMessage: (message: JSONRPCMessage) => void,
): Promise<VscodeSdkMcpServer> {
  return createVscodeSdkMcpServer({
    serverName: config.name,
    tools: config.tools as SdkMcpToolDefinition<any>[],
    onRequest: async (request) => {
      return request;
    },
  }).then(async (server) => {
    await server.start(sendMessage);
    return server;
  });
}