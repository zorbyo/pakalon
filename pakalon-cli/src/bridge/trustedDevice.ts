/**
 * Trusted device token source for bridge (remote-control) sessions.
 *
 * Bridge sessions have SecurityTier=ELEVATED on the server (CCR v2).
 * The server gates ConnectBridgeWorker on its own flag.
 *
 * Enrollment is gated server-side by account_session.created_at < 10min,
 * so it must happen during /login. Token is persistent (90d rolling expiry)
 * and stored in secure storage.
 */

import type { TrustedDeviceConfig } from "./types.js";

let _gateEnabled = false;
let _cachedToken: string | undefined;

/**
 * Configure trusted device feature.
 */
export function configureTrustedDevice(config: TrustedDeviceConfig): void {
  _gateEnabled = config.enabled;
  _cachedToken = config.deviceToken;
}

/**
 * Get the trusted device token if available and enabled.
 */
export function getTrustedDeviceToken(): string | undefined {
  if (!_gateEnabled) {
    return undefined;
  }
  return _cachedToken;
}

/**
 * Clear the cached trusted device token.
 */
export function clearTrustedDeviceTokenCache(): void {
  _cachedToken = undefined;
}

/**
 * Enroll this device as a trusted device.
 * Call this during fresh login flows.
 */
export async function enrollTrustedDevice(): Promise<boolean> {
  if (!_gateEnabled) {
    return false;
  }

  // In a full implementation, this would:
  // 1. Call POST /auth/trusted_devices with display_name
  // 2. Store the returned device_token in secure storage
  // 3. Update _cachedToken

  return true;
}

/**
 * Check if trusted device enforcement is enabled.
 */
export function isTrustedDeviceEnabled(): boolean {
  return _gateEnabled;
}