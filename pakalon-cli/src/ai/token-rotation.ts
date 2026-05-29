/**
 * Token Rotation — Automatic OAuth token refresh and management.
 *
 * Automatically refreshes auth tokens before expiry:
 * - Monitors token TTL
 * - Refreshes before expiry (configurable buffer)
 * - Stores tokens securely on disk
 * - Handles refresh failures with exponential backoff
 *
 * Works with the device code auth flow used by pakalon-backend
 * and Clerk JWTs with 90-day expiry.
 *
 * Usage:
 *   const rotator = new TokenRotator({ autoRefresh: true });
 *   await rotator.initialize({
 *     accessToken: "...",
 *     refreshToken: "...",
 *     expiresAt: Date.now() + 7_776_000_000, // 90 days
 *   });
 *
 *   // Later, get the access token (auto-refreshes if needed):
 *   const token = await rotator.getAccessToken();
 *
 *   // Or start automatic background refresh:
 *   rotator.startAutoRefresh(async () => {
 *     // Call your auth endpoint
 *     return { accessToken: "...", expiresAt: Date.now() + ... };
 *   });
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredTokens {
  /** Current access token (JWT) */
  accessToken: string;
  /** Optional refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Expiry timestamp (Unix ms) */
  expiresAt: number;
  /** OAuth scope */
  scope?: string;
  /** Token type (e.g., "Bearer") */
  tokenType?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface TokenRotationConfig {
  /** Refresh when TTL drops below this (ms). Default: 5 minutes */
  refreshBufferMs: number;
  /** Max refresh attempts before giving up */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelayMs: number;
  /** Whether to enable auto-refresh */
  autoRefresh: boolean;
  /** Check interval for auto-refresh (ms). Default: 60 seconds */
  checkIntervalMs: number;
  /** Storage path for token persistence */
  storagePath: string;
}

export interface TokenRotationResult {
  /** Whether the rotation was successful */
  success: boolean;
  /** Whether the token was actually rotated */
  rotated: boolean;
  /** New expiry timestamp if rotated */
  newExpiresAt?: number;
  /** Error message if failed */
  error?: string;
  /** Remaining TTL after rotation in ms */
  remainingTtlMs?: number;
}

export interface TokenRotationStats {
  /** Total refresh attempts */
  totalRefreshes: number;
  /** Successful refreshes */
  successfulRefreshes: number;
  /** Failed refreshes */
  failedRefreshes: number;
  /** Timestamp of last refresh attempt */
  lastRefreshAt?: Date;
  /** Whether the last refresh succeeded */
  lastRefreshResult?: boolean;
  /** Whether the current token is expired */
  isExpired: boolean;
  /** Remaining TTL in ms */
  ttlMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TokenRotationConfig = {
  refreshBufferMs: 5 * 60 * 1000, // 5 minutes before expiry
  maxRetries: 3,
  retryDelayMs: 1000,
  autoRefresh: true,
  checkIntervalMs: 60_000, // Check every minute
  storagePath: path.join(
    os.homedir(),
    ".config",
    "pakalon",
    ".token-store.json",
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Token Rotator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages automatic OAuth token rotation with background monitoring.
 *
 * Features:
 * - Proactive refresh before token expiry
 * - Persistent storage of tokens to disk
 * - Background polling for auto-refresh
 * - Configurable retry with backoff
 * - Statistics tracking for observability
 */
export class TokenRotator {
  private tokens: StoredTokens | null = null;
  private config: TokenRotationConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private refreshInProgress = false;
  private stats: TokenRotationStats = {
    totalRefreshes: 0,
    successfulRefreshes: 0,
    failedRefreshes: 0,
    isExpired: false,
    ttlMs: 0,
  };

  constructor(config?: Partial<TokenRotationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with a set of tokens.
   * Optionally persists to disk.
   */
  async initialize(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
    this.updateStats();
    await this.save();
    logger.info("[TokenRotation] Tokens initialized", {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      ttlMs: this.getTtlMs(),
    });
  }

  /**
   * Load tokens from persistent storage.
   * Returns null if no stored tokens exist.
   */
  async load(): Promise<StoredTokens | null> {
    try {
      if (!fs.existsSync(this.config.storagePath)) {
        return null;
      }

      const raw = await fs.promises.readFile(this.config.storagePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const data = parsed as Partial<StoredTokens>;

      if (!data.accessToken || !data.expiresAt) {
        logger.warn("[TokenRotation] Invalid stored tokens");
        return null;
      }

      this.tokens = data as StoredTokens;
      this.updateStats();
      logger.debug("[TokenRotation] Tokens loaded from storage", {
        expiresAt: new Date(data.expiresAt).toISOString(),
      });

      return this.tokens;
    } catch (err) {
      logger.warn("[TokenRotation] Failed to load tokens", {
        error: String(err),
      });
      return null;
    }
  }

  /**
   * Save current tokens to persistent storage.
   */
  async save(): Promise<void> {
    if (!this.tokens) return;

    try {
      await fs.promises.mkdir(path.dirname(this.config.storagePath), {
        recursive: true,
      });

      // Mask the access token for logging
      const maskedToken = this.tokens.accessToken
        ? `${this.tokens.accessToken.slice(0, 8)}...${this.tokens.accessToken.slice(-4)}`
        : "none";

      await fs.promises.writeFile(
        this.config.storagePath,
        JSON.stringify(this.tokens, null, 2),
        "utf-8",
      );

      logger.debug("[TokenRotation] Tokens saved to storage", {
        tokenPreview: maskedToken,
      });
    } catch (err) {
      logger.warn("[TokenRotation] Failed to save tokens", {
        error: String(err),
      });
    }
  }

  /**
   * Get the current access token.
   * Automatically triggers a refresh if the token is close to expiry.
   *
   * @throws If token is expired and cannot be refreshed
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error(
        "No tokens available. Call initialize() or load() first.",
      );
    }

    // Auto-refresh if needed
    if (this.needsRefresh() && !this.refreshInProgress) {
      logger.info("[TokenRotation] Auto-refreshing token before expiry");
      await this.refreshToken(async () => {
        // If no refresh callback provided, this will fail gracefully
        throw new Error(
          "No refresh function provided. Call startAutoRefresh() with a refresh function.",
        );
      });
    }

    if (this.stats.isExpired) {
      throw new Error(
        "Token is expired and no refresh function is available to rotate it.",
      );
    }

    return this.tokens.accessToken;
  }

  /**
   * Force an immediate token refresh.
   *
   * @param refreshFn - Optional function that returns new tokens.
   *                    If not provided, uses the previously registered refresh function.
   */
  async refresh(
    refreshFn?: () => Promise<StoredTokens>,
  ): Promise<TokenRotationResult> {
    if (!refreshFn) {
      return {
        success: false,
        rotated: false,
        error: "No refresh function provided",
      };
    }

    return await this.refreshToken(refreshFn);
  }

  /**
   * Check if the token needs refresh based on expiry and buffer.
   */
  needsRefresh(): boolean {
    if (!this.tokens) return false;
    const ttl = this.getTtlMs();
    return ttl < this.config.refreshBufferMs;
  }

  /**
   * Get time until token expiry in milliseconds.
   * Returns negative if expired.
   */
  getTtlMs(): number {
    if (!this.tokens) return 0;
    return this.tokens.expiresAt - Date.now();
  }

  /**
   * Start the background auto-refresh monitor.
   * Periodically checks token TTL and refreshes if needed.
   *
   * @param refreshFn - Async function that returns new StoredTokens
   */
  startAutoRefresh(refreshFn: () => Promise<StoredTokens>): void {
    if (this.checkInterval) {
      logger.warn("[TokenRotation] Auto-refresh already running");
      return;
    }

    if (!this.tokens) {
      logger.warn("[TokenRotation] No tokens to monitor");
      return;
    }

    logger.info("[TokenRotation] Starting auto-refresh monitor", {
      interval: this.config.checkIntervalMs,
      ttlMs: this.getTtlMs(),
    });

    this.checkInterval = setInterval(async () => {
      try {
        if (this.refreshInProgress) return;

        if (this.needsRefresh()) {
          logger.info("[TokenRotation] Auto-refresh triggered", {
            ttlMs: this.getTtlMs(),
          });
          await this.refreshToken(refreshFn);
        }
      } catch (err) {
        logger.error("[TokenRotation] Auto-refresh error", {
          error: String(err),
        });
      }
    }, this.config.checkIntervalMs);

    // Unref so it doesn't keep the process alive
    if (typeof this.checkInterval === "object" && "unref" in this.checkInterval) {
      this.checkInterval.unref();
    }
  }

  /**
   * Stop the background auto-refresh monitor.
   */
  stopAutoRefresh(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info("[TokenRotation] Auto-refresh stopped");
    }
  }

  /**
   * Get rotation statistics.
   */
  getStats(): TokenRotationStats {
    return { ...this.stats };
  }

  /**
   * Clear all stored tokens from memory and disk.
   */
  async clear(): Promise<void> {
    this.tokens = null;
    this.stats = {
      totalRefreshes: 0,
      successfulRefreshes: 0,
      failedRefreshes: 0,
      isExpired: true,
      ttlMs: 0,
    };

    try {
      if (fs.existsSync(this.config.storagePath)) {
        await fs.promises.unlink(this.config.storagePath);
      }
    } catch (err) {
      logger.warn("[TokenRotation] Failed to clear stored tokens", {
        error: String(err),
      });
    }

    logger.info("[TokenRotation] Tokens cleared");
  }

  // ── Internal ──────────────────────────────────────────────────────────

  /**
   * Internal token refresh with retry logic and backoff.
   */
  private async refreshToken(
    refreshFn: () => Promise<StoredTokens>,
  ): Promise<TokenRotationResult> {
    if (this.refreshInProgress) {
      return {
        success: false,
        rotated: false,
        error: "Refresh already in progress",
      };
    }

    this.refreshInProgress = true;
    this.stats.totalRefreshes++;

    let lastError: string | undefined;
    let attempt = 0;

    while (attempt < this.config.maxRetries) {
      attempt++;
      try {
        const newTokens = await refreshFn();

        this.tokens = newTokens;
        this.stats.successfulRefreshes++;
        this.stats.lastRefreshAt = new Date();
        this.stats.lastRefreshResult = true;
        this.updateStats();

        await this.save();

        logger.info("[TokenRotation] Token refresh succeeded", {
          attempt,
          newExpiry: new Date(newTokens.expiresAt).toISOString(),
          ttlMs: this.getTtlMs(),
        });

        return {
          success: true,
          rotated: true,
          newExpiresAt: newTokens.expiresAt,
          remainingTtlMs: this.getTtlMs(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn("[TokenRotation] Token refresh attempt failed", {
          attempt,
          error: lastError,
        });

        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    this.stats.failedRefreshes++;
    this.stats.lastRefreshResult = false;
    this.stats.lastRefreshAt = new Date();
    this.updateStats();

    const result: TokenRotationResult = {
      success: false,
      rotated: false,
      error: lastError ?? "Token refresh failed after max retries",
      remainingTtlMs: this.getTtlMs(),
    };

    logger.error("[TokenRotation] Token refresh failed permanently", result);
    return result;
  }

  /**
   * Update derived statistics from current tokens.
   */
  private updateStats(): void {
    if (!this.tokens) {
      this.stats.isExpired = true;
      this.stats.ttlMs = 0;
      return;
    }

    const ttl = this.getTtlMs();
    this.stats.ttlMs = ttl;
    this.stats.isExpired = ttl <= 0;
  }

  /**
   * Validate that stored tokens are well-formed.
   */
  private validateTokens(): boolean {
    if (!this.tokens) return false;
    if (!this.tokens.accessToken || typeof this.tokens.accessToken !== "string")
      return false;
    if (typeof this.tokens.expiresAt !== "number") return false;
    if (Number.isNaN(this.tokens.expiresAt)) return false;
    return true;
  }
}
