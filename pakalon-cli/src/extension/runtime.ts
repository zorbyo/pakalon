/**
 * Extension Runtime — manages child process lifecycle for extensions.
 *
 * Each extension is a Node.js child process that communicates via JSON-RPC over stdio.
 * The runtime handles:
 * - Forking child processes
 * - Initializing extensions (sending initialize request)
 * - Routing tool calls to extensions
 * - Routing hook callbacks to extensions
 * - Shutdown and cleanup
 */
import { EventEmitter } from "events";
import { fork } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { JsonRpcChannel } from "./rpc.js";
import type {
  ExtensionManifest,
  ExtensionInstance,
  ExtensionStatus,
  ToolRegistration,
  HookRegistration,
  HookType,
  HookContext,
  HookDecision,
  SessionEventType,
} from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Extension Runtime
// ---------------------------------------------------------------------------

export class ExtensionRuntime extends EventEmitter {
  private extensions = new Map<string, ExtensionInstance>();
  private channels = new Map<string, JsonRpcChannel>();

  /**
   * Start an extension from its manifest and directory path.
   */
  async startExtension(manifest: ExtensionManifest, extensionDir: string): Promise<ExtensionInstance> {
    const entryPath = path.resolve(extensionDir, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Extension entry not found: ${entryPath}`);
    }

    logger.info(`[extension] Starting: ${manifest.name}`, { entry: entryPath });

    const instance: ExtensionInstance = {
      manifest,
      path: extensionDir,
      pid: null,
      status: "starting",
      registeredTools: [],
      registeredHooks: [],
      subscribedEvents: [],
      startedAt: new Date().toISOString(),
    };

    try {
      // Fork the extension as a child process
      const childProcess = fork(entryPath, [], {
        cwd: extensionDir,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          PAKALON_EXTENSION_NAME: manifest.name,
          PAKALON_EXTENSION_DIR: extensionDir,
        },
        serialization: "json",
      });

      instance.pid = childProcess.pid ?? null;

      // Create JSON-RPC channel
      const channel = new JsonRpcChannel({
        process: childProcess,
        name: manifest.name,
        timeout: 30000,
      });

      // Set up request handler (extension → CLI requests)
      channel.setRequestHandler(async (method, params) => {
        return this.handleExtensionRequest(manifest.name, method, params);
      });

      // Set up notification handler (extension → CLI notifications)
      channel.setNotificationHandler((method, params) => {
        this.handleExtensionNotification(manifest.name, method, params);
      });

      // Handle channel events
      channel.on("exit", ({ code }) => {
        instance.status = code === 0 ? "stopped" : "error";
        instance.lastError = code !== 0 ? `Process exited with code ${code}` : undefined;
        logger.info(`[extension] ${manifest.name} ${instance.status}`);
      });

      channel.on("error", (err: Error) => {
        instance.status = "error";
        instance.lastError = err.message;
        logger.error(`[extension] ${manifest.name} error`, { error: err.message });
      });

      this.extensions.set(manifest.name, instance);
      this.channels.set(manifest.name, channel);

      // Send initialize request
      const initResult = await channel.sendRequest("initialize", {
        name: manifest.name,
        version: manifest.version ?? "0.0.0",
        capabilities: {
          tools: true,
          hooks: true,
          events: true,
          elicitation: true,
        },
      }) as Record<string, unknown>;

      // Process initialization response
      if (initResult?.tools && Array.isArray(initResult.tools)) {
        instance.registeredTools = initResult.tools as ToolRegistration[];
      }
      if (initResult?.hooks && Array.isArray(initResult.hooks)) {
        instance.registeredHooks = initResult.hooks as HookRegistration[];
      }

      instance.status = "running";
      logger.info(`[extension] ${manifest.name} initialized`, {
        tools: instance.registeredTools.length,
        hooks: instance.registeredHooks.length,
      });

      return instance;
    } catch (err) {
      instance.status = "error";
      instance.lastError = String(err);
      logger.error(`[extension] Failed to start ${manifest.name}`, { error: String(err) });
      throw err;
    }
  }

  /**
   * Stop a running extension.
   */
  async stopExtension(name: string): Promise<void> {
    const channel = this.channels.get(name);
    if (channel) {
      channel.close();
      this.channels.delete(name);
    }

    const instance = this.extensions.get(name);
    if (instance) {
      instance.status = "stopped";
    }

    logger.info(`[extension] Stopped: ${name}`);
  }

  /**
   * Stop all running extensions.
   */
  async stopAll(): Promise<void> {
    const names = Array.from(this.extensions.keys());
    await Promise.all(names.map((name) => this.stopExtension(name)));
  }

  /**
   * Hot-reload an extension (stop + restart).
   */
  async hotReload(name: string): Promise<ExtensionInstance> {
    const instance = this.extensions.get(name);
    if (!instance) {
      throw new Error(`Extension not found: ${name}`);
    }

    logger.info(`[extension] Hot-reloading: ${name}`);
    await this.stopExtension(name);
    this.extensions.delete(name);

    return this.startExtension(instance.manifest, instance.path);
  }

  // ---------------------------------------------------------------------------
  // Tool Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a tool registered by an extension.
   */
  async executeTool(extensionName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const channel = this.channels.get(extensionName);
    if (!channel) {
      throw new Error(`Extension not running: ${extensionName}`);
    }

    return channel.sendRequest("executeTool", { toolName, args });
  }

  /**
   * Check if an extension has a specific tool registered.
   */
  hasTool(extensionName: string, toolName: string): boolean {
    const instance = this.extensions.get(extensionName);
    if (!instance) return false;
    return instance.registeredTools.some((t) => t.name === toolName);
  }

  /**
   * Get all tools registered by a specific extension.
   */
  getExtensionTools(extensionName: string): ToolRegistration[] {
    const instance = this.extensions.get(extensionName);
    return instance?.registeredTools ?? [];
  }

  /**
   * Get all registered tools across all extensions.
   * Map: toolName → extensionName
   */
  getAllTools(): Map<string, string> {
    const tools = new Map<string, string>();
    for (const [extName, instance] of this.extensions) {
      for (const tool of instance.registeredTools) {
        tools.set(tool.name, extName);
      }
    }
    return tools;
  }

  // ---------------------------------------------------------------------------
  // Hook Execution
  // ---------------------------------------------------------------------------

  /**
   * Fire a hook callback to an extension and get its decision.
   */
  async fireHook(extensionName: string, context: HookContext): Promise<HookDecision> {
    const channel = this.channels.get(extensionName);
    if (!channel) {
      return { action: "allow" }; // Extension not running — allow
    }

    try {
      const result = await channel.sendRequest(`hook.${context.hookType}`, {
        ...context,
      }) as HookDecision;

      return result ?? { action: "allow" };
    } catch (err) {
      logger.warn(`[extension] Hook error in ${extensionName}`, { hook: context.hookType, error: String(err) });
      return { action: "allow" }; // Error — allow by default
    }
  }

  /**
   * Fire a hook across all extensions that registered for it.
   * Returns the first "deny" decision, or "allow" if all allow.
   */
  async fireHookBroadcast(context: HookContext): Promise<HookDecision> {
    for (const [extName, instance] of this.extensions) {
      if (instance.status !== "running") continue;

      const hasHook = instance.registeredHooks.some(
        (h) => h.hookType === context.hookType &&
          (!h.match || (context.toolName && context.toolName.match(new RegExp(h.match))))
      );

      if (!hasHook) continue;

      const decision = await this.fireHook(extName, context);
      if (decision.action === "deny") {
        return decision;
      }
      if (decision.action === "modify" && decision.modifiedArgs) {
        context = { ...context, toolArgs: decision.modifiedArgs };
      }
    }

    return { action: "allow" };
  }

  // ---------------------------------------------------------------------------
  // Session Events
  // ---------------------------------------------------------------------------

  /**
   * Broadcast a session event to all subscribed extensions.
   */
  broadcastEvent(eventType: SessionEventType, data: Record<string, unknown>): void {
    for (const [extName, instance] of this.extensions) {
      if (instance.status !== "running") continue;
      if (!instance.subscribedEvents.includes(eventType)) continue;

      const channel = this.channels.get(extName);
      if (channel) {
        channel.sendNotification("session.event", { type: eventType, ...data });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Request/Notification Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle requests FROM extensions TO the CLI.
   */
  private async handleExtensionRequest(
    extensionName: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case "registerTool": {
        const tool = params as unknown as ToolRegistration;
        const instance = this.extensions.get(extensionName);
        if (instance) {
          // Avoid duplicate registration
          if (!instance.registeredTools.some((t) => t.name === tool.name)) {
            instance.registeredTools.push(tool);
            logger.info(`[extension] ${extensionName} registered tool: ${tool.name}`);
          }
        }
        return { success: true };
      }

      case "registerHook": {
        const hook = params as unknown as HookRegistration;
        const instance = this.extensions.get(extensionName);
        if (instance) {
          if (!instance.registeredHooks.some(
            (h) => h.hookType === hook.hookType && h.match === hook.match
          )) {
            instance.registeredHooks.push(hook);
            logger.info(`[extension] ${extensionName} registered hook: ${hook.hookType}`);
          }
        }
        return { success: true };
      }

      case "subscribeToEvent": {
        const { eventType } = params as { eventType: SessionEventType };
        const instance = this.extensions.get(extensionName);
        if (instance && !instance.subscribedEvents.includes(eventType)) {
          instance.subscribedEvents.push(eventType);
          logger.debug(`[extension] ${extensionName} subscribed to: ${eventType}`);
        }
        return { success: true };
      }

      case "unregisterTool": {
        const { name } = params as { name: string };
        const instance = this.extensions.get(extensionName);
        if (instance) {
          instance.registeredTools = instance.registeredTools.filter((t) => t.name !== name);
        }
        return { success: true };
      }

      case "unsubscribeFromEvent": {
        const { eventType } = params as { eventType: SessionEventType };
        const instance = this.extensions.get(extensionName);
        if (instance) {
          instance.subscribedEvents = instance.subscribedEvents.filter((e) => e !== eventType);
        }
        return { success: true };
      }

      default:
        throw new Error(`Unknown extension method: ${method}`);
    }
  }

  /**
   * Handle notifications FROM extensions TO the CLI.
   */
  private handleExtensionNotification(
    extensionName: string,
    method: string,
    params?: Record<string, unknown>
  ): void {
    switch (method) {
      case "log":
        logger.info(`[extension:${extensionName}] ${(params as Record<string, unknown>)?.message ?? ""}`);
        break;

      case "error":
        logger.error(`[extension:${extensionName}] ${(params as Record<string, unknown>)?.message ?? "Unknown error"}`);
        break;

      default:
        // Emit as a generic event for listeners
        this.emit("extension-notification", { extensionName, method, params });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Get all running extensions.
   */
  getRunningExtensions(): ExtensionInstance[] {
    return Array.from(this.extensions.values()).filter((e) => e.status === "running");
  }

  /**
   * Get an extension by name.
   */
  getExtension(name: string): ExtensionInstance | undefined {
    return this.extensions.get(name);
  }

  /**
   * Get the count of running extensions.
   */
  get extensionCount(): number {
    return this.extensions.size;
  }
}
