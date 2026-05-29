/**
 * Team Tools - Multi-Agent Swarm Coordination for Pakalon CLI
 * 
 * Implements team creation, deletion, and inter-agent messaging
 * for multi-agent swarm orchestration.
 * 
 * Features:
 * - TeamCreateTool: Create new agent teams with configurable lead
 * - TeamDeleteTool: Clean up teams and resources
 * - SendMessageTool: Inter-agent communication within teams
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model?: string;
  joinedAt: number;
  tmuxPaneId?: string;
  cwd?: string;
  isActive?: boolean;
  subscriptions?: string[];
}

export interface TeamFile {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: TeamMember[];
}

export interface TeamContext {
  teamName: string;
  teamFilePath: string;
  leadAgentId: string;
  teammates: Record<string, TeammateInfo>;
}

export interface TeammateInfo {
  name: string;
  agentType: string;
  color: string;
  tmuxSessionName?: string;
  tmuxPaneId?: string;
  cwd?: string;
  spawnedAt: number;
}

export interface InboxMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  timestamp: number;
  messageType: "request" | "response" | "broadcast" | "status";
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_LEAD_NAME = "team-lead";
const TEAMS_DIR_NAME = ".pakalon-teams";

// Colors for teammate visualization
const TEAMMATE_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#96CEB4", // Green
  "#FFEAA7", // Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Gold
  "#BB8FCE", // Purple
  "#85C1E9", // Sky
];

let colorIndex = 0;
const assignedColors: Map<string, string> = new Map();

// ---------------------------------------------------------------------------
// Directory & File Helpers
// ---------------------------------------------------------------------------

function getTeamsDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, TEAMS_DIR_NAME);
}

function ensureTeamsDir(): void {
  const teamsDir = getTeamsDir();
  if (!fs.existsSync(teamsDir)) {
    fs.mkdirSync(teamsDir, { recursive: true });
  }
}

export function getTeamFilePath(teamName: string): string {
  return path.join(getTeamsDir(), `${sanitizeName(teamName)}.json`);
}

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Team File Operations
// ---------------------------------------------------------------------------

export function readTeamFile(teamName: string): TeamFile | null {
  const filePath = getTeamFilePath(teamName);
  if (!fs.existsSync(filePath)) return null;
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as TeamFile;
  } catch (error) {
    logger.error(`[team] Failed to read team file: ${error}`);
    return null;
  }
}

export async function writeTeamFile(teamName: string, teamFile: TeamFile): Promise<void> {
  ensureTeamsDir();
  const filePath = getTeamFilePath(teamName);
  
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(teamFile, null, 2), "utf-8");
  } catch (error) {
    logger.error(`[team] Failed to write team file: ${error}`);
    throw error;
  }
}

export async function deleteTeamFile(teamName: string): Promise<void> {
  const filePath = getTeamFilePath(teamName);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

// ---------------------------------------------------------------------------
// Team Cleanup Registry
// ---------------------------------------------------------------------------

const teamsToCleanup: Set<string> = new Set();

export function registerTeamForSessionCleanup(teamName: string): void {
  teamsToCleanup.add(teamName);
}

export function unregisterTeamForSessionCleanup(teamName: string): void {
  teamsToCleanup.delete(teamName);
}

export async function cleanupAllTeams(): Promise<void> {
  for (const teamName of teamsToCleanup) {
    try {
      await cleanupTeamDirectories(teamName);
    } catch (error) {
      logger.error(`[team] Failed to cleanup team ${teamName}: ${error}`);
    }
  }
  teamsToCleanup.clear();
}

export async function cleanupTeamDirectories(teamName: string): Promise<void> {
  // Delete team file
  await deleteTeamFile(teamName);
  
  // Clear color assignments for this team
  clearTeammateColors();
  
  logger.info(`[team] Cleaned up team: ${teamName}`);
}

// ---------------------------------------------------------------------------
// Color Assignment
// ---------------------------------------------------------------------------

export function assignTeammateColor(agentId: string): string {
  if (assignedColors.has(agentId)) {
    return assignedColors.get(agentId)!;
  }
  
  const color = TEAMMATE_COLORS[colorIndex % TEAMMATE_COLORS.length] ?? TEAMMATE_COLORS[0]!;
  colorIndex++;
  assignedColors.set(agentId, color);
  return color;
}

export function clearTeammateColors(): void {
  assignedColors.clear();
  colorIndex = 0;
}

// ---------------------------------------------------------------------------
// Agent ID Helpers
// ---------------------------------------------------------------------------

export function formatAgentId(name: string, teamName: string): string {
  return `${sanitizeName(name)}@${sanitizeName(teamName)}`;
}

export function parseAgentId(agentId: string): { name: string; teamName: string } | null {
  const parts = agentId.split("@");
  if (parts.length !== 2) return null;
  return { name: parts[0]!, teamName: parts[1]! };
}

// ---------------------------------------------------------------------------
// Word Slug Generator (for unique team names)
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "swift", "brave", "calm", "dark", "eager", "fair", "glad", "happy",
  "keen", "loud", "mild", "noble", "odd", "proud", "quick", "rare",
  "safe", "tall", "vast", "warm", "young", "bold", "cool", "deep",
];

const NOUNS = [
  "falcon", "tiger", "wolf", "eagle", "bear", "lion", "hawk", "fox",
  "owl", "raven", "shark", "whale", "dragon", "phoenix", "griffin",
  "storm", "river", "mountain", "forest", "ocean", "thunder", "flame",
];

export function generateWordSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}

// ---------------------------------------------------------------------------
// TeamCreateTool
// ---------------------------------------------------------------------------

export const teamCreateSchema = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe("Type/role of the team lead"),
});

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

export interface TeamCreateOutput {
  team_name: string;
  team_file_path: string;
  lead_agent_id: string;
}

function generateUniqueTeamName(providedName: string): string {
  if (!readTeamFile(providedName)) {
    return providedName;
  }
  return generateWordSlug();
}

export async function createTeam(
  input: TeamCreateInput,
  context: {
    sessionId: string;
    cwd: string;
    model?: string;
    existingTeamName?: string;
  }
): Promise<TeamCreateOutput> {
  const { team_name, description, agent_type } = input;
  const { sessionId, cwd, model, existingTeamName } = context;

  // Check if already in a team
  if (existingTeamName) {
    throw new Error(
      `Already leading team "${existingTeamName}". A leader can only manage one team at a time. Use TeamDelete first.`
    );
  }

  // Generate unique team name if needed
  const finalTeamName = generateUniqueTeamName(team_name);
  
  // Generate agent ID for team lead
  const leadAgentId = formatAgentId(TEAM_LEAD_NAME, finalTeamName);
  const leadAgentType = agent_type || TEAM_LEAD_NAME;

  const teamFilePath = getTeamFilePath(finalTeamName);

  const teamFile: TeamFile = {
    name: finalTeamName,
    description,
    createdAt: Date.now(),
    leadAgentId,
    leadSessionId: sessionId,
    members: [
      {
        agentId: leadAgentId,
        name: TEAM_LEAD_NAME,
        agentType: leadAgentType,
        model,
        joinedAt: Date.now(),
        cwd,
        subscriptions: [],
      },
    ],
  };

  await writeTeamFile(finalTeamName, teamFile);
  registerTeamForSessionCleanup(finalTeamName);

  logger.info(`[team] Created team: ${finalTeamName}`);

  return {
    team_name: finalTeamName,
    team_file_path: teamFilePath,
    lead_agent_id: leadAgentId,
  };
}

export const teamCreateToolDefinition = {
  name: "team_create",
  description: "Create a new multi-agent team for coordinating parallel work",
  inputSchema: teamCreateSchema,
  
  async execute(
    input: TeamCreateInput,
    context: {
      sessionId: string;
      cwd: string;
      model?: string;
      existingTeamName?: string;
    }
  ): Promise<TeamCreateOutput> {
    return createTeam(input, context);
  },
};

// ---------------------------------------------------------------------------
// TeamDeleteTool
// ---------------------------------------------------------------------------

export const teamDeleteSchema = z.object({
  force: z.boolean().optional().describe("Force deletion even with active members"),
});

export type TeamDeleteInput = z.infer<typeof teamDeleteSchema>;

export interface TeamDeleteOutput {
  success: boolean;
  message: string;
  team_name?: string;
}

export async function deleteTeam(
  input: TeamDeleteInput,
  context: {
    teamName?: string;
  }
): Promise<TeamDeleteOutput> {
  const { force = false } = input;
  const { teamName } = context;

  if (!teamName) {
    return {
      success: true,
      message: "No team name found, nothing to clean up",
    };
  }

  // Read team config
  const teamFile = readTeamFile(teamName);
  if (teamFile) {
    // Check for active members (not team lead)
    const nonLeadMembers = teamFile.members.filter(m => m.name !== TEAM_LEAD_NAME);
    const activeMembers = nonLeadMembers.filter(m => m.isActive !== false);

    if (activeMembers.length > 0 && !force) {
      const memberNames = activeMembers.map(m => m.name).join(", ");
      return {
        success: false,
        message: `Cannot cleanup team with ${activeMembers.length} active member(s): ${memberNames}. Use force: true or terminate teammates first.`,
        team_name: teamName,
      };
    }
  }

  // Cleanup
  await cleanupTeamDirectories(teamName);
  unregisterTeamForSessionCleanup(teamName);

  logger.info(`[team] Deleted team: ${teamName}`);

  return {
    success: true,
    message: `Cleaned up team "${teamName}"`,
    team_name: teamName,
  };
}

export const teamDeleteToolDefinition = {
  name: "team_delete",
  description: "Clean up and disband a team, removing all resources",
  inputSchema: teamDeleteSchema,
  
  async execute(
    input: TeamDeleteInput,
    context: { teamName?: string }
  ): Promise<TeamDeleteOutput> {
    return deleteTeam(input, context);
  },
};

// ---------------------------------------------------------------------------
// SendMessageTool
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  to_agent: z.string().describe("Target agent ID to send message to"),
  content: z.string().describe("Message content to send"),
  message_type: z.enum(["request", "response", "broadcast", "status"])
    .optional()
    .default("request")
    .describe("Type of message"),
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export interface SendMessageOutput {
  success: boolean;
  message_id: string;
  delivered_at: number;
}

// In-memory inbox storage (would be file-based or Redis in production)
const inboxes: Map<string, InboxMessage[]> = new Map();

function getInbox(agentId: string): InboxMessage[] {
  if (!inboxes.has(agentId)) {
    inboxes.set(agentId, []);
  }
  return inboxes.get(agentId)!;
}

export function readInbox(agentId: string, since?: number): InboxMessage[] {
  const inbox = getInbox(agentId);
  if (since) {
    return inbox.filter(m => m.timestamp > since);
  }
  return inbox;
}

export function clearInbox(agentId: string): void {
  inboxes.set(agentId, []);
}

export async function sendMessage(
  input: SendMessageInput,
  context: {
    fromAgentId: string;
    teamName?: string;
  }
): Promise<SendMessageOutput> {
  const { to_agent, content, message_type = "request", metadata } = input;
  const { fromAgentId, teamName } = context;

  // Validate target agent exists in team
  if (teamName) {
    const teamFile = readTeamFile(teamName);
    if (teamFile) {
      const targetMember = teamFile.members.find(m => m.agentId === to_agent);
      if (!targetMember) {
        throw new Error(`Agent ${to_agent} not found in team ${teamName}`);
      }
    }
  }

  // Create message
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message: InboxMessage = {
    id: messageId,
    fromAgentId,
    toAgentId: to_agent,
    content,
    timestamp: Date.now(),
    messageType: message_type,
    metadata,
  };

  // Deliver to inbox
  const inbox = getInbox(to_agent);
  inbox.push(message);

  logger.debug(`[team] Message sent: ${fromAgentId} -> ${to_agent}`);

  return {
    success: true,
    message_id: messageId,
    delivered_at: message.timestamp,
  };
}

export const sendMessageToolDefinition = {
  name: "send_message",
  description: "Send a message to another agent in the team",
  inputSchema: sendMessageSchema,
  
  async execute(
    input: SendMessageInput,
    context: { fromAgentId: string; teamName?: string }
  ): Promise<SendMessageOutput> {
    return sendMessage(input, context);
  },
};

// ---------------------------------------------------------------------------
// Additional Team Operations
// ---------------------------------------------------------------------------

export async function addTeamMember(
  teamName: string,
  member: Omit<TeamMember, "joinedAt">
): Promise<void> {
  const teamFile = readTeamFile(teamName);
  if (!teamFile) {
    throw new Error(`Team ${teamName} not found`);
  }

  // Check if member already exists
  const existing = teamFile.members.find(m => m.agentId === member.agentId);
  if (existing) {
    throw new Error(`Agent ${member.agentId} already in team`);
  }

  teamFile.members.push({
    ...member,
    joinedAt: Date.now(),
  });

  await writeTeamFile(teamName, teamFile);
  logger.info(`[team] Added member ${member.agentId} to team ${teamName}`);
}

export async function removeTeamMember(teamName: string, agentId: string): Promise<void> {
  const teamFile = readTeamFile(teamName);
  if (!teamFile) {
    throw new Error(`Team ${teamName} not found`);
  }

  const memberIndex = teamFile.members.findIndex(m => m.agentId === agentId);
  if (memberIndex === -1) {
    throw new Error(`Agent ${agentId} not found in team`);
  }

  // Cannot remove team lead
  if (teamFile.members[memberIndex]!.name === TEAM_LEAD_NAME) {
    throw new Error("Cannot remove team lead");
  }

  teamFile.members.splice(memberIndex, 1);
  await writeTeamFile(teamName, teamFile);
  
  logger.info(`[team] Removed member ${agentId} from team ${teamName}`);
}

export async function updateMemberStatus(
  teamName: string,
  agentId: string,
  isActive: boolean
): Promise<void> {
  const teamFile = readTeamFile(teamName);
  if (!teamFile) {
    throw new Error(`Team ${teamName} not found`);
  }

  const member = teamFile.members.find(m => m.agentId === agentId);
  if (!member) {
    throw new Error(`Agent ${agentId} not found in team`);
  }

  member.isActive = isActive;
  await writeTeamFile(teamName, teamFile);
}

export function listTeams(): string[] {
  const teamsDir = getTeamsDir();
  if (!fs.existsSync(teamsDir)) return [];
  
  return fs.readdirSync(teamsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
}

export function getTeamMembers(teamName: string): TeamMember[] {
  const teamFile = readTeamFile(teamName);
  return teamFile?.members ?? [];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  // Team Create
  teamCreateSchema,
  teamCreateToolDefinition,
  createTeam,
  
  // Team Delete
  teamDeleteSchema,
  teamDeleteToolDefinition,
  deleteTeam,
  
  // Send Message
  sendMessageSchema,
  sendMessageToolDefinition,
  sendMessage,
  readInbox,
  clearInbox,
  
  // Team Operations
  readTeamFile,
  writeTeamFile,
  deleteTeamFile,
  addTeamMember,
  removeTeamMember,
  updateMemberStatus,
  listTeams,
  getTeamMembers,
  
  // Cleanup
  registerTeamForSessionCleanup,
  unregisterTeamForSessionCleanup,
  cleanupAllTeams,
  cleanupTeamDirectories,
  
  // Helpers
  formatAgentId,
  parseAgentId,
  sanitizeName,
  assignTeammateColor,
  clearTeammateColors,
  generateWordSlug,
};
