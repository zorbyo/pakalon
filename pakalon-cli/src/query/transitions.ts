/**
 * Query State Transitions
 * Manages state machine transitions for query execution
 */
import type { QueryPhase } from './QueryEngine.js';
import logger from '@/utils/logger.js';

export type TransitionHandler = (from: QueryPhase, to: QueryPhase) => void;

export interface TransitionEvent {
  from: QueryPhase;
  to: QueryPhase;
  timestamp: number;
}

const transitionHistory: TransitionEvent[] = [];
const handlers: Set<TransitionHandler> = new Set();

const VALID_TRANSITIONS: Map<QueryPhase, QueryPhase[]> = new Map([
  ['init', ['planning', 'error']],
  ['planning', ['execution', 'error']],
  ['execution', ['compacting', 'recovery', 'complete', 'error']],
  ['compacting', ['execution', 'error']],
  ['recovery', ['execution', 'error']],
  ['complete', []],
  ['error', []],
]);

export function transition(from: QueryPhase, to: QueryPhase): boolean {
  const validTargets = VALID_TRANSITIONS.get(from) ?? [];

  if (!validTargets.includes(to)) {
    logger.warn(`[QueryTransitions] Invalid transition: ${from} -> ${to}`);
    return false;
  }

  const event: TransitionEvent = {
    from,
    to,
    timestamp: Date.now(),
  };

  transitionHistory.push(event);
  logger.debug(`[QueryTransitions] ${from} -> ${to}`);

  handlers.forEach(handler => {
    try {
      handler(from, to);
    } catch (error) {
      logger.error(`[QueryTransitions] Handler error: ${error}`);
    }
  });

  return true;
}

export function canTransition(from: QueryPhase, to: QueryPhase): boolean {
  const validTargets = VALID_TRANSITIONS.get(from) ?? [];
  return validTargets.includes(to);
}

export function addTransitionHandler(handler: TransitionHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function removeTransitionHandler(handler: TransitionHandler): void {
  handlers.delete(handler);
}

export function getTransitionHistory(): TransitionEvent[] {
  return [...transitionHistory];
}

export function clearTransitionHistory(): void {
  transitionHistory.length = 0;
}

export function getLastTransition(): TransitionEvent | undefined {
  return transitionHistory[transitionHistory.length - 1];
}

export function getCurrentPhase(): QueryPhase {
  const last = getLastTransition();
  return last?.to ?? 'init';
}

export function isTerminalPhase(phase: QueryPhase): boolean {
  return phase === 'complete' || phase === 'error';
}

export function isActivePhase(phase: QueryPhase): boolean {
  return !isTerminalPhase(phase);
}

export { QueryPhase, TransitionEvent, TransitionHandler };