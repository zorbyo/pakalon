/**
 * Mailbox Context for pakalon-cli
 *
 * Provides inter-component messaging via a mailbox pattern.
 * Components can send messages to each other without direct coupling.
 */

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export type MailboxMessage<T = unknown> = {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: T;
  timestamp: number;
  read: boolean;
};

type MailboxContextType = {
  /** Send a message to a recipient */
  send: <T>(from: string, to: string, type: string, payload: T) => string;
  /** Receive messages for a specific recipient */
  receive: (to: string) => MailboxMessage[];
  /** Read and mark messages as read */
  read: (to: string) => MailboxMessage[];
  /** Peek at messages without marking as read */
  peek: (to: string) => MailboxMessage[];
  /** Clear all messages for a recipient */
  clear: (to: string) => void;
  /** Get unread message count */
  unreadCount: (to: string) => number;
};

// ============================================================================
// Context
// ============================================================================

const MailboxContext = createContext<MailboxContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

type Props = {
  children: React.ReactNode;
};

export function MailboxProvider({ children }: Props) {
  const messagesRef = useRef<Map<string, MailboxMessage[]>>(new Map());
  const [version, setVersion] = useState(0);

  const forceUpdate = useCallback(() => setVersion((v) => v + 1), []);

  const send = useCallback(
    <T,>(from: string, to: string, type: string, payload: T): string => {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const message: MailboxMessage<T> = {
        id,
        from,
        to,
        type,
        payload,
        timestamp: Date.now(),
        read: false,
      };

      const existing = messagesRef.current.get(to) ?? [];
      messagesRef.current.set(to, [...existing, message]);
      forceUpdate();

      return id;
    },
    [forceUpdate]
  );

  const receive = useCallback((to: string): MailboxMessage[] => {
    const messages = messagesRef.current.get(to) ?? [];
    // Mark all as read
    const updated = messages.map((m) => ({ ...m, read: true }));
    messagesRef.current.set(to, updated);
    return updated;
  }, []);

  const read = useCallback((to: string): MailboxMessage[] => {
    const messages = messagesRef.current.get(to) ?? [];
    const unread = messages.filter((m) => !m.read);
    // Mark all as read
    const updated = messages.map((m) => ({ ...m, read: true }));
    messagesRef.current.set(to, updated);
    return unread;
  }, []);

  const peek = useCallback((to: string): MailboxMessage[] => {
    return messagesRef.current.get(to) ?? [];
  }, []);

  const clear = useCallback((to: string): void => {
    messagesRef.current.delete(to);
    forceUpdate();
  }, [forceUpdate]);

  const unreadCount = useCallback((to: string): number => {
    const messages = messagesRef.current.get(to) ?? [];
    return messages.filter((m) => !m.read).length;
  }, []);

  return (
    <MailboxContext.Provider
      value={{ send, receive, read, peek, clear, unreadCount }}
    >
      {children}
    </MailboxContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access mailbox functionality
 */
export function useMailbox(): MailboxContextType {
  const context = useContext(MailboxContext);
  if (!context) {
    throw new Error("useMailbox must be used within a MailboxProvider");
  }
  return context;
}

/**
 * Hook to subscribe to messages for a specific recipient
 */
export function useMailboxMessages(to: string): MailboxMessage[] {
  const { peek } = useMailbox();
  return peek(to);
}

/**
 * Hook to get unread message count
 */
export function useUnreadCount(to: string): number {
  const { unreadCount } = useMailbox();
  return unreadCount(to);
}
