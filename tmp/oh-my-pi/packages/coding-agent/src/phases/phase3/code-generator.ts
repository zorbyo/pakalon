/**
 * Phase 3 Code Generator — real file creation engine.
 *
 * Transforms Phase 1/2 artifacts (plan, tasks, design, wireframe) into
 * actual source files, installed dependencies, and verified builds.
 *
 * Unlike the old report-first approach, this module makes code generation
 * the primary output: the LLM produces a structured file envelope directly,
 * then the generator handles scaffolding, package install, and build
 * verification — all tracked via git diff for evidence capture.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { PhaseLLMOptions } from "../../pakalon/llm/invoker";
import { invokePhaseLLMJson } from "../../pakalon/llm/invoker";
import type { RegistryHit } from "../../pakalon/registry-rag/search";
import { searchRegistry } from "../../pakalon/registry-rag/search";
import { collectChanges } from "./executor";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single file to create or modify in the project. */
export interface CodegenFile {
	/** Relative path from project root (e.g. "src/app/page.tsx"). */
	path: string;
	/** File content as a UTF-8 string. */
	content: string;
	/** Write mode: replace entire file, edit in-place, or append. */
	op: "write" | "edit" | "append";
}

/** Result of a single code generation pass. */
export interface CodegenResult {
	filesCreated: string[];
	filesModified: string[];
	filesSkipped: string[];
	packagesInstalled: string[];
	installErrors: string[];
	buildOutput: string;
	buildSuccess: boolean;
	errors: string[];
}

/** Stack features detected from plan/design/wireframe. */
export interface StackNeeds {
	tailwind: boolean;
	shadcn: boolean;
	radix: boolean;
	next: boolean;
	vite: boolean;
	electron: boolean;
}

/** Full project specification derived from Phase 1 & 2 artifacts. */
export interface ProjectSpec {
	plan: string;
	tasks: string;
	design: string;
	wireframe: unknown;
	apiRef: string;
	dbSchema: string;
	stackNeeds: StackNeeds;
}

/** System prompt sent to the LLM for code generation. */
const CODEGEN_SYSTEM_PROMPT = `You are an expert full-stack code generator. Your job is to produce a complete, working project based on the specification below.

Respond with a JSON object containing:

{
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "file contents as a string",
      "op": "write" | "edit" | "append"
    }
  ],
  "packages": ["dependency-name@version", ...],
  "buildCommand": "command to run after file creation"
}

Rules:
- Use "write" for new files or full replacements.
- Use "edit" only when modifying an existing file that was created in the same pass.
- Use "append" when adding content to the end of an existing file.
- All paths are relative to the project root.
- Include ALL necessary files: configs, source code, styles, types, tests.
- The project must be complete and buildable after your files are written.
- Default to TypeScript with proper type definitions.
- If the spec mentions a framework (Next.js, Vite, Express, FastAPI, etc.), scaffold accordingly.
- Return an empty "packages" array if no additional packages are needed beyond what's already scaffolded.
- Return "buildCommand": null if no build step is needed.`;

// ─────────────────────────────────────────────────────────────────────────────
// LLM call
// ─────────────────────────────────────────────────────────────────────────────

interface LLMFileEnvelope {
	files: Array<{ path: string; content: string; op: "write" | "edit" | "append" }>;
	packages: string[];
	buildCommand: string | null;
}

/**
 * Build a query string from the spec for registry search.
 * Extracts keywords from plan, design, and stack needs.
 */
function buildRegistryQuery(spec: ProjectSpec): string {
	const parts: string[] = [];
	// Take first 200 chars of plan (the headline)
	const planHeadline = spec.plan
		.replace(/[#*_`\n]+/g, " ")
		.trim()
		.slice(0, 200);
	if (planHeadline) parts.push(planHeadline);
	// Take first 200 chars of design
	const designHeadline = spec.design
		.replace(/[#*_`\n]+/g, " ")
		.trim()
		.slice(0, 200);
	if (designHeadline) parts.push(designHeadline);
	// Add stack tags
	const stack = spec.stackNeeds;
	if (stack.tailwind) parts.push("tailwind css");
	if (stack.shadcn) parts.push("shadcn ui");
	if (stack.radix) parts.push("radix ui");
	if (stack.next) parts.push("nextjs react");
	if (stack.vite) parts.push("vite react");
	return parts.join(" ");
}

/**
 * Format registry hits into a prompt appendix.
 */
function formatRegistryHits(hits: RegistryHit[]): string {
	if (hits.length === 0) return "";
	const lines: string[] = [
		"\n\n### Available Component Registry",
		"The following curated components are available for use in this project:",
		"",
	];
	for (const h of hits) {
		lines.push(`- **${h.entry.name}** (\`${h.entry.id}\`)`);
		lines.push(`  ${h.entry.semantic}`);
		lines.push(`  Tags: ${h.entry.tags.join(", ")}`);
		lines.push(`  \`\`\`tsx`);
		lines.push(`  ${h.code}`);
		lines.push(`  \`\`\``);
		if (h.entry.imports.length > 0) {
			lines.push(`  Requires: ${h.entry.imports.join(", ")}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

/**
 * Ask the LLM to generate code for the given project spec.
 * Returns a structured file envelope with files to write, packages to install,
 * and a build command to run.
 *
 * The prompt is enriched with matching component registry entries so the LLM
 * can import verified building blocks instead of writing everything from scratch.
 */
async function generateCodeEnvelope(
	spec: ProjectSpec,
	mode: "HIL" | "YOLO",
	phaseOpts: Partial<PhaseLLMOptions>,
): Promise<LLMFileEnvelope> {
	// Enrich prompt with registry components matching the project spec
	let registryAppendix = "";
	try {
		const query = buildRegistryQuery(spec);
		if (query.trim()) {
			const hits = searchRegistry(query, 5);
			registryAppendix = formatRegistryHits(hits);
		}
	} catch {
		// Registry search is best-effort — never block code generation
	}

	const basePrompt = JSON.stringify(
		{
			plan: spec.plan,
			tasks: spec.tasks,
			design: spec.design,
			wireframe: spec.wireframe,
			apiReference: spec.apiRef,
			databaseSchema: spec.dbSchema,
			stackNeeds: spec.stackNeeds,
			mode,
		},
		null,
		2,
	);
	const userPrompt = registryAppendix ? `${basePrompt}\n\n${registryAppendix}` : basePrompt;

	const result = await invokePhaseLLMJson<LLMFileEnvelope>(CODEGEN_SYSTEM_PROMPT, userPrompt, {
		cwd: phaseOpts.cwd ?? process.cwd(),
		phase: "phase-3",
		subagent: phaseOpts.subagent,
		maxOutputTokens: phaseOpts.maxOutputTokens ?? 32_000,
		temperature: phaseOpts.temperature ?? 0.4,
	});

	return {
		files: Array.isArray(result.files) ? result.files : [],
		packages: Array.isArray(result.packages) ? result.packages : [],
		buildCommand: typeof result.buildCommand === "string" ? result.buildCommand : null,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// File writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply the file envelope to the project directory.
 * Returns lists of created, modified, and skipped files.
 */
function applyFiles(
	projectDir: string,
	files: LLMFileEnvelope["files"],
): {
	created: string[];
	modified: string[];
	skipped: string[];
} {
	const result = { created: [] as string[], modified: [] as string[], skipped: [] as string[] };

	for (const file of files) {
		try {
			const fullPath = path.resolve(projectDir, file.path);
			// Security: prevent path traversal outside project dir
			if (!fullPath.startsWith(path.resolve(projectDir))) {
				logger.warn("codegen: path traversal blocked", { path: file.path });
				result.skipped.push(file.path);
				continue;
			}

			fs.mkdirSync(path.dirname(fullPath), { recursive: true });

			switch (file.op) {
				case "write": {
					const existed = fs.existsSync(fullPath);
					fs.writeFileSync(fullPath, file.content, "utf-8");
					if (existed) {
						result.modified.push(file.path);
					} else {
						result.created.push(file.path);
					}
					break;
				}
				case "edit": {
					fs.writeFileSync(fullPath, file.content, "utf-8");
					result.modified.push(file.path);
					break;
				}
				case "append": {
					fs.appendFileSync(fullPath, file.content, "utf-8");
					result.modified.push(file.path);
					break;
				}
			}
		} catch (err) {
			logger.warn("codegen: apply file failed", { path: file.path, err });
			result.skipped.push(file.path);
		}
	}

	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Package installation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install packages using the best available package manager.
 * Returns the list of successfully installed packages and any errors.
 */
async function installPackages(
	projectDir: string,
	packages: string[],
): Promise<{ installed: string[]; errors: string[] }> {
	if (packages.length === 0) return { installed: [], errors: [] };

	// Detect available package manager
	const pm = Bun.which("bun") ? "bun" : Bun.which("pnpm") ? "pnpm" : "npm";
	const addCmd = pm === "npm" ? "install" : "add";

	const installed: string[] = [];
	const errors: string[] = [];

	for (const pkg of packages) {
		try {
			const proc = Bun.spawn([pm, addCmd, pkg], {
				cwd: projectDir,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, npm_config_yes: "true" },
			});
			const exitCode = await proc.exited;
			if (exitCode === 0) {
				installed.push(pkg);
			} else {
				const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
				errors.push(`${pkg}: ${stderr.trim().slice(0, 200)}`);
			}
		} catch (err) {
			errors.push(`${pkg}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return { installed, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a build command in the project directory.
 * Returns the full output and success status.
 */
async function runBuild(
	projectDir: string,
	buildCommand: string | null,
): Promise<{ output: string; success: boolean }> {
	if (!buildCommand) return { output: "", success: true };

	try {
		const proc = Bun.spawn(buildCommand.split(/\s+/), {
			cwd: projectDir,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CI: "true" },
		});
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
		const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
		const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
		return { output, success: exitCode === 0 };
	} catch (err) {
		return { output: `Build spawn failed: ${err}`, success: false };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a complete project from the specification.
 *
 * @param spec - Project specification from Phase 1/2 artifacts
 * @param projectDir - Directory to generate code into
 * @param mode - HIL (interactive) or YOLO (automatic)
 * @param phaseOpts - Optional LLM overrides (model, temperature, etc.)
 *
 * Returns a structured result with file lists, package install status,
 * build output, and any errors.
 */
export async function generateCode(
	spec: ProjectSpec,
	projectDir: string,
	mode: "HIL" | "YOLO" = "YOLO",
	phaseOpts: Partial<PhaseLLMOptions> = {},
): Promise<CodegenResult> {
	const errors: string[] = [];

	// Step 1: Ask the LLM to generate the file envelope
	logger.info("codegen: generating code envelope", { projectDir });
	let envelope: LLMFileEnvelope;
	try {
		envelope = await generateCodeEnvelope(spec, mode, phaseOpts);
	} catch (err) {
		const msg = `codegen: LLM envelope generation failed: ${err instanceof Error ? err.message : String(err)}`;
		logger.error(msg);
		return {
			filesCreated: [],
			filesModified: [],
			filesSkipped: [],
			packagesInstalled: [],
			installErrors: [],
			buildOutput: "",
			buildSuccess: false,
			errors: [msg],
		};
	}

	if (envelope.files.length === 0) {
		logger.warn("codegen: LLM returned empty file list");
		errors.push("LLM returned no files to generate");
	}

	// Step 2: Apply generated files
	logger.info("codegen: applying files", { count: envelope.files.length });
	const { created, modified, skipped } = applyFiles(projectDir, envelope.files);

	// Step 3: Install packages
	logger.info("codegen: installing packages", { count: envelope.packages.length });
	const { installed: packagesInstalled, errors: installErrors } = await installPackages(projectDir, envelope.packages);

	// Step 4: Run build verification
	logger.info("codegen: running build", { command: envelope.buildCommand ?? "(none)" });
	const { output: buildOutput, success: buildSuccess } = await runBuild(projectDir, envelope.buildCommand);

	// Step 5: Collect git changes for evidence
	try {
		const changes = await collectChanges(projectDir);
		for (const f of changes.created) {
			if (!created.includes(f)) created.push(f);
		}
		for (const f of changes.modified) {
			if (!modified.includes(f)) modified.push(f);
		}
	} catch {
		// git diff collection is best-effort
	}

	return {
		filesCreated: created,
		filesModified: modified,
		filesSkipped: skipped,
		packagesInstalled,
		installErrors,
		buildOutput,
		buildSuccess,
		errors,
	};
}

/**
 * Convenience: generate code for a specific sub-agent role.
 * Wraps generateCode with role-appropriate system prompt augmentation.
 */
export async function generateCodeForRole(
	spec: ProjectSpec,
	projectDir: string,
	role: "SA1" | "SA2" | "SA3" | "SA4" | "SA5",
	mode: "HIL" | "YOLO" = "YOLO",
	phaseOpts: Partial<PhaseLLMOptions> = {},
): Promise<CodegenResult> {
	// Role-specific instructions appended to the system prompt
	const roleHints: Record<string, string> = {
		SA1: "Focus on frontend: UI components, styling, layouts, client-side logic. Use the wireframe and design as your visual reference.",
		SA2: "Focus on backend: API routes, database models, authentication, business logic. Use the API reference and DB schema.",
		SA3: "Focus on integration: connect frontend to backend, wire up API calls, set up state management, ensure end-to-end data flow.",
		SA4: "Focus on debugging: run the build, fix any errors, add missing imports, resolve type issues, verify the app starts.",
		SA5: "Focus on review: read all previously generated code, check for consistency, suggest fixes, prepare the handoff to Phase 4.",
	};

	const augmentedSpec: ProjectSpec = {
		...spec,
		plan: `${spec.plan}\n\n## Role: ${role}\n${roleHints[role] ?? ""}`,
	};

	return generateCode(augmentedSpec, projectDir, mode, {
		...phaseOpts,
		subagent: role,
	});
}

/**
 * Generate an execution log entry for codegen results.
 */
export function formatCodegenResult(id: string, result: CodegenResult): string {
	const lines: string[] = [];
	lines.push(`## ${id} — Code Generation Report`);
	lines.push("");
	lines.push(`- Files created: ${result.filesCreated.length}`);
	lines.push(`- Files modified: ${result.filesModified.length}`);
	lines.push(`- Files skipped: ${result.filesSkipped.length}`);
	lines.push(`- Packages installed: ${result.packagesInstalled.length}`);
	lines.push(`- Build: ${result.buildSuccess ? "✅ passed" : "❌ failed"}`);
	if (result.installErrors.length > 0) {
		lines.push(`- Install errors: ${result.installErrors.length}`);
		for (const err of result.installErrors.slice(0, 5)) {
			lines.push(`  - ${err}`);
		}
	}
	if (result.errors.length > 0) {
		lines.push(`- Errors: ${result.errors.length}`);
		for (const err of result.errors.slice(0, 5)) {
			lines.push(`  - ${err}`);
		}
	}
	if (result.filesCreated.length > 0) {
		lines.push("");
		lines.push("### Created files");
		for (const f of result.filesCreated.slice(0, 30)) {
			lines.push(`- \`${f}\``);
		}
		if (result.filesCreated.length > 30) {
			lines.push(`- ... and ${result.filesCreated.length - 30} more`);
		}
	}
	if (result.filesModified.length > 0) {
		lines.push("");
		lines.push("### Modified files");
		for (const f of result.filesModified.slice(0, 20)) {
			lines.push(`- \`${f}\``);
		}
		if (result.filesModified.length > 20) {
			lines.push(`- ... and ${result.filesModified.length - 20} more`);
		}
	}
	return `${lines.join("\n")}\n`;
}
