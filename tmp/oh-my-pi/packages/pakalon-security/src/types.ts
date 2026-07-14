import { z } from "zod";

export type ScanKind = "sast" | "dast" | "code-review" | "cicd" | "pentest";
export type ScanSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ScanStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ScanResult {
	id: string;
	kind: ScanKind;
	tool: string;
	status: ScanStatus;
	severity: ScanSeverity;
	message: string;
	file?: string;
	line?: number;
	recommendation?: string;
	raw: Record<string, unknown>;
}

export const ScanResultSchema = z.object({
	id: z.string(),
	kind: z.enum(["sast", "dast", "code-review", "cicd", "pentest"]),
	tool: z.string(),
	status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	message: z.string(),
	file: z.string().optional(),
	line: z.number().optional(),
	recommendation: z.string().optional(),
	raw: z.record(z.string(), z.unknown()),
});
