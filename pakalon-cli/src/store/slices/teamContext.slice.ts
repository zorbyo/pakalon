import type { StateCreator } from "zustand";

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface TeamContextState {
  teamId: string | null;
  teamName: string | null;
  members: TeamMember[];
  activeTeammates: string[];
  contextSyncEnabled: boolean;
  lastSyncTimestamp: number | null;
  setTeam: (teamId: string | null, teamName: string | null, members?: TeamMember[]) => void;
  addMember: (member: TeamMember) => void;
  removeMember: (memberId: string) => void;
  setTeammateStatus: (memberId: string, status: string) => void;
  setSyncEnabled: (enabled: boolean) => void;
}

function syncActiveTeammates(members: TeamMember[]): string[] {
  return members.filter((member) => member.status === "active").map((member) => member.id);
}

export const createTeamContextSlice: StateCreator<TeamContextState> = (set) => ({
  teamId: null,
  teamName: null,
  members: [],
  activeTeammates: [],
  contextSyncEnabled: false,
  lastSyncTimestamp: null,

  setTeam: (teamId, teamName, members = []) =>
    set({
      teamId,
      teamName,
      members,
      activeTeammates: syncActiveTeammates(members),
      lastSyncTimestamp: Date.now(),
    }),

  addMember: (member) =>
    set((state) => {
      const members = [...state.members.filter((item) => item.id !== member.id), member];
      return {
        members,
        activeTeammates: syncActiveTeammates(members),
        lastSyncTimestamp: Date.now(),
      };
    }),

  removeMember: (memberId) =>
    set((state) => {
      const members = state.members.filter((member) => member.id !== memberId);
      return {
        members,
        activeTeammates: syncActiveTeammates(members),
        lastSyncTimestamp: Date.now(),
      };
    }),

  setTeammateStatus: (memberId, status) =>
    set((state) => {
      const members = state.members.map((member) =>
        member.id === memberId ? { ...member, status } : member,
      );
      return {
        members,
        activeTeammates: syncActiveTeammates(members),
        lastSyncTimestamp: Date.now(),
      };
    }),

  setSyncEnabled: (enabled) => set({ contextSyncEnabled: enabled, lastSyncTimestamp: Date.now() }),
});
