import { z } from "zod";

export type AuditSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AuditStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface AuditFinding {
	id: string;
	rule: string;
	severity: AuditSeverity;
	message: string;
	file?: string;
	line?: number;
	recommendation?: string;
}

export interface AuditReport {
	generatedAt: string;
	status: AuditStatus;
	findings: AuditFinding[];
	complete: number;
	partial: number;
	missing: number;
	buckets: AuditBucket[];
	recommendedNext: "do-nothing" | "implement-core" | "implement-all";
}

export interface AuditBucket {
	name: string;
	status: "complete" | "partial" | "missing";
	findings: AuditFinding[];
}

export const AuditFindingSchema = z.object({
	id: z.string(),
	rule: z.string(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	message: z.string(),
	file: z.string().optional(),
	line: z.number().optional(),
	recommendation: z.string().optional(),
});

export const AuditReportSchema = z.object({
	generatedAt: z.string(),
	status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
	findings: z.array(AuditFindingSchema),
	complete: z.number(),
	partial: z.number(),
	missing: z.number(),
	recommendedNext: z.enum(["do-nothing", "implement-core", "implement-all"]),
});
