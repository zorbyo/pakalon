/**
 * SDK Remote Control
 * Remote control bridge functionality for daemon processes
 */

/**
 * Inbound prompt from claude.ai
 */
export interface InboundPrompt {
  content: string | unknown[];
  uuid?: string;
}

/**
 * Options for connectRemoteControl
 */
export interface ConnectRemoteControlOptions {
  dir: string;
  name?: string;
  workerType?: string;
  branch?: string;
  gitRepoUrl?: string | null;
  getAccessToken: () => string | undefined;
  baseUrl: string;
  orgUUID: string;
  model: string;
}

/**
 * Remote control state
 */
export type RemoteControlState = 'ready' | 'connected' | 'reconnecting' | 'failed';

/**
 * Handle returned by connectRemoteControl
 */
export interface RemoteControlHandle {
  sessionUrl: string;
  environmentId: string;
  bridgeSessionId: string;
  write(msg: SDKMessage): void;
  sendResult(): void;
  sendControlRequest(req: unknown): void;
  sendControlResponse(res: unknown): void;
  sendControlCancelRequest(requestId: string): void;
  inboundPrompts(): AsyncGenerator<InboundPrompt>;
  controlRequests(): AsyncGenerator<unknown>;
  permissionResponses(): AsyncGenerator<unknown>;
  onStateChange(
    cb: (
      state: RemoteControlState,
      detail?: string,
    ) => void,
  ): void;
  teardown(): Promise<void>;
}

/**
 * SDK Message for remote control
 */
export interface SDKMessage {
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  subtype?: string;
  content?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: number;
}

/**
 * Control request types
 */
export type ControlRequest =
  | { subtype: 'interrupt' }
  | { subtype: 'can_use_tool'; tool_name: string; input: Record<string, unknown>; tool_use_id: string }
  | { subtype: 'set_permission_mode'; mode: string }
  | { subtype: 'set_model'; model?: string }
  | { subtype: 'set_max_thinking_tokens'; max_thinking_tokens: number | null }
  | { subtype: 'mcp_status' }
  | { subtype: 'get_context_usage' };

/**
 * Control response types
 */
export type ControlResponse =
  | { subtype: 'control_response'; request_id: string; approved?: boolean }
  | { subtype: 'control_response'; request_id: string; error: string }
  | { subtype: 'control_response'; request_id: string; mcpServers?: unknown[] };

/**
 * Scheduled task from scheduled_tasks.json
 */
export interface CronTask {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  recurring?: boolean;
}

/**
 * Cron jitter configuration
 */
export interface CronJitterConfig {
  recurringFrac: number;
  recurringCapMs: number;
  oneShotMaxMs: number;
  oneShotFloorMs: number;
  oneShotMinuteMod: number;
  recurringMaxAgeMs: number;
}

/**
 * Scheduled task event
 */
export type ScheduledTaskEvent =
  | { type: 'fire'; task: CronTask }
  | { type: 'missed'; tasks: CronTask[] };

/**
 * Handle returned by watchScheduledTasks
 */
export interface ScheduledTasksHandle {
  events(): AsyncGenerator<ScheduledTaskEvent>;
  getNextFireTime(): number | null;
}

/**
 * Connect to remote control bridge
 */
export async function connectRemoteControl(
  opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  const {
    dir,
    name,
    workerType,
    branch,
    getAccessToken,
    baseUrl,
    orgUUID,
  } = opts;

  logger.info(`[RemoteControl] Connecting to ${baseUrl} for org ${orgUUID}`);

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const environmentId = `env_${Date.now()}`;
  const bridgeSessionId = `bridge_${Date.now()}`;

  let state: RemoteControlState = 'ready';
  const stateListeners: Array<(state: RemoteControlState, detail?: string) => void> = [];

  const messageQueue: SDKMessage[] = [];
  const inboundQueue: InboundPrompt[] = [];
  const controlRequestQueue: unknown[] = [];
  const permissionResponseQueue: unknown[] = [];
  let isConnected = false;

  function notifyStateChange(newState: RemoteControlState, detail?: string) {
    state = newState;
    for (const listener of stateListeners) {
      listener(newState, detail);
    }
  }

  async function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    const token = getAccessToken();
    if (!token) {
      throw new Error('No access token available');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  async function establishConnection(): Promise<void> {
    try {
      const response = await fetchWithAuth('/api/remote/connect', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          environmentId,
          bridgeSessionId,
          name: name || 'SDK Session',
          workerType: workerType || 'agent',
          branch: branch || 'main',
        }),
      });

      if (response.ok) {
        isConnected = true;
        notifyStateChange('connected');
        logger.info('[RemoteControl] Connected successfully');
      }
    } catch (error) {
      logger.error(`[RemoteControl] Connection error: ${error}`);
      notifyStateChange('failed', String(error));
    }
  }

  await establishConnection();

  const handle: RemoteControlHandle = {
    sessionUrl: `${baseUrl}/sessions/${sessionId}`,
    environmentId,
    bridgeSessionId,

    write(msg: SDKMessage) {
      messageQueue.push({
        ...msg,
        uuid: msg.uuid || crypto.randomUUID(),
        timestamp: Date.now(),
      });
    },

    sendResult() {
      const resultMsg = messageQueue.find(m => m.type === 'tool_result');
      if (resultMsg) {
        logger.debug('[RemoteControl] Sending result');
      }
    },

    sendControlRequest(req: unknown) {
      controlRequestQueue.push(req);
    },

    sendControlResponse(res: unknown) {
      const idx = permissionResponseQueue.length;
      logger.debug(`[RemoteControl] Control response ${idx}`);
    },

    sendControlCancelRequest(requestId: string) {
      logger.debug(`[RemoteControl] Cancel request: ${requestId}`);
    },

    async *inboundPrompts(): AsyncGenerator<InboundPrompt> {
      while (isConnected) {
        if (inboundQueue.length > 0) {
          yield inboundQueue.shift()!;
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    },

    async *controlRequests(): AsyncGenerator<unknown> {
      while (isConnected) {
        if (controlRequestQueue.length > 0) {
          yield controlRequestQueue.shift()!;
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    },

    async *permissionResponses(): AsyncGenerator<unknown> {
      while (isConnected) {
        if (permissionResponseQueue.length > 0) {
          yield permissionResponseQueue.shift()!;
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    },

    onStateChange(cb: (state: RemoteControlState, detail?: string) => void) {
      stateListeners.push(cb);
    },

    async teardown() {
      isConnected = false;
      notifyStateChange('ready', 'Teardown complete');
      logger.info('[RemoteControl] Torn down');
    },
  };

  return handle;
}

/**
 * Watch scheduled tasks and yield events
 */
export function watchScheduledTasks(opts: {
  dir: string;
  signal: AbortSignal;
  getJitterConfig?: () => CronJitterConfig;
}): ScheduledTasksHandle {
  const { dir, signal, getJitterConfig } = opts;
  const jitter = getJitterConfig?.() ?? {
    recurringFrac: 0.1,
    recurringCapMs: 60000,
    oneShotMaxMs: 300000,
    oneShotFloorMs: 30000,
    oneShotMinuteMod: 5,
    recurringMaxAgeMs: 3600000,
  };

  const tasks: CronTask[] = [];
  let nextFireTime: number | null = null;
  let isRunning = true;

  async function loadTasks(): Promise<void> {
    try {
      const { readFile } = await import('fs/promises');
      const tasksPath = `${dir}/scheduled_tasks.json`;
      const content = await readFile(tasksPath, 'utf-8');
      const loaded = JSON.parse(content) as CronTask[];
      tasks.length = 0;
      tasks.push(...loaded);
      calculateNextFireTime();
    } catch {
      // No tasks file yet
    }
  }

  function calculateNextFireTime(): void {
    if (tasks.length === 0) {
      nextFireTime = null;
      return;
    }

    const now = Date.now();
    let earliest: number | null = null;

    for (const task of tasks) {
      const next = getNextFireTimeForTask(task);
      if (next && (!earliest || next < earliest)) {
        earliest = next;
      }
    }

    nextFireTime = earliest;
  }

  function getNextFireTimeForTask(task: CronTask): number | null {
    try {
      const [minute, hour, day, month, dow] = task.cron.split(' ');
      const now = new Date();

      const next = new Date(now);
      next.setSeconds(0);
      next.setMilliseconds(0);

      if (minute !== '*') {
        next.setMinutes(parseInt(minute, 10));
      } else {
        next.setMinutes(next.getMinutes() + 1);
      }

      if (hour !== '*') {
        next.setHours(parseInt(hour, 10));
      }

      if (next.getTime() <= now.getTime()) {
        next.setHours(next.getHours() + 1);
      }

      let jitterMs = 0;
      if (task.recurring) {
        jitterMs = Math.random() * jitter.recurringFrac * jitter.recurringCapMs;
      } else {
        const range = jitter.oneShotMaxMs - jitter.oneShotFloorMs;
        jitterMs = jitter.oneShotFloorMs + Math.random() * range;
      }

      return next.getTime() + jitterMs;
    } catch {
      return null;
    }
  }

  loadTasks();

  const handle: ScheduledTasksHandle = {
    async *events(): AsyncGenerator<ScheduledTaskEvent> {
      while (isRunning && !signal.aborted) {
        await loadTasks();

        if (nextFireTime && Date.now() >= nextFireTime) {
          const missedTasks = tasks.filter(t => {
            const next = getNextFireTimeForTask(t);
            return next && Date.now() > next + jitter.recurringMaxAgeMs;
          });

          if (missedTasks.length > 0) {
            yield { type: 'missed', tasks: missedTasks };
          }

          const taskToFire = tasks.find(t => {
            const next = getNextFireTimeForTask(t);
            return next && Date.now() >= next;
          });

          if (taskToFire) {
            yield { type: 'fire', task: taskToFire };
            calculateNextFireTime();
          }
        }

        const waitTime = nextFireTime ? Math.max(1000, nextFireTime - Date.now()) : 60000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    },

    getNextFireTime(): number | null {
      return nextFireTime;
    },
  };

  signal.addEventListener('abort', () => {
    isRunning = false;
  });

  return handle;
}

/**
 * Build notification message for missed tasks
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
  if (missed.length === 0) {
    return '';
  }

  const lines = [
    'Warning: Scheduled tasks were missed:',
    '',
  ];

  for (const task of missed) {
    lines.push(`- ${task.prompt.slice(0, 50)}... (${task.cron})`);
  }

  lines.push('');
  lines.push(`Total missed: ${missed.length}`);

  return lines.join('\n');
}