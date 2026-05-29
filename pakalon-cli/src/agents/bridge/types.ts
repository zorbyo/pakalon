/**
 * Phase Bridge Types
 * Request/response types for the TypeScript phase orchestrator HTTP bridge.
 * Replaces: python/server.py (FastAPI BridgeRequest/BridgeResponse)
 */

export interface BridgeRequest {
  phase?: number;
  description?: string;
  context?: Record<string, unknown>;
  answers?: Record<string, string>;
  project_root?: string;
}

export interface BridgeResponse {
  status: 'success' | 'error';
  message?: string;
  phase?: number;
  output?: Record<string, unknown>;
  artifacts?: string[];
  data?: Record<string, unknown>;
  duration?: number;
}

export interface PhaseResult {
  status: 'success' | 'error' | 'in_progress';
  phase: number;
  output?: Record<string, string>;
  artifacts?: string[];
  error?: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
}

export const BRIDGE_DEFAULT_PORT = 7432;
export const BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const BRIDGE_URL = process.env.PAKALON_BRIDGE_URL ?? `http://${BRIDGE_DEFAULT_HOST}:${BRIDGE_DEFAULT_PORT}`;