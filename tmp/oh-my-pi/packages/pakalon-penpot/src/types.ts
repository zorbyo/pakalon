import { z } from "zod";

export interface PenpotShape {
	id: string;
	type: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	fill?: string;
	stroke?: string;
	children?: PenpotShape[];
}

export interface PenpotPage {
	name: string;
	width: number;
	height: number;
	shapes: PenpotShape[];
}

export interface PenpotFile {
	version: number;
	generator: string;
	pages: PenpotPage[];
}

export const PenpotShapeSchema = z.object({
	id: z.string(),
	type: z.string(),
	name: z.string(),
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	fill: z.string().optional(),
	stroke: z.string().optional(),
	children: z.lazy(() => PenpotShapeSchema.array()).optional(),
});

export const PenpotPageSchema = z.object({
	name: z.string(),
	width: z.number(),
	height: z.number(),
	shapes: z.array(PenpotShapeSchema),
});

export const PenpotFileSchema = z.object({
	version: z.number(),
	generator: z.string(),
	pages: z.array(PenpotPageSchema),
});
