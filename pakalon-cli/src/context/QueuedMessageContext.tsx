/**
 * Queued Message Context for pakalon-cli
 *
 * Manages a queue of messages that need to be processed.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

// ============================================================================
// Types
// ============================================================================

type Message = {
  id: string;
  content: string;
  timestamp: number;
  priority?: "low" | "normal" | "high";
};

type QueuedMessageContextType = {
  queue: Message[];
  enqueue: (message: Omit<Message, "id" | "timestamp">) => string;
  dequeue: () => Message | undefined;
  peek: () => Message | undefined;
  clear: () => void;
  remove: (id: string) => boolean;
  size: () => number;
};

// ============================================================================
// Context
// ============================================================================

const QueuedMessageContext = createContext<QueuedMessageContextType | null>(
  null
);

// ============================================================================
// Provider
// ============================================================================

type Props = {
  children: React.ReactNode;
};

export function QueuedMessageProvider({ children }: Props) {
  const [queue, setQueue] = useState<Message[]>([]);

  const enqueue = useCallback(
    (message: Omit<Message, "id" | "timestamp">): string => {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const newMessage: Message = {
        ...message,
        id,
        timestamp: Date.now(),
      };

      setQueue((prev) => {
        // Insert based on priority
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const msgPriority = priorityOrder[message.priority ?? "normal"];

        let insertIndex = prev.length;
        for (let i = 0; i < prev.length; i++) {
          const prevPriority =
            priorityOrder[prev[i].priority ?? "normal"];
          if (msgPriority < prevPriority) {
            insertIndex = i;
            break;
          }
        }

        const newQueue = [...prev];
        newQueue.splice(insertIndex, 0, newMessage);
        return newQueue;
      });

      return id;
    },
    []
  );

  const dequeue = useCallback((): Message | undefined => {
    let result: Message | undefined;
    setQueue((prev) => {
      if (prev.length === 0) return prev;
      result = prev[0];
      return prev.slice(1);
    });
    return result;
  }, []);

  const peek = useCallback((): Message | undefined => {
    return queue[0];
  }, [queue]);

  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  const remove = useCallback((id: string): boolean => {
    let removed = false;
    setQueue((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      if (index !== -1) {
        removed = true;
        const newQueue = [...prev];
        newQueue.splice(index, 1);
        return newQueue;
      }
      return prev;
    });
    return removed;
  }, []);

  const size = useCallback((): number => {
    return queue.length;
  }, [queue]);

  return (
    <QueuedMessageContext.Provider
      value={{ queue, enqueue, dequeue, peek, clear, remove, size }}
    >
      {children}
    </QueuedMessageContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access queued message functionality
 */
export function useQueuedMessages(): QueuedMessageContextType {
  const context = useContext(QueuedMessageContext);
  if (!context) {
    throw new Error(
      "useQueuedMessages must be used within a QueuedMessageProvider"
    );
  }
  return context;
}
