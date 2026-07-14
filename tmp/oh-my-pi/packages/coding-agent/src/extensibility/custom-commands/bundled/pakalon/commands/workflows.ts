/**
 * /workflows command — Manage workflow automation files.
 *
 * Walks `.omp/workflows/*.json` and `~/.omp/workflows/*.json` for
 * workflow definitions, lets the user list, run, view logs, and
 * check status of each workflow.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export interface WorkflowStep {
	name: string;
	command: string;
	cwd?: string;
	timeout?: number;
}

export interface WorkflowTrigger {
	type: "manual" | "cron" | "event";
	value?: string;
}

export interface WorkflowDefinition {
	name: string;
	description: string;
	steps: WorkflowStep[];
	triggers: WorkflowTrigger[];
	author?: string;
	version?: string;
}

export interface WorkflowRun {
	id: string;
	workflowName: string;
	startedAt: string;
	status: "running" | "success" | "failed" | "cancelled";
	stepIndex: number;
	output: string;
}

const RUNS_FILE = ".omp-workflow-runs.json";

function userWorkflowsDir(): string {
	return path.join(process.env.HOME || process.env.USERPROFILE || "", ".omp", "workflows");
}

function projectWorkflowsDir(cwd: string): string {
	return path.join(cwd, ".omp", "workflows");
}

function runsPath(cwd: string): string {
	return path.join(cwd, RUNS_FILE);
}

async function loadRuns(cwd: string): Promise<WorkflowRun[]> {
	try {
		return await Bun.file(runsPath(cwd)).json();
	} catch {
		return [];
	}
}

async function saveRuns(cwd: string, runs: WorkflowRun[]): Promise<void> {
	await Bun.write(runsPath(cwd), JSON.stringify(runs, null, 2));
}

async function discoverWorkflows(cwd: string): Promise<WorkflowDefinition[]> {
	const workflows: WorkflowDefinition[] = [];
	const seen = new Set<string>();

	for (const baseDir of [userWorkflowsDir(), projectWorkflowsDir(cwd)]) {
		let entries: string[];
		try {
			entries = await fs.readdir(baseDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const name = entry.slice(0, -5);
			if (seen.has(name)) continue;
			try {
				const wf: WorkflowDefinition = await Bun.file(path.join(baseDir, entry)).json();
				workflows.push(wf);
				seen.add(name);
			} catch {
				logger.warn("workflows: invalid workflow file", { entry });
			}
		}
	}

	return workflows;
}

export class WorkflowsCommand implements CustomCommand {
	name = "workflows";
	description = "Manage workflow automation files (list, run, logs, status)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const sub = (args[0] ?? "list").toLowerCase();
		const rest = args.slice(1);

		try {
			switch (sub) {
				case "list":
				case "":
					return this.handleList(ctx);
				case "run":
					return this.handleRun(rest, ctx);
				case "status":
					return this.handleStatus(ctx);
				case "logs":
					return this.handleLogs(ctx);
				default:
					ctx.ui.notify(`Unknown subcommand: /workflows ${sub}`, "warning");
					return this.handleList(ctx);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("workflows command failed", { sub, error: msg });
			ctx.ui.notify(`/workflows ${sub} failed: ${msg}`, "error");
			return undefined;
		}
	}

	private async handleList(ctx: HookCommandContext): Promise<string> {
		const cwd = this.api?.cwd ?? ctx.cwd;
		const workflows = await discoverWorkflows(cwd);

		if (workflows.length === 0) {
			ctx.ui.notify("No workflows found. Create a JSON file in `.omp/workflows/`.", "info");
			return [
				"## /workflows",
				"",
				"No workflows found.",
				"",
				"Create a workflow file in `.omp/workflows/` or `~/.omp/workflows/`:",
				"",
				"```json",
				JSON.stringify(
					{
						name: "my-workflow",
						description: "What this workflow does",
						steps: [{ name: "build", command: "bun run build" }],
						triggers: [{ type: "manual" }],
					},
					null,
					2,
				),
				"```",
				"",
				"Usage:",
				"  /workflows list       — list all workflows",
				"  /workflows run <name> — run a workflow",
				"  /workflows status     — show running/completed workflows",
				"  /workflows logs       — show recent run logs",
			].join("\n");
		}

		const lines: string[] = ["## Workflows", ""];
		for (const wf of workflows) {
			lines.push(`- **${wf.name}** — ${wf.description}`);
			lines.push(`  Steps: ${wf.steps.length}  |  Triggers: ${wf.triggers.map(t => t.type).join(", ")}`);
			if (wf.version) lines.push(`  Version: ${wf.version}`);
			lines.push("");
		}
		lines.push(`${workflows.length} workflow(s) found.`);

		ctx.ui.notify(`Found ${workflows.length} workflow(s).`, "info");
		return lines.join("\n");
	}

	private async handleRun(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0]?.trim();
		if (!name) {
			ctx.ui.notify("Usage: /workflows run <name>", "error");
			return "Usage: /workflows run <name>";
		}

		const cwd = this.api?.cwd ?? ctx.cwd;
		const workflows = await discoverWorkflows(cwd);
		const wf = workflows.find(w => w.name === name);

		if (!wf) {
			ctx.ui.notify(`Workflow "${name}" not found.`, "warning");
			return `Workflow "${name}" not found. Run \`/workflows list\` to see available workflows.`;
		}

		const runId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const run: WorkflowRun = {
			id: runId,
			workflowName: wf.name,
			startedAt: new Date().toISOString(),
			status: "running",
			stepIndex: 0,
			output: "",
		};

		const runs = await loadRuns(cwd);
		runs.push(run);

		ctx.ui.notify(`Running workflow "${wf.name}" (${wf.steps.length} steps)...`, "info");

		const outputLines: string[] = [
			`## Running workflow: ${wf.name}`,
			``,
			`ID: ${runId}`,
			`Started: ${new Date().toLocaleString()}`,
			``,
		];

		for (let i = 0; i < wf.steps.length; i++) {
			const step = wf.steps[i]!;
			outputLines.push(`### Step ${i + 1}/${wf.steps.length}: ${step.name}`);
			outputLines.push(`\`\`\`sh\n$ ${step.command}\n\`\`\``);

			try {
				const result = await $`${step.command}`
					.cwd(step.cwd ?? cwd)
					.nothrow()
					.quiet();
				const stdout = result.text();
				if (stdout.trim()) {
					outputLines.push("```");
					outputLines.push(stdout.trim());
					outputLines.push("```");
				}
				if (result.exitCode === 0) {
					outputLines.push(`✅ Step "${step.name}" completed.`);
				} else {
					const stderr = result.stderr?.toString() || "";
					if (stderr.trim()) {
						outputLines.push("```");
						outputLines.push(stderr.trim());
						outputLines.push("```");
					}
					outputLines.push(`❌ Step "${step.name}" failed (exit code ${result.exitCode}).`);
					run.status = "failed";
					break;
				}
			} catch (stepErr) {
				const msg = stepErr instanceof Error ? stepErr.message : String(stepErr);
				outputLines.push(`❌ Step "${step.name}" failed: ${msg}`);
				run.status = "failed";
				break;
			}
			run.stepIndex = i + 1;
		}

		if (run.status === "running") {
			run.status = "success";
			outputLines.push(``, `✅ Workflow "${wf.name}" completed successfully.`);
		}

		run.output = outputLines.join("\n");

		const allRuns = await loadRuns(cwd);
		const idx = allRuns.findIndex(r => r.id === runId);
		if (idx !== -1) allRuns[idx] = run;
		else allRuns.push(run);
		await saveRuns(cwd, allRuns);

		return run.output;
	}

	private async handleStatus(ctx: HookCommandContext): Promise<string> {
		const cwd = this.api?.cwd ?? ctx.cwd;
		const runs = await loadRuns(cwd);
		const active = runs.filter(r => r.status === "running");
		const recent = runs.slice(-10).reverse();

		const lines: string[] = ["## Workflow Status", ""];

		if (active.length > 0) {
			lines.push(`### Running (${active.length})`);
			for (const r of active) {
				lines.push(`- **${r.workflowName}** — started ${new Date(r.startedAt).toLocaleString()}`);
				lines.push(`  Step ${r.stepIndex} in progress...`);
				lines.push("");
			}
		} else {
			lines.push("No workflows currently running.");
			lines.push("");
		}

		if (recent.length > 0) {
			lines.push("### Recent Runs");
			lines.push("| Workflow | Status | Started | ID |");
			lines.push("|----------|--------|---------|----|");
			for (const r of recent) {
				lines.push(
					`| ${r.workflowName} | ${r.status} | ${new Date(r.startedAt).toLocaleString()} | ${r.id.slice(0, 16)} |`,
				);
			}
		}

		return lines.join("\n");
	}

	private async handleLogs(ctx: HookCommandContext): Promise<string> {
		const cwd = this.api?.cwd ?? ctx.cwd;
		const runs = await loadRuns(cwd);
		const recent = runs.slice(-5).reverse();

		if (recent.length === 0) {
			return "No workflow runs logged yet.";
		}

		const lines: string[] = ["## Recent Workflow Logs", ""];
		for (const r of recent) {
			lines.push(`### ${r.workflowName} [${r.status}]`);
			lines.push(`ID: ${r.id}  |  Started: ${new Date(r.startedAt).toLocaleString()}`);
			lines.push("");
			if (r.output) {
				const preview = r.output.length > 500 ? `${r.output.slice(0, 500)}\n...(truncated)` : r.output;
				lines.push(preview);
			} else {
				lines.push("(no output)");
			}
			lines.push("---");
			lines.push("");
		}

		return lines.join("\n");
	}
}

export default function workflowsFactory(_api: CustomCommandAPI): WorkflowsCommand {
	return new WorkflowsCommand();
}
