import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger.js';

export interface TmuxSession {
  id: string;
  name: string;
  windowId: string;
  createdAt: string;
  cwd: string;
}

export interface TmuxPane {
  id: number;
  currentPath: string;
  processId?: number;
}

const TMUX_STATE_DIR = '.pakalon/tmux';

let currentSessionId: string | null = null;
let tmuxSessions: Map<string, TmuxSession> = new Map();

export function isTmuxAvailable(): boolean {
  return new Promise<boolean>((resolve) => {
    exec('which tmux', (err) => {
      resolve(!err);
    });
  }) as unknown as boolean;
}

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export async function createTmuxSession(
  name: string,
  cwd: string = process.cwd()
): Promise<TmuxSession | null> {
  const sessionId = uuidv4();

  return new Promise((resolve) => {
    const tmuxArgs = [
      'new-session',
      '-d',
      '-s', name,
      '-c', cwd,
    ];

    const proc = spawn('tmux', tmuxArgs);

    proc.on('close', (code) => {
      if (code === 0) {
        const session: TmuxSession = {
          id: sessionId,
          name,
          windowId: name,
          createdAt: new Date().toISOString(),
          cwd,
        };

        tmuxSessions.set(sessionId, session);
        saveTmuxSessions();
        currentSessionId = sessionId;

        resolve(session);
      } else {
        logger.error(`Failed to create tmux session: ${name}`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      logger.error('tmux error:', err);
      resolve(null);
    });
  });
}

export async function attachToTmuxSession(sessionName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

export async function sendToTmuxSession(
  sessionName: string,
  command: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', [
      'send-keys',
      '-t', sessionName,
      command,
      'Enter',
    ]);

    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

export async function killTmuxSession(sessionName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', ['kill-session', '-t', sessionName]);

    proc.on('close', (code) => {
      if (code === 0) {
        for (const [id, session] of tmuxSessions) {
          if (session.name === sessionName) {
            tmuxSessions.delete(id);
            break;
          }
        }
        saveTmuxSessions();
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  return new Promise((resolve) => {
    exec('tmux list-sessions -F "#{session_name} #{session_id}"', (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }

      const sessions: TmuxSession[] = [];
      const lines = stdout.split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          sessions.push({
            id: parts[1],
            name: parts[0],
            windowId: parts[0],
            createdAt: new Date().toISOString(),
            cwd: '',
          });
        }
      }

      resolve(sessions);
    });
  });
}

export async function createTmuxWindow(
  sessionName: string,
  windowName: string,
  cwd?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['new-window', '-t', sessionName, '-n', windowName];
    if (cwd) {
      args.push('-c', cwd);
    }

    const proc = spawn('tmux', args);

    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

export async function splitTmuxPane(
  sessionName: string,
  windowPane: string = '-0',
  vertical: boolean = true,
  cwd?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      'split-window',
      '-t', `${sessionName}:${windowPane}`,
      vertical ? '-v' : '-h',
    ];
    if (cwd) {
      args.push('-c', cwd);
    }

    const proc = spawn('tmux', args);

    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

export async function captureTmuxPane(
  sessionName: string,
  windowPane: string = '-0'
): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`tmux capture-pane -t ${sessionName}:${windowPane} -p`, (err, stdout) => {
      if (err) {
        resolve(null);
      } else {
        resolve(stdout);
      }
    });
  });
}

function saveTmuxSessions(): void {
  const statePath = path.join(process.cwd(), TMUX_STATE_DIR, 'sessions.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(Array.from(tmuxSessions.entries()), null, 2), 'utf-8');
}

function loadTmuxSessions(): void {
  const statePath = path.join(process.cwd(), TMUX_STATE_DIR, 'sessions.json');

  if (fs.existsSync(statePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      tmuxSessions = new Map(data);
    } catch {
    }
  }
}

export function getCurrentTmuxSession(): TmuxSession | null {
  if (currentSessionId) {
    return tmuxSessions.get(currentSessionId) || null;
  }
  return null;
}

export function getTmuxSessionByName(name: string): TmuxSession | undefined {
  for (const session of tmuxSessions.values()) {
    if (session.name === name) {
      return session;
    }
  }
  return undefined;
}

export async function setupTmuxForSession(
  sessionName: string,
  cwd: string = process.cwd()
): Promise<TmuxSession | null> {
  loadTmuxSessions();

  const existing = getTmuxSessionByName(sessionName);
  if (existing) {
    currentSessionId = existing.id;
    return existing;
  }

  return createTmuxSession(sessionName, cwd);
}

export async function cleanupTmuxSessions(): Promise<void> {
  for (const session of tmuxSessions.values()) {
    await killTmuxSession(session.name);
  }
  tmuxSessions.clear();
  currentSessionId = null;
}