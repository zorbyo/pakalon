import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { LIST_PEERS_TOOL_NAME } from "./constants.js";
import { getListPeersToolPrompt, getListPeersToolDescription } from "./prompt.js";
import { discoverPeers } from "@/peers/discovery.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		includeInactive: z.boolean().optional().default(false).describe("Include recently disconnected peers"),
		filter: z.enum(["local", "remote", "all"]).optional().default("all").describe("Filter by peer type"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type ListPeersInput = z.infer<InputSchema>;

interface PeerInfo {
	id: string;
	type: "local" | "remote";
	status: "connected" | "idle" | "disconnected";
	name?: string;
	lastSeen?: string;
	socketPath?: string;
	sessionId?: string;
}

interface ListPeersOutput {
	success: boolean;
	peers: PeerInfo[];
	total: number;
	connected: number;
	filter: string;
}

export const ListPeersTool = buildTool({
	name: LIST_PEERS_TOOL_NAME,
	searchHint: "list connected peers sessions uds bridge",
	maxResultSizeChars: 50_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<ListPeersInput>): Promise<string> {
		return getListPeersToolDescription(input as ListPeersInput);
	},

	async prompt(): Promise<string> {
		return getListPeersToolPrompt();
	},

	userFacingName(): string {
		return "List Peers";
	},

	isConcurrencySafe(): boolean {
		return true;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return true;
	},

	toAutoClassifierInput(input: ListPeersInput): string {
		return `list peers ${input.filter}`;
	},

	renderToolUseMessage(input: Partial<ListPeersInput>): string {
		const filter = input.filter ?? "all";
		return `Listing peers (${filter})`;
	},

	async call(input: ListPeersInput, context: { getAppState: () => Record<string, unknown> }): Promise<ToolResult<ListPeersOutput>> {
		const { includeInactive, filter } = input;
		const appState = context.getAppState();

		const peers: PeerInfo[] = [];

		const peerRegistry = appState.peerRegistry as Record<string, PeerInfo> | undefined;
		if (peerRegistry) {
			for (const [id, peer] of Object.entries(peerRegistry)) {
				if (filter !== "all" && peer.type !== filter) continue;
				if (!includeInactive && peer.status === "disconnected") continue;
				peers.push({ ...peer, id });
			}
		}

		if (peers.length === 0) {
			peers.push(
				...discoverPeers(process.cwd(), { includeInactive, filter }).map((peer) => ({
					id: peer.id,
					type: peer.type,
					status: peer.status,
					name: peer.name,
					lastSeen: peer.lastSeen,
					socketPath: peer.socketPath,
					sessionId: peer.sessionId,
				})),
			);
		}

		const connected = peers.filter(p => p.status === "connected").length;

		return {
			data: {
				success: true,
				peers,
				total: peers.length,
				connected,
				filter,
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: ListPeersOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<total>${data.total}</total>`);
		parts.push(`<connected>${data.connected}</connected>`);
		parts.push(`<filter>${data.filter}</filter>`);

		if (data.peers.length > 0) {
			parts.push(`<peers count="${data.peers.length}">`);
			for (const peer of data.peers) {
				parts.push(`  <peer>`);
				parts.push(`    <id>${peer.id}</id>`);
				parts.push(`    <type>${peer.type}</type>`);
				parts.push(`    <status>${peer.status}</status>`);
				if (peer.name) parts.push(`    <name>${peer.name}</name>`);
				if (peer.lastSeen) parts.push(`    <last_seen>${peer.lastSeen}</last_seen>`);
				if (peer.socketPath) parts.push(`    <socket_path>${peer.socketPath}</socket_path>`);
				if (peer.sessionId) parts.push(`    <session_id>${peer.sessionId}</session_id>`);
				parts.push(`  </peer>`);
			}
			parts.push(`</peers>`);
		} else {
			parts.push(`<peers count="0">No peers found.</peers>`);
		}

		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join("\n"),
		};
	},

	async checkPermissions(): Promise<{ behavior: "allow" }> {
		return { behavior: "allow" };
	},
} satisfies ToolDef<InputSchema, ListPeersOutput>);

export default ListPeersTool;
