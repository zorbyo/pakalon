import { z } from "zod";

export interface ScrapeResult {
	url: string;
	title: string;
	content: string;
	markdown: string;
	metadata: Record<string, unknown>;
	fetchedAt: string;
}

export interface ScrapeOptions {
	url: string;
	format?: "markdown" | "text" | "html";
	maxLength?: number;
	timeout?: number;
}

export const ScrapeOptionsSchema = z.object({
	url: z.string().url(),
	format: z.enum(["markdown", "text", "html"]).optional(),
	maxLength: z.number().optional(),
	timeout: z.number().optional(),
});
