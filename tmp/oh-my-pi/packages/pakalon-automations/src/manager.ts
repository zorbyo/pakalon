import { logger } from "@oh-my-pi/pi-utils";
import type { Workflow, WorkflowStatus, WorkflowTrigger } from "./types";

export class AutomationManager {
	private workflows: Map<string, Workflow> = new Map();

	createWorkflow(
		name: string,
		description: string,
		trigger: WorkflowTrigger,
		triggerConfig: Record<string, unknown>,
	): Workflow {
		const workflow: Workflow = {
			id: crypto.randomUUID(),
			name,
			description,
			trigger,
			triggerConfig,
			actions: [],
			status: "active",
			createdAt: new Date().toISOString(),
		};
		this.workflows.set(workflow.id, workflow);
		logger.info("Workflow created", { id: workflow.id, name, trigger });
		return workflow;
	}

	addAction(
		workflowId: string,
		action: { type: "command" | "script" | "webhook" | "notification"; config: Record<string, unknown> },
	): boolean {
		const wf = this.workflows.get(workflowId);
		if (!wf) return false;
		wf.actions.push(action);
		return true;
	}

	getWorkflow(id: string): Workflow | undefined {
		return this.workflows.get(id);
	}

	getAllWorkflows(): Workflow[] {
		return [...this.workflows.values()];
	}

	getWorkflowsByTrigger(trigger: WorkflowTrigger): Workflow[] {
		return this.getAllWorkflows().filter(w => w.trigger === trigger);
	}

	updateStatus(id: string, status: WorkflowStatus): boolean {
		const wf = this.workflows.get(id);
		if (!wf) return false;
		wf.status = status;
		return true;
	}

	recordRun(id: string): boolean {
		const wf = this.workflows.get(id);
		if (!wf) return false;
		wf.lastRunAt = new Date().toISOString();
		return true;
	}

	deleteWorkflow(id: string): boolean {
		return this.workflows.delete(id);
	}

	count(): number {
		return this.workflows.size;
	}
}
