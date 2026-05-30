/**
 * Notifications Context for pakalon-cli
 *
 * Provides a notification system with priority-based queue management.
 */

import React, { useCallback, useEffect, useState } from "react";

// ============================================================================
// Types
// ============================================================================

type Priority = "low" | "medium" | "high" | "immediate";

type BaseNotification = {
  key: string;
  invalidates?: string[];
  priority: Priority;
  timeoutMs?: number;
  fold?: (
    accumulator: Notification,
    incoming: Notification
  ) => Notification;
};

type TextNotification = BaseNotification & {
  text: string;
  color?: string;
};

type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};

export type Notification = TextNotification | JSXNotification;

type NotificationState = {
  current: Notification | null;
  queue: Notification[];
};

type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 8000;

const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ============================================================================
// Helpers
// ============================================================================

function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) =>
    PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min
  );
}

// ============================================================================
// Hook
// ============================================================================

let currentTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
  currentNotification: Notification | null;
} {
  const [state, setState] = useState<NotificationState>({
    current: null,
    queue: [],
  });

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    setState((prev) => {
      const next = getNext(prev.queue);
      if (prev.current !== null || !next) {
        return prev;
      }

      // Set up timeout for the next notification
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
      }
      currentTimeoutId = setTimeout(() => {
        currentTimeoutId = null;
        setState((prev) => {
          if (prev.current?.key !== next.key) {
            return prev;
          }
          return {
            current: null,
            queue: prev.queue.filter((n) => n !== next),
          };
        });
        processQueue();
      }, next.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      return {
        current: next,
        queue: prev.queue.filter((n) => n !== next),
      };
    });
  }, []);

  const addNotification = useCallback<AddNotificationFn>(
    (notif: Notification) => {
      // Handle immediate priority notifications
      if (notif.priority === "immediate") {
        if (currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        currentTimeoutId = setTimeout(() => {
          currentTimeoutId = null;
          setState((prev) => {
            if (prev.current?.key !== notif.key) {
              return prev;
            }
            return {
              current: null,
              queue: prev.queue.filter(
                (n) =>
                  !notif.invalidates?.includes(n.key)
              ),
            };
          });
          processQueue();
        }, notif.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        setState((prev) => ({
          current: notif,
          queue: [
            ...(prev.current ? [prev.current] : []),
            ...prev.queue,
          ].filter(
            (n) =>
              n.priority !== "immediate" &&
              !notif.invalidates?.includes(n.key)
          ),
        }));
        return;
      }

      // Handle non-immediate notifications
      setState((prev) => {
        // Check if we can fold into an existing notification
        if (notif.fold) {
          if (prev.current?.key === notif.key) {
            const folded = notif.fold(prev.current, notif);
            if (currentTimeoutId) {
              clearTimeout(currentTimeoutId);
              currentTimeoutId = null;
            }
            currentTimeoutId = setTimeout(() => {
              currentTimeoutId = null;
              setState((p) => {
                if (p.current?.key !== folded.key) {
                  return p;
                }
                return {
                  current: null,
                  queue: p.queue,
                };
              });
              processQueue();
            }, folded.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            return {
              current: folded,
              queue: prev.queue,
            };
          }

          const queueIdx = prev.queue.findIndex(
            (n) => n.key === notif.key
          );
          if (queueIdx !== -1) {
            const folded = notif.fold(prev.queue[queueIdx], notif);
            const newQueue = [...prev.queue];
            newQueue[queueIdx] = folded;
            return {
              current: prev.current,
              queue: newQueue,
            };
          }
        }

        // Only add to queue if not already present
        const queuedKeys = new Set(prev.queue.map((n) => n.key));
        const shouldAdd =
          !queuedKeys.has(notif.key) &&
          prev.current?.key !== notif.key;
        if (!shouldAdd) return prev;

        const invalidatesCurrent =
          prev.current !== null &&
          notif.invalidates?.includes(prev.current.key);
        if (invalidatesCurrent && currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        return {
          current: invalidatesCurrent ? null : prev.current,
          queue: [
            ...prev.queue.filter(
              (n) =>
                n.priority !== "immediate" &&
                !notif.invalidates?.includes(n.key)
            ),
            notif,
          ],
        };
      });

      processQueue();
    },
    [processQueue]
  );

  const removeNotification = useCallback<RemoveNotificationFn>(
    (key: string) => {
      setState((prev) => {
        const isCurrent = prev.current?.key === key;
        const inQueue = prev.queue.some((n) => n.key === key);
        if (!isCurrent && !inQueue) {
          return prev;
        }
        if (isCurrent && currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }
        return {
          current: isCurrent ? null : prev.current,
          queue: prev.queue.filter((n) => n.key !== key),
        };
      });
      processQueue();
    },
    [processQueue]
  );

  // Process queue on mount if there are notifications in the initial state
  useEffect(() => {
    if (state.queue.length > 0) {
      processQueue();
    }
  }, []);

  return {
    addNotification,
    removeNotification,
    currentNotification: state.current,
  };
}
