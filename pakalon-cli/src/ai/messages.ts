import type { CoreMessage } from "ai";

export interface CompactMetadata {
	/** Stable identifier for a compaction event. */
	uuid: string;
	/** Human-readable compaction kind for debugging and analytics. */
	kind?: "summary" | "boundary" | "rewind" | "tombstone";
	/** Marks the compaction envelope boundary. */
	boundary?: "start" | "end";
	/** Message UUID that started the compacted range. */
	startUuid?: string;
	/** Message UUID that ended the compacted range. */
	endUuid?: string;
	/** Optional free-form summary or focus hint. */
	summary?: string;
	/** UTC timestamp for the compaction event. */
	createdAt?: string;
}

export interface UsageMetrics {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	latencyMs?: number;
	model?: string;
	provider?: string;
}

export interface MessageEnvelope extends CoreMessage {
	uuid?: string;
	compactMetadata?: CompactMetadata;
	isCompactSummary?: boolean;
	usage?: UsageMetrics;
}

export interface UserMessageEnvelope extends MessageEnvelope {
	role: "user";
	content: CoreMessage["content"];
	source?: "input" | "tool_result" | "compact_summary";
}

export interface AssistantMessageEnvelope extends MessageEnvelope {
	role: "assistant";
	content: CoreMessage["content"];
	blocks?: Array<{ type: string; [key: string]: unknown }>;
}

export interface SystemMessageEnvelope extends MessageEnvelope {
	role: "system";
	content: string;
	type?: "compact-boundary" | "api-error" | "local-command" | "retry-notification" | "ui-only" | string;
}

export interface AttachmentMessageEnvelope extends MessageEnvelope {
	role: "attachment";
	content: string;
	attachment?: {
		type?: string;
		name?: string;
		path?: string;
		[m: string]: unknown;
	};
}

export interface ProgressMessageEnvelope extends MessageEnvelope {
	role: "progress";
	content: string;
	transient?: true;
}

export interface TombstoneMessageEnvelope extends MessageEnvelope {
	role: "tombstone";
	content?: string;
	targetUuid?: string;
	reason?: string;
}

export type CavemanMessageEnvelope =
	| UserMessageEnvelope
	| AssistantMessageEnvelope
	| SystemMessageEnvelope
	| AttachmentMessageEnvelope
	| ProgressMessageEnvelope
	| TombstoneMessageEnvelope;

export type ApiMessageEnvelope = Exclude<CavemanMessageEnvelope, ProgressMessageEnvelope | TombstoneMessageEnvelope>;

export type CompactBoundaryPosition = "start" | "end";

function hasCompactBoundaryMetadata(message: MessageEnvelope): message is MessageEnvelope & { compactMetadata: CompactMetadata } {
	return message.compactMetadata !== undefined;
}

function isUiOnlySystemMessage(message: MessageEnvelope): boolean {
	if (message.role !== "system") {
		return false;
	}

	const system = message as SystemMessageEnvelope;
	return system.type === "ui-only" || system.type === "ui" || system.type === "transcript-only";
}

function isApiBoundMessage(message: MessageEnvelope): message is ApiMessageEnvelope {
	return message.role !== "progress" && message.role !== "tombstone" && !isUiOnlySystemMessage(message);
}

export function createCompactBoundaryMessage(
	position: CompactBoundaryPosition,
	metadata: CompactMetadata,
	label?: string,
): SystemMessageEnvelope {
	return {
		role: "system",
		content: label ?? `[compact:${position}] ${metadata.uuid}`,
		type: "compact-boundary",
		uuid: `${metadata.uuid}:${position}`,
		compactMetadata: {
			...metadata,
			boundary: position,
			kind: metadata.kind ?? "boundary",
		},
	};
}

export function createCompactBoundaryPair(metadata: CompactMetadata, label?: string): [SystemMessageEnvelope, SystemMessageEnvelope] {
	return [
		createCompactBoundaryMessage("start", metadata, label),
		createCompactBoundaryMessage("end", metadata, label),
	];
}

export function normalizeMessagesForAPI(messages: readonly MessageEnvelope[]): ApiMessageEnvelope[] {
	const normalized: ApiMessageEnvelope[] = [];

	for (const message of messages) {
		if (!isApiBoundMessage(message)) {
			continue;
		}

		if (hasCompactBoundaryMetadata(message)) {
			const [start, end] = createCompactBoundaryPair(message.compactMetadata, message.compactMetadata.summary);
			normalized.push(start);
			normalized.push(message);
			normalized.push(end);
			continue;
		}

		normalized.push(message);
	}

	return normalized;
}

export function isCompactBoundaryMessage(message: MessageEnvelope): boolean {
	return message.role === "system" && (message as SystemMessageEnvelope).type === "compact-boundary";
}

export function isCompactSummaryMessage(message: MessageEnvelope): boolean {
	return Boolean(message.isCompactSummary || message.compactMetadata?.kind === "summary");
}
