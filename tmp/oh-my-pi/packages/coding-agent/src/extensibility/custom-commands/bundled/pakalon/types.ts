/**
 * Pakalon extension types.
 *
 * Core types for the 6-phase autonomous build pipeline.
 */

// ============================================================================
// Pipeline State
// ============================================================================

export type PipelineMode = "hil" | "yolo";

export type PipelinePhase =
	| "idle"
	| "planning"
	| "wireframe"
	| "development"
	| "testing"
	| "deployment"
	| "documentation"
	| "complete";

export interface PipelineState {
	mode: PipelinePhase;
	projectName: string;
	currentPhase: number;
	maxPhases: number;
	iterationCount: number;
	maxIterations: number;
	startTime: number;
	initialized: boolean;
	projectPath: string;
	agentDir: string;
}

// ============================================================================
// Phase Results
// ============================================================================

export interface PhaseResult {
	phase: number;
	name: string;
	status: "completed" | "failed" | "skipped";
	files: string[];
	duration: number;
	errors: string[];
}

// ============================================================================
// Phase 1 - Planning
// ============================================================================

export interface PlanningConfig {
	projectName: string;
	description: string;
	techStack: string[];
	requirements: string[];
	constraints: string[];
}

// ============================================================================
// Phase 2 - Wireframe
// ============================================================================

export interface WireframeConfig {
	penpotUrl?: string;
	penpotToken?: string;
	generateSvg: boolean;
	generateJson: boolean;
	generatePenpot: boolean;
}

// ============================================================================
// Phase 3 - Development
// ============================================================================

export interface SubAgentConfig {
	id: string;
	name: string;
	role: string;
	prompt: string;
	files: string[];
}

// ============================================================================
// Phase 4 - Testing
// ============================================================================

export interface SecurityScanConfig {
	sastTools: string[];
	dastTools: string[];
	maxSeverity: "critical" | "high" | "medium" | "low";
}

// ============================================================================
// Phase 5 - Deployment
// ============================================================================

export interface DeploymentConfig {
	provider: "vercel" | "netlify" | "docker" | "github-actions";
	autoDeploy: boolean;
	createPR: boolean;
}

// ============================================================================
// Phase 6 - Documentation
// ============================================================================

export interface DocumentationConfig {
	generateReadme: boolean;
	generateApiDocs: boolean;
	generateChangelog: boolean;
}

// ============================================================================
// Auditor
// ============================================================================

export interface AuditorConfig {
	maxIterations: number;
	mode: PipelineMode;
	requirements: string[];
	tolerance: number;
}

export interface AuditorResult {
	passed: boolean;
	iteration: number;
	issues: AuditorIssue[];
	summary: string;
}

export interface AuditorIssue {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	category: string;
	description: string;
	file?: string;
	line?: number;
	suggestion: string;
}

// ============================================================================
// Penpot
// ============================================================================

export interface PenpotConfig {
	host: string;
	token: string;
	projectId?: string;
	pageId?: string;
}

export interface PenpotPage {
	id: string;
	name: string;
	components: PenpotComponent[];
}

export interface PenpotComponent {
	id: string;
	name: string;
	type: "frame" | "group" | "rectangle" | "text" | "path";
	x: number;
	y: number;
	width: number;
	height: number;
	children?: PenpotComponent[];
}

// ============================================================================
// Telegram
// ============================================================================

export interface TelegramConfig {
	botToken: string;
	chatId: string;
	webhookUrl?: string;
}

export interface TelegramMessage {
	update_id: number;
	message?: {
		message_id: number;
		from: { id: number; first_name: string; username?: string };
		chat: { id: number; type: string };
		text?: string;
		date: number;
	};
}

// ============================================================================
// Memory
// ============================================================================

export interface MemoryConfig {
	backend: "mem0" | "hindsight" | "mnemopi" | "both" | "combined";
	mem0ApiKey?: string;
	mem0BaseUrl?: string;
	hindsightUrl?: string;
	hindsightToken?: string;
	/** Local SQLite db path for the `mnemopi` backend. Default: <cwd>/.pakalon-agents/mnemopi.db */
	mnemopiDbPath?: string;
	bankId?: string;
}

export interface MemoryFact {
	id: string;
	content: string;
	/** Source backend that produced this fact. */
	source?: "mem0" | "hindsight" | "mnemopi" | "combined";
	/** Category or topic label, if categorised. */
	category?: string;
	/** Free-form metadata. Kept loose so any backend can populate. */
	metadata?: Record<string, string | number | boolean>;
	/** ISO 8601 timestamp string (preferred) — the original `createdAt`
	 *  was a number for backward-compat with the original spec. */
	created_at?: string;
	/** Numeric epoch-ms timestamp (legacy). */
	createdAt?: number;
}

// ============================================================================
// Billing
// ============================================================================

export interface BillingConfig {
	provider: "polar";
	polarAccessToken?: string;
	polarBaseUrl?: string;
	platformFeePercent: number;
	depositAmount: number;
}

export interface BillingUsage {
	userId: string;
	totalTokens: number;
	totalCost: number;
	phases: PhaseUsage[];
}

export interface PhaseUsage {
	phase: number;
	tokens: number;
	cost: number;
	duration: number;
}

// ============================================================================
// Auth
// ============================================================================

export interface AuthConfig {
	provider: "supabase";
	supabaseUrl?: string;
	supabaseAnonKey?: string;
	deviceCode?: string;
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
}

// ============================================================================
// RAG
// ============================================================================

export interface RAGConfig {
	firecrawlApiKey?: string;
	firecrawlBaseUrl?: string;
	componentSites: ComponentSite[];
	maxPagesPerSite: number;
	chunkSize: number;
	chunkOverlap: number;
}

export interface ComponentSite {
	name: string;
	url: string;
	type: "component-library" | "docs" | "template";
	scrapeStrategy: "full" | "selective";
}

// ============================================================================
// File Structure
// ============================================================================

export interface AgentFiles {
	agentDir: string;
	phases: {
		[key: number]: {
			dir: string;
			files: string[];
		};
	};
	syncJs: string;
	mcpServers: string;
	wireframes: string;
	db: string;
}

// ============================================================================
// CLI Args
// ============================================================================

export interface PakalonArgs {
	mode: PipelineMode;
	prompt?: string;
	projectName?: string;
	phase?: number;
	maxIterations?: number;
	penpotUrl?: string;
	penpotToken?: string;
	telegramBotToken?: string;
	telegramChatId?: string;
	selfhost?: boolean;
}

// ============================================================================
// Normal Mode
// ============================================================================

export interface NormalModeConfig {
	projectPath: string;
	pakalonDir: string;
	agentsDir: string;
	sessionsDir: string;
}

export interface QAAnswer {
	questionId: string;
	question: string;
	answer: string;
	timestamp: string;
}

export interface QAAnswerStore {
	answers: QAAnswer[];
	projectPath: string;
	createdAt: string;
}

// ============================================================================
// Auth - Clerk Device Code
// ============================================================================

export interface ClerkDeviceCode {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
}

export interface ClerkAuthResult {
	access_token: string;
	refresh_token: string;
	user_id: string;
	email: string;
	plan: "free" | "pro";
	expires_at: number;
}

// ============================================================================
// Billing - Polar.sh
// ============================================================================

export interface PolarCheckoutResult {
	checkout_url: string;
	order_id: string;
}

export interface PolarBalance {
	available: number;
	used: number;
	currency: string;
}

export interface BillingCycle {
	userId: string;
	cycleStart: string;
	cycleEnd: string;
	totalCost: number;
	platformFee: number;
	modelUsage: ModelUsage[];
	status: "active" | "closed" | "paid";
}

export interface ModelUsage {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	inputPrice: number;
	outputPrice: number;
	totalCost: number;
}

// ============================================================================
// Model Layer - OpenRouter
// ============================================================================

export interface OpenRouterModel {
	id: string;
	name: string;
	description: string;
	pricing: {
		prompt: string;
		completion: string;
	};
	context_length: number;
	is_free: boolean;
	created_at: string;
}

export interface ModelCatalog {
	models: OpenRouterModel[];
	lastRefreshed: string;
}

// ============================================================================
// Agent Skills - Vercel
// ============================================================================

export interface AgentSkill {
	name: string;
	description: string;
	source: string;
	relevance: number;
	rationale: string;
	tags: string[];
}

// ============================================================================
// Registry RAG
// ============================================================================

export interface RegistryEntry {
	id: string;
	description: string;
	tags: string[];
	source: string;
	snippet: string;
	install: string;
}

// ============================================================================
// File Recorder (for /undo)
// ============================================================================

export interface FileChange {
	path: string;
	action: "create" | "modify" | "delete";
	timestamp: string;
	content?: string;
	previousContent?: string;
}

// ============================================================================
// Session Store
// ============================================================================

export interface SessionHistory {
	sessionId: string;
	projectPath: string;
	events: SessionEvent[];
	createdAt: string;
	updatedAt: string;
}

export interface SessionEvent {
	type: "prompt" | "tool_call" | "file_edit" | "assistant_response";
	content: string;
	timestamp: string;
	tokens_in?: number;
	tokens_out?: number;
	duration_ms?: number;
}
