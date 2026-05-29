import { EventEmitter } from 'events';
import * as readline from 'readline';
import logger from '@/utils/logger.js';

export interface IdleTimeoutConfig {
  enabled: boolean;
  timeout: number;
  warningThreshold: number;
  onIdle?: () => void;
  onWarning?: () => void;
  onTimeout?: () => void;
  onActivity?: () => void;
}

const DEFAULT_CONFIG: IdleTimeoutConfig = {
  enabled: false,
  timeout: 300000,
  warningThreshold: 60000,
};

class IdleTimeoutManager extends EventEmitter {
  private config: IdleTimeoutConfig = { ...DEFAULT_CONFIG };
  private lastActivityTime = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private isIdle = false;
  private activityListenersAttached = false;

  constructor() {
    super();
  }

  start(config?: Partial<IdleTimeoutConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.enabled) {
      return;
    }

    this.lastActivityTime = Date.now();
    this.setupActivityListeners();
    this.startTimers();

    logger.info(`Idle timeout manager started (timeout: ${this.config.timeout}ms)`);
  }

  stop(): void {
    this.clearTimers();
    this.isIdle = false;
    this.emit('stopped');
    logger.info('Idle timeout manager stopped');
  }

  private setupActivityListeners(): void {
    if (this.activityListenersAttached) {
      return;
    }

    process.stdin.on('data', () => this.recordActivity());
    process.stdout.on('resize', () => this.recordActivity());

    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
      process.stdin.on('keypress', () => this.recordActivity());
    }

    this.activityListenersAttached = true;
  }

  recordActivity(): void {
    const wasIdle = this.isIdle;
    const now = Date.now();

    this.lastActivityTime = now;
    this.isIdle = false;

    if (wasIdle) {
      this.emit('activity');
      logger.debug('Activity detected, no longer idle');

      if (this.config.onActivity) {
        this.config.onActivity();
      }
    }

    this.restartTimers();
  }

  private startTimers(): void {
    this.clearTimers();

    this.warningTimer = setTimeout(() => {
      this.emit('warning');
      logger.warn('Idle timeout warning');

      if (this.config.onWarning) {
        this.config.onWarning();
      }
    }, this.config.timeout - this.config.warningThreshold);

    this.idleTimer = setTimeout(() => {
      this.isIdle = true;
      this.emit('idle');
      logger.info('Idle timeout reached');

      if (this.config.onIdle) {
        this.config.onIdle();
      }

      if (this.config.onTimeout) {
        const result = this.config.onTimeout();
        if (result !== false) {
          this.emit('timeout');
        }
      }
    }, this.config.timeout);
  }

  private restartTimers(): void {
    if (this.config.enabled) {
      this.startTimers();
    }
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
  }

  getIdleTime(): number {
    return Date.now() - this.lastActivityTime;
  }

  getRemainingTime(): number {
    return Math.max(0, this.config.timeout - this.getIdleTime());
  }

  isCurrentlyIdle(): boolean {
    return this.isIdle;
  }

  getConfig(): IdleTimeoutConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<IdleTimeoutConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    if (this.config.enabled && !wasEnabled) {
      this.start(this.config);
    } else if (!this.config.enabled && wasEnabled) {
      this.stop();
    } else if (this.config.enabled) {
      this.restartTimers();
    }
  }

  resetIdleTime(): void {
    this.recordActivity();
  }

  pause(): void {
    this.clearTimers();
    this.emit('paused');
  }

  resume(): void {
    if (this.config.enabled) {
      this.startTimers();
      this.emit('resumed');
    }
  }
}

export const idleTimeoutManager = new IdleTimeoutManager();

export function startIdleTimeout(config?: Partial<IdleTimeoutConfig>): void {
  idleTimeoutManager.start(config);
}

export function stopIdleTimeout(): void {
  idleTimeoutManager.stop();
}

export function resetIdleTimer(): void {
  idleTimeoutManager.resetIdleTime();
}

export function getIdleTime(): number {
  return idleTimeoutManager.getIdleTime();
}

export function getRemainingIdleTime(): number {
  return idleTimeoutManager.getRemainingTime();
}

export function setIdleTimeoutConfig(config: Partial<IdleTimeoutConfig>): void {
  idleTimeoutManager.setConfig(config);
}