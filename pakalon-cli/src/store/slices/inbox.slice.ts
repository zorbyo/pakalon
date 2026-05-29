import type { StateCreator } from "zustand";

export interface InboxMessage {
  id: string;
  type: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  action?: string;
}

export interface InboxState {
  messages: InboxMessage[];
  unreadCount: number;
  maxMessages: number;
  addMessage: (
    message: Omit<InboxMessage, "id" | "timestamp" | "read"> & Partial<Pick<InboxMessage, "id" | "timestamp" | "read">>,
  ) => string;
  markRead: (messageId: string) => void;
  markAllRead: () => void;
  clearMessages: () => void;
  removeMessage: (messageId: string) => void;
}

function getUnreadCount(messages: InboxMessage[]): number {
  return messages.filter((message) => !message.read).length;
}

export const createInboxSlice: StateCreator<InboxState> = (set) => ({
  messages: [],
  unreadCount: 0,
  maxMessages: 100,

  addMessage: (message) => {
    const id = message.id ?? crypto.randomUUID();
    const nextMessage: InboxMessage = {
      id,
      type: message.type,
      title: message.title,
      body: message.body,
      timestamp: message.timestamp ?? Date.now(),
      read: message.read ?? false,
      action: message.action,
    };
    set((state) => {
      const messages = [...state.messages, nextMessage].slice(-state.maxMessages);
      return { messages, unreadCount: getUnreadCount(messages) };
    });
    return id;
  },

  markRead: (messageId) =>
    set((state) => {
      const messages = state.messages.map((message) =>
        message.id === messageId ? { ...message, read: true } : message,
      );
      return { messages, unreadCount: getUnreadCount(messages) };
    }),

  markAllRead: () =>
    set((state) => {
      const messages = state.messages.map((message) => ({ ...message, read: true }));
      return { messages, unreadCount: 0 };
    }),

  clearMessages: () => set({ messages: [], unreadCount: 0 }),

  removeMessage: (messageId) =>
    set((state) => {
      const messages = state.messages.filter((message) => message.id !== messageId);
      return { messages, unreadCount: getUnreadCount(messages) };
    }),
});
