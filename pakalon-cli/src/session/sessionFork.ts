/**
 * Session Fork
 *
 * Enables forking a session to create a branch point,
 * useful for trying different approaches without losing context.
 */

/**
 * A forked session.
 */
export interface ForkedSession {
  id: string;
  parentSessionId: string;
  forkPoint: number;
  messages: unknown[];
  createdAt: number;
}

/**
 * Fork tree node.
 */
export interface ForkTreeNode {
  sessionId: string;
  parentSessionId: string | null;
  children: string[];
  depth: number;
}

// In-memory fork storage (persists during runtime)
const forkStorage = new Map<string, ForkedSession>();
const forkChildren = new Map<string, string[]>(); // parent -> children

/**
 * Fork a session at a given point.
 */
export function forkSession(
  sessionId: string,
  options?: { position?: 'end' | 'branch'; messages?: unknown[] },
): ForkedSession {
  const forkId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const messages = options?.messages ?? [];

  const forked: ForkedSession = {
    id: forkId,
    parentSessionId: sessionId,
    forkPoint: messages.length,
    messages: [...messages],
    createdAt: Date.now(),
  };

  forkStorage.set(forkId, forked);

  // Track parent-child relationship
  const children = forkChildren.get(sessionId) ?? [];
  children.push(forkId);
  forkChildren.set(sessionId, children);

  return forked;
}

/**
 * Get a forked session by ID.
 */
export function getForkedSession(forkId: string): ForkedSession | null {
  return forkStorage.get(forkId) ?? null;
}

/**
 * Get the fork tree from a root session.
 */
export function getForkTree(sessionId: string): ForkTreeNode[] {
  const nodes: ForkTreeNode[] = [];
  const visited = new Set<string>();

  function traverse(sid: string, depth: number): void {
    if (visited.has(sid)) return;
    visited.add(sid);

    const children = forkChildren.get(sid) ?? [];
    nodes.push({
      sessionId: sid,
      parentSessionId: forkStorage.get(sid)?.parentSessionId ?? null,
      children,
      depth,
    });

    for (const childId of children) {
      traverse(childId, depth + 1);
    }
  }

  traverse(sessionId, 0);
  return nodes;
}

/**
 * Get all forks of a session.
 */
export function getForksOf(sessionId: string): ForkedSession[] {
  const children = forkChildren.get(sessionId) ?? [];
  return children.map((id) => forkStorage.get(id)).filter((f): f is ForkedSession => f !== null);
}

/**
 * Delete a fork and its children.
 */
export function deleteFork(forkId: string): boolean {
  const fork = forkStorage.get(forkId);
  if (!fork) return false;

  // Delete children recursively
  const children = forkChildren.get(forkId) ?? [];
  for (const childId of children) {
    deleteFork(childId);
  }

  forkStorage.delete(forkId);
  forkChildren.delete(forkId);

  // Remove from parent's children list
  const parentChildren = forkChildren.get(fork.parentSessionId) ?? [];
  const index = parentChildren.indexOf(forkId);
  if (index !== -1) {
    parentChildren.splice(index, 1);
  }

  return true;
}
