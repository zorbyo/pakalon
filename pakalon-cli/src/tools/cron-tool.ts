import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger.js';

export interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
  runCount: number;
}

const CRON_DIR = path.join(os.homedir(), '.pakalon', 'cron');
const CRON_FILE = path.join(CRON_DIR, 'jobs.json');

let cronJobs: Map<string, CronJob> = new Map();
let cronIntervals: Map<string, NodeJS.Timeout> = new Map();
let initialized = false;

function ensureCronDir(): void {
  if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
  }
}

function loadCronJobs(): void {
  if (initialized) {
    return;
  }

  ensureCronDir();

  if (fs.existsSync(CRON_FILE)) {
    try {
      const content = fs.readFileSync(CRON_FILE, 'utf-8');
      const jobs = JSON.parse(content) as CronJob[];

      for (const job of jobs) {
        cronJobs.set(job.id, job);
      }
    } catch (err) {
      logger.warn('Failed to load cron jobs:', err);
    }
  }

  initialized = true;
}

async function saveCronJobs(): Promise<void> {
  ensureCronDir();

  const jobs = Array.from(cronJobs.values());

  await fs.promises.writeFile(CRON_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

function parseCronExpression(expression: string): { interval: number; description: string } {
  const parts = expression.split(' ');

  if (parts.length < 5) {
    throw new Error('Invalid cron expression');
  }

  const [minute, hour, day, month, weekday] = parts;

  if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return { interval: 60000, description: 'Every minute' };
  }

  if (minute !== '*' && hour === '*' && day === '*' && month === '*') {
    const mins = parseInt(minute, 10);
    if (!isNaN(mins) && mins > 0) {
      return { interval: mins * 60000, description: `Every ${mins} minutes` };
    }
  }

  if (minute !== '*' && hour !== '*' && day === '*' && month === '*') {
    return { interval: 60000, description: `At minute ${minute} of every hour` };
  }

  return { interval: 60000, description: expression };
}

function startCronJob(job: CronJob): void {
  if (cronIntervals.has(job.id)) {
    clearInterval(cronIntervals.get(job.id)!);
    cronIntervals.delete(job.id);
  }

  if (!job.enabled) {
    return;
  }

  try {
    const { interval } = parseCronExpression(job.cronExpression);

    const intervalId = setInterval(async () => {
      await executeCronJob(job);
    }, interval);

    cronIntervals.set(job.id, intervalId);

    job.nextRun = new Date(Date.now() + interval).toISOString();
  } catch (err) {
    logger.error(`Failed to start cron job ${job.id}:`, err);
  }
}

async function executeCronJob(job: CronJob): Promise<void> {
  logger.info(`Executing cron job: ${job.name} (${job.id})`);

  job.lastRun = new Date().toISOString();
  job.runCount++;

  await saveCronJobs();

  try {
  } catch (err) {
    logger.error(`Cron job ${job.id} failed:`, err);
  }
}

export function stopCronJob(jobId: string): void {
  const interval = cronIntervals.get(jobId);
  if (interval) {
    clearInterval(interval);
    cronIntervals.delete(jobId);
  }
}

export function stopAllCronJobs(): void {
  for (const [id] of cronIntervals) {
    stopCronJob(id);
  }
}

export function startAllCronJobs(): void {
  for (const job of cronJobs.values()) {
    startCronJob(job);
  }
}

const cronCreateTool = tool({
  description: 'Create a new cron job to schedule recurring tasks',
  inputSchema: z.object({
    name: z.string().describe('Name of the cron job'),
    schedule: z.string().describe('Cron expression (e.g., "* * * * *" for every minute)'),
    command: z.string().describe('Command or prompt to execute'),
  }),
  execute: async ({ arguments: args }) => {
    loadCronJobs();

    const id = uuidv4();
    const job: CronJob = {
      id,
      name: args.name,
      cronExpression: args.schedule,
      command: args.command,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    cronJobs.set(id, job);
    await saveCronJobs();

    startCronJob(job);

    return {
      success: true,
      id,
      name: job.name,
      schedule: job.cronExpression,
      message: `Cron job created: ${job.name} (${id})`,
    };
  },
});

const cronDeleteTool = tool({
  description: 'Delete a cron job by ID',
  inputSchema: z.object({
    id: z.string().describe('ID of the cron job to delete'),
  }),
  execute: async ({ arguments: args }) => {
    loadCronJobs();

    const job = cronJobs.get(args.id);
    if (!job) {
      return { success: false, error: `Cron job not found: ${args.id}` };
    }

    stopCronJob(args.id);
    cronJobs.delete(args.id);
    await saveCronJobs();

    return { success: true, message: `Cron job deleted: ${job.name}` };
  },
});

const cronListTool = tool({
  description: 'List all cron jobs',
  inputSchema: z.object({}),
  execute: async () => {
    loadCronJobs();

    const jobs = Array.from(cronJobs.values()).map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.cronExpression,
      enabled: job.enabled,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      runCount: job.runCount,
      createdAt: job.createdAt,
    }));

    return { success: true, jobs, count: jobs.length };
  },
});

const cronToggleTool = tool({
  description: 'Enable or disable a cron job',
  inputSchema: z.object({
    id: z.string().describe('ID of the cron job'),
    enabled: z.boolean().describe('Enable or disable'),
  }),
  execute: async ({ arguments: args }) => {
    loadCronJobs();

    const job = cronJobs.get(args.id);
    if (!job) {
      return { success: false, error: `Cron job not found: ${args.id}` };
    }

    job.enabled = args.enabled;
    await saveCronJobs();

    if (job.enabled) {
      startCronJob(job);
    } else {
      stopCronJob(args.id);
    }

    return {
      success: true,
      name: job.name,
      enabled: job.enabled,
      message: `Cron job ${job.name} ${job.enabled ? 'enabled' : 'disabled'}`,
    };
  },
});

export function getAllCronTools() {
  return {
    cron_create: cronCreateTool,
    cron_delete: cronDeleteTool,
    cron_list: cronListTool,
    cron_toggle: cronToggleTool,
  };
}