/**
 * Bypass Permissions Killswitch
 *
 * Emergency mechanism to bypass all permission checks.
 * When activated, all tool calls are auto-approved without user confirmation.
 *
 * Activation: PAKALON_BYPASS_PERMISSIONS_KILLSWITCH=true
 */

import logger from '@/utils/logger.js';

/**
 * Killswitch state.
 */
interface KillswitchState {
  active: boolean;
  activatedAt: Date | null;
  activatedBy: string | null;
}

/**
 * Emergency bypass for all permission checks.
 */
export class BypassPermissionsKillswitch {
  private state: KillswitchState = {
    active: false,
    activatedAt: null,
    activatedBy: null,
  };

  constructor() {
    // Check env var on construction
    if (process.env.PAKALON_BYPASS_PERMISSIONS_KILLSWITCH === 'true') {
      this.enable('env:PAKALON_BYPASS_PERMISSIONS_KILLSWITCH');
    }
  }

  /**
   * Activate the killswitch.
   */
  enable(activatedBy: string = 'manual'): void {
    if (this.state.active) return;

    this.state = {
      active: true,
      activatedAt: new Date(),
      activatedBy,
    };

    logger.warn('[BypassKillswitch] ACTIVATED', {
      activatedBy,
      activatedAt: this.state.activatedAt.toISOString(),
    });
  }

  /**
   * Deactivate the killswitch.
   */
  disable(): void {
    if (!this.state.active) return;

    logger.info('[BypassKillswitch] Deactivated', {
      wasActiveFor: this.state.activatedAt
        ? Date.now() - this.state.activatedAt.getTime()
        : 0,
    });

    this.state = {
      active: false,
      activatedAt: null,
      activatedBy: null,
    };
  }

  /**
   * Check if the killswitch is active.
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Get when the killswitch was activated.
   */
  getActivatedAt(): Date | null {
    return this.state.activatedAt;
  }

  /**
   * Get who/what activated the killswitch.
   */
  getActivatedBy(): string | null {
    return this.state.activatedBy;
  }

  /**
   * Get killswitch status for display.
   */
  getStatus(): {
    active: boolean;
    activatedAt: string | null;
    activatedBy: string | null;
    activeForMs: number | null;
  } {
    return {
      active: this.state.active,
      activatedAt: this.state.activatedAt?.toISOString() ?? null,
      activatedBy: this.state.activatedBy,
      activeForMs:
        this.state.activatedAt ? Date.now() - this.state.activatedAt.getTime() : null,
    };
  }
}

// Singleton instance
let _instance: BypassPermissionsKillswitch | null = null;

/**
 * Get the global killswitch instance.
 */
export function getBypassKillswitch(): BypassPermissionsKillswitch {
  if (!_instance) {
    _instance = new BypassPermissionsKillswitch();
  }
  return _instance;
}
