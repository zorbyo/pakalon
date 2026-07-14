export type PhaseId = "idle" | "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6" | "completed";
export type Mode = "HIL" | "YOLO";
export type PhaseStatus =
	| "pending"
	| "running"
	| "awaiting_approval"
	| "approved"
	| "rejected"
	| "completed"
	| "failed"
	| "skipped";

export interface PhaseState {
	status: PhaseStatus;
	startedAt?: string;
	completedAt?: string;
	approvalRequestedAt?: string;
	approvalResponseAt?: string;
	rejectionReason?: string;
	error?: string;
	tokensUsed: number;
	filesModified: string[];
}

export interface ProjectState {
	phase: PhaseId;
	mode: Mode;
	projectDir: string;
	contextBudget: number;
	phaseStartTime?: string;
	phaseEndTime?: string;
	approvals: Record<string, boolean>;
	phases: Record<PhaseId, PhaseState>;
	rollbackHistory: RollbackPoint[];
	version: number;
}

export interface RollbackPoint {
	phase: PhaseId;
	timestamp: string;
	stateSnapshot: string;
	description: string;
}

export interface Phase1Input {
	prompt: string;
	mode: Mode;
	techStack?: string;
	existingProject?: boolean;
	languages?: string[];
	frameworks?: string[];
	contextBudgetPct?: number;
	enableResearch?: boolean;
}

export interface Phase1Output {
	plan: string;
	tasks: string;
	userStories: string;
	design: string;
	contextManagement: string;
	apiReference: string;
	databaseSchema: string;
	phase1Doc: string;
	prd: string;
	riskAssessment: string;
	technicalSpec: string;
	competitiveAnalysis: string;
	constraints: string;
	agentSkills: string;
}

export interface Phase2Input {
	projectDir: string;
	pages?: string[];
	designSystem?: Record<string, unknown>;
	tddEnabled?: boolean;
	tddMaxAttempts?: number;
	regenerateOnMismatch?: boolean;
	figmaSource?: string;
}

export interface Phase2Output {
	wireframeSvg: string;
	wireframeJson: string;
	penpotSpec: string;
	summary: string;
	tddAttempts: number;
	tddPassed: boolean;
	figmaImported: boolean;
}

export interface Phase3Input {
	projectDir: string;
	frontendTasks?: string[];
	backendTasks?: string[];
	integrationTasks?: string[];
	mode?: Mode;
}

export interface Phase3Output {
	frontendReport: string;
	backendReport: string;
	integrationReport: string;
	debugReport: string;
	reviewReport: string;
	executionLog: string;
	auditorReport: string;
}

export interface Phase4Input {
	projectDir: string;
	enableSast: boolean;
	enableDast: boolean;
	enableCodeReview: boolean;
	devServerTarget?: string;
	runTools?: boolean;
	autoRemediate?: boolean;
	maxRemediationIterations?: number;
	remediationMode?: Mode;
	mode?: Mode;
	userOverrideProceed?: boolean;
}

export interface Phase4Output {
	sastReport: string;
	dastReport: string;
	codeReviewReport: string;
	cicdReport: string;
	securityReport: string;
	whiteboxTesting: string;
	blackboxTesting: string;
	remediationIterations?: number;
}

export interface Phase5Input {
	projectDir: string;
	githubRepo?: string;
	deployTarget?: "aws" | "digitalocean" | "azure" | "gcp" | "none";
	createRepo?: boolean;
	repoVisibility?: "public" | "private";
}

export interface Phase5Output {
	githubCreated: boolean;
	prCreated: boolean;
	repoUrl: string;
	ciCdPipeline: string;
	deploymentGuide: string;
	phase5Doc: string;
}

export interface Phase6Input {
	projectDir: string;
}

export interface Phase6Output {
	docMd: string;
	phase6Doc: string;
	readmeUpdated: string;
}

export type AskQuestionFn = (question: string) => Promise<string>;

export interface QASession {
	prompt: string;
	mode: Mode;
	answers: Array<{ question: string; answer: string; label?: string; description?: string }>;
	endedAt?: string;
}

export const PHASES_ORDER: PhaseId[] = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];

export const PHASE_NAMES: Record<PhaseId, string> = {
	idle: "Idle",
	"phase-1": "Planning & Requirements",
	"phase-2": "Wireframes",
	"phase-3": "Development",
	"phase-4": "Testing & QA",
	"phase-5": "Deployment",
	"phase-6": "Documentation",
	completed: "Completed",
};

export const PHASE_TOKEN_ALLOCATIONS: Record<PhaseId, number> = {
	idle: 0,
	"phase-1": 25600,
	"phase-2": 19200,
	"phase-3": 38400,
	"phase-4": 19200,
	"phase-5": 6400,
	"phase-6": 6400,
	completed: 0,
};
