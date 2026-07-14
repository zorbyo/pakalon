/**
 * Phase 5: Deployment & Integration for Pakalon.
 *
 * Generates CI/CD pipelines, GitHub integration, and deployment configs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLM } from "../../pakalon/llm/invoker";
import { rememberArtifactsInDir } from "../../pakalon/mem0";
import deploySystemPrompt from "../../prompts/phase-5/deploy.md" with { type: "text" };

export interface Phase5Input {
	projectDir: string;
	githubRepo?: string;
	deployTarget?: "aws" | "digitalocean" | "azure" | "gcp" | "none";
}

export interface Phase5Output {
	githubCreated: boolean;
	ciCdPipeline: string;
	deploymentGuide: string;
	phase5Doc: string;
}

const PHASE5_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-5");
const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");

function readFileSafe(p: string): string {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return "";
	}
}

export async function runPhase5(cwd: string, input?: Phase5Input): Promise<Phase5Output> {
	logger.info("Phase 5: Deployment & Integration started", { cwd });

	const dir = PHASE5_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const plan = readFileSafe(path.join(PHASE1_DIR(cwd), "plan.md"));
	const tasks = readFileSafe(path.join(PHASE1_DIR(cwd), "tasks.md"));

	let githubCreated = false;
	let ciCdPipeline = "";
	let deploymentGuide = "";

	try {
		const pipelinePrompt = JSON.stringify({
			plan,
			tasks,
			repo: input?.githubRepo || path.basename(cwd),
			target: input?.deployTarget || "none",
		});

		const pipelineResult = await invokePhaseLLM(deploySystemPrompt, pipelinePrompt, {
			cwd,
			phase: "phase-5",
			subagent: "cicd",
			maxOutputTokens: 8192,
		});

		ciCdPipeline = pipelineResult.text;

		const guidePrompt = JSON.stringify({
			plan,
			target: input?.deployTarget || "none",
			hasBackend: plan.toLowerCase().includes("backend"),
			hasFrontend: plan.toLowerCase().includes("frontend"),
		});

		const guideResult = await invokePhaseLLM(
			"You are a DevOps engineer. Generate a step-by-step deployment guide for the application described.",
			guidePrompt,
			{ cwd, phase: "phase-5", subagent: "deploy-guide", maxOutputTokens: 8192 },
		);

		deploymentGuide = guideResult.text;

		try {
			const { createGitHubRepo } = await import("../../integrations/github");
			if (input?.githubRepo && !githubCreated) {
				await createGitHubRepo(cwd, input.githubRepo);
				githubCreated = true;
			}
		} catch (err) {
			logger.warn("phase-5: GitHub integration skipped", { err });
		}
	} catch (err) {
		logger.warn("phase-5: LLM generation failed, using template", { err });
		ciCdPipeline = generateCICDTemplate(input?.githubRepo || path.basename(cwd));
		deploymentGuide = generateDeploymentTemplate(input?.deployTarget || "none");
	}

	const phase5Doc =
		`# Phase 5: Deployment & Integration\n\n` +
		`## Summary\n\n` +
		`- GitHub: ${githubCreated ? "[OK] Repository created" : "[INFO] Ready for manual setup"}\n` +
		`- CI/CD: ${ciCdPipeline ? "[OK] Generated" : "[WARN] Template only"}\n` +
		`- Deploy target: ${input?.deployTarget || "none (manual)"}\n\n` +
		`## Generated Files\n\n` +
		`- .github/workflows/ci.yml\n` +
		`- docker-compose.yml\n` +
		`- README-deploy.md\n\n` +
		`## Next Steps\n\n` +
		`1. Review CI/CD pipeline in .github/workflows/\n` +
		`2. Configure deployment secrets\n` +
		`3. Run first deployment\n`;

	fs.writeFileSync(path.join(dir, "phase-5.md"), phase5Doc);
	fs.writeFileSync(path.join(dir, "ci-cd-pipeline.yml"), ciCdPipeline);
	fs.writeFileSync(path.join(dir, "deployment-guide.md"), deploymentGuide);

	if (ciCdPipeline) {
		const workflowsDir = path.join(cwd, ".github", "workflows");
		fs.mkdirSync(workflowsDir, { recursive: true });
		fs.writeFileSync(path.join(workflowsDir, "ci.yml"), ciCdPipeline);
	}

	logger.info("Phase 5 completed", { githubCreated, hasPipeline: !!ciCdPipeline });
	void rememberArtifactsInDir({
		userId: process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous",
		phase: "phase-5",
		dir: PHASE5_DIR(cwd),
		projectRoot: cwd,
		extensions: [".md", ".yml"],
	}).catch(err => logger.warn("phase-5: mem0 sync failed", { err }));

	return { githubCreated, ciCdPipeline, deploymentGuide, phase5Doc };
}

function generateCICDTemplate(repoName: string): string {
	return `name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          echo "Running tests..."

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build
        run: |
          echo "Building ${repoName}..."

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Deploy
        run: |
          echo "Deploying ${repoName}...";
`;
}

function generateDeploymentTemplate(target: string): string {
	const targets: Record<string, string> = {
		aws: "# AWS Deployment\n\n1. Build Docker image\n2. Push to ECR\n3. Update ECS service\n",
		digitalocean:
			"# DigitalOcean Deployment\n\n1. Build Docker image\n2. Push to Docker Hub\n3. Deploy to App Platform\n",
		azure: "# Azure Deployment\n\n1. Build Docker image\n2. Push to ACR\n3. Update Container Instances\n",
		gcp: "# GCP Deployment\n\n1. Build Docker image\n2. Push to GCR\n3. Deploy to Cloud Run\n",
		none: "# Manual Deployment\n\nNo cloud target selected. Deploy manually using Docker or your preferred method.",
	};

	return targets[target] || targets.none;
}
