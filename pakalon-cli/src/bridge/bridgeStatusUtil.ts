/**
 * Bridge status utilities.
 *
 * Provides formatting and URL building helpers for bridge status display.
 */

import type { BridgeConfig, SessionActivity, SpawnMode } from "./types.js";

export type StatusState =
  | "idle"
  | "attached"
  | "titled"
  | "reconnecting"
  | "failed";

export const TOOL_DISPLAY_EXPIRY_MS = 30_000;

export function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function truncateToWidth(text: string, width: number): string {
  if (text.length <= width) return text;
  return text.slice(0, width - 3) + "...";
}

export function abbreviateActivity(summary: string): string {
  return truncateToWidth(summary, 30);
}

export function buildBridgeConnectUrl(
  environmentId: string,
  ingressUrl?: string
): string {
  const baseUrl = ingressUrl ?? "https://claude.ai";
  return `${baseUrl}/code?bridge=${environmentId}`;
}

export function buildBridgeSessionUrl(
  sessionId: string,
  environmentId: string,
  ingressUrl?: string
): string {
  const baseUrl = ingressUrl ?? "https://claude.ai";
  return `${baseUrl}/code/${sessionId}?bridge=${environmentId}`;
}

export type BridgeStatusInfo = {
  label:
    | "Remote Control failed"
    | "Remote Control reconnecting"
    | "Remote Control active"
    | "Remote Control connecting…";
  color: "error" | "warning" | "success";
};

export function getBridgeStatus({
  error,
  connected,
  sessionActive,
  reconnecting,
}: {
  error: string | undefined;
  connected: boolean;
  sessionActive: boolean;
  reconnecting: boolean;
}): BridgeStatusInfo {
  if (error) return { label: "Remote Control failed", color: "error" };
  if (reconnecting)
    return { label: "Remote Control reconnecting", color: "warning" };
  if (sessionActive || connected)
    return { label: "Remote Control active", color: "success" };
  return { label: "Remote Control connecting…", color: "warning" };
}

export function buildIdleFooterText(url: string): string {
  return `Code everywhere with the Claude app or ${url}`;
}

export function buildActiveFooterText(url: string): string {
  return `Continue coding in the Claude app or ${url}`;
}

export const FAILED_FOOTER_TEXT = "Something went wrong, please try again";

export function wrapWithOsc8Link(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}