/**
 * SDK - Main entry point
 * Pakalon SDK for programmatic CLI usage
 */
export * from './coreTypes.js';
export * from './session.js';
export * from './query.js';

import { createSession, getSession, listSessions, renameSession, tagSession, forkSession, deleteSession } from './session.js';
import { query, queryStream } from './query.js';
import type { SDKConfig, QueryOptions, SessionCreateOptions, SessionListOptions } from './coreTypes.js';

let sdkConfig: SDKConfig = {};

export function configure(config: SDKConfig): void {
  sdkConfig = { ...sdkConfig, ...config };
}

export function getConfig(): SDKConfig {
  return { ...sdkConfig };
}

export async function createNewSession(options?: SessionCreateOptions) {
  return createSession(options);
}

export async function getSessionInfo(sessionId: string) {
  return getSession(sessionId);
}

export async function listAllSessions(options?: SessionListOptions) {
  return listSessions(options);
}

export async function renameSessionById(sessionId: string, description: string) {
  return renameSession(sessionId, description);
}

export async function tagSessionById(sessionId: string, tags: string[]) {
  return tagSession(sessionId, tags);
}

export async function forkExistingSession(sessionId: string) {
  return forkSession(sessionId);
}

export async function deleteSessionById(sessionId: string) {
  return deleteSession(sessionId);
}

export async function querySession(options: QueryOptions) {
  return query({ ...options, ...sdkConfig });
}

export async function* querySessionStream(options: QueryOptions) {
  yield* queryStream({ ...options, ...sdkConfig });
}

const sdk = {
  configure,
  getConfig,
  session: {
    create: createNewSession,
    get: getSessionInfo,
    list: listAllSessions,
    rename: renameSessionById,
    tag: tagSessionById,
    fork: forkExistingSession,
    delete: deleteSessionById,
  },
  query: querySession,
  queryStream: querySessionStream,
};

export default sdk;