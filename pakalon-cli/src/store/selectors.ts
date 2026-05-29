import type { AppStore } from "@/store/index.js";

export const selectMcpConnectedServers = (state: AppStore) =>
  Object.entries(state.servers ?? {}).filter(([, server]) => server.status === "connected");

export const selectEnabledPlugins = (state: AppStore) => state.enabled;

export const selectActiveTasks = (state: AppStore) => state.activeTaskIds.map((id) => state.tasks[id]).filter(Boolean);

export const selectUnreadInboxMessages = (state: AppStore) => state.messages.filter((message) => !message.read);

export const selectVisiblePromptSuggestions = (state: AppStore) =>
  state.isVisible ? state.suggestions : [];

export const selectActiveTeammateMembers = (state: AppStore) =>
  state.members.filter((member) => state.activeTeammates.includes(member.id));

export const selectHasConnectionErrors = (state: AppStore) =>
  state.connectionStatus === "error" || Boolean(state.lastConnectionError);
