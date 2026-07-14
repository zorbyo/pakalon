import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { GitHubManager } from "./github";
import type { Phase5Input, Phase5Output } from "./types";

const PHASE5_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-5");
const PHASE4_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-4");

function loadPhase4Memory(cwd: string): Record<string, any> {
	try {
		return JSON.parse(fs.readFileSync(path.join(PHASE4_DIR(cwd), ".memory.json"), "utf-8"));
	} catch {
		return {};
	}
}

function generateGitHubWorkflow(repoName: string, deployTarget: string): string {
	const ghExpr = (inner: string): string => `\${{ ${inner} }}`;
	const deployJob =
		deployTarget !== "none"
			? [
					"  deploy:",
					"    needs: build",
					"    runs-on: ubuntu-latest",
					`    if: ${ghExpr("github.ref == 'refs/heads/main'")}`,
					"    steps:",
					"      - uses: actions/checkout@v4",
					"      - name: Configure AWS credentials",
					`        if: ${ghExpr("contains(github.ref, 'main')")}`,
					"        run: |",
					`          echo "Configuring deployment for ${deployTarget}..."`,
					`      - name: Deploy to ${deployTarget}`,
					"        run: |",
					`          echo "Deploying ${repoName} to ${deployTarget}"`,
				].join("\n")
			: "";

	const bunVersionExpr = ghExpr("env.BUN_VERSION");
	const dockerBuild = `docker build -t ${repoName}:latest .`;
	const dockerTag = `docker tag ${repoName}:latest ghcr.io/${ghExpr("github.repository")}:latest`;
	const dockerPush = `docker push ghcr.io/${ghExpr("github.repository")}:latest`;
	const artifactsPath = `dist/${deployJob}`;

	return `name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: "20"
  BUN_VERSION: "1.0"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${bunVersionExpr}
      - run: bun install
      - run: bun run lint
      - name: Check types
        run: bun run check

  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${bunVersionExpr}
      - run: bun install
      - run: bun run test
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  security:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        with:
          config-path: .gitleaks.toml
      - name: Run Semgrep
        uses: semgrep/semgrep-action@v1
        with:
          config: auto

  build:
    needs: [test, security]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${bunVersionExpr}
      - run: bun install
      - run: bun run build
      - name: Build Docker image
        run: |
          ${dockerBuild}
          ${dockerTag}
      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${ghExpr("github.actor")}
          password: ${ghExpr("secrets.GITHUB_TOKEN")}
      - name: Push Docker image
        run: ${dockerPush}
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build
          path: ${artifactsPath}
  `;
}

function generateDeploymentGuide(deployTarget: string, repoName: string): string {
	const guides: Record<string, string> = {
		aws: `# AWS Deployment Guide

## Prerequisites
- AWS CLI installed and configured
- Docker installed
- AWS ECR repository created

## Steps

### 1. Build and Push to ECR
\`\`\`bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker build -t ${repoName} .
docker tag ${repoName}:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/${repoName}:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/${repoName}:latest
\`\`\`

### 2. Deploy to ECS
\`\`\`bash
aws ecs update-service --cluster ${repoName}-cluster --service ${repoName}-service --force-new-deployment
\`\`\`

### 3. Configure Environment
- Set environment variables in AWS Parameter Store
- Configure secrets in AWS Secrets Manager
- Set up CloudWatch for logging

### 4. Verify Deployment
\`\`\`bash
aws ecs describe-services --cluster ${repoName}-cluster --services ${repoName}-service
\`\`\`

## Rollback
\`\`\`bash
aws ecs update-service --cluster ${repoName}-cluster --service ${repoName}-service --task-definition <previous-task-def>
\`\`\`
`,
		digitalocean: `# DigitalOcean Deployment Guide

## Prerequisites
- doctl CLI installed and authenticated
- Docker installed
- DigitalOcean Container Registry

## Steps

### 1. Build and Push to Registry
\`\`\`bash
doctl registry login
docker build -t registry.digitalocean.com/${repoName}/${repoName}:latest .
docker push registry.digitalocean.com/${repoName}/${repoName}:latest
\`\`\`

### 2. Deploy to App Platform
\`\`\`bash
doctl apps create --spec app-spec.yaml
\`\`\`

### 3. Configure Environment
- Add environment variables in App Platform dashboard
- Set up database connection
- Configure custom domain

### 4. Monitor
\`\`\`bash
doctl apps logs <app-id> --follow
\`\`\`
`,
		azure: `# Azure Deployment Guide

## Prerequisites
- Azure CLI installed and authenticated
- Docker installed
- Azure Container Registry created

## Steps

### 1. Build and Push to ACR
\`\`\`bash
az acr login --name ${repoName}acr
docker build -t ${repoName}acr.azurecr.io/${repoName}:latest .
docker push ${repoName}acr.azurecr.io/${repoName}:latest
\`\`\`

### 2. Deploy to Container Instances
\`\`\`bash
az container create --resource-group ${repoName}-rg --name ${repoName} --image ${repoName}acr.azurecr.io/${repoName}:latest --dns-name-label ${repoName} --ports 80 443
\`\`\`

### 3. Configure
- Set up Azure Key Vault for secrets
- Configure Azure Monitor
- Set up auto-scaling rules
`,
		gcp: `# GCP Deployment Guide

## Prerequisites
- gcloud CLI installed and authenticated
- Docker installed
- Google Container Registry or Artifact Registry

## Steps

### 1. Build and Push to GCR
\`\`\`bash
gcloud auth configure-docker
docker build -t gcr.io/<project-id>/${repoName}:latest .
docker push gcr.io/<project-id>/${repoName}:latest
\`\`\`

### 2. Deploy to Cloud Run
\`\`\`bash
gcloud run deploy ${repoName} --image gcr.io/<project-id>/${repoName}:latest --platform managed --region us-central1 --allow-unauthenticated
\`\`\`

### 3. Configure
- Set up Cloud SQL connection
- Configure Secret Manager
- Set up Cloud Monitoring
`,
	};
	const defaultGuide = `# Manual Deployment Guide

## Prerequisites
- Docker installed
- Git installed

## Steps

### 1. Build the Application
\`\`\`bash
bun install
bun run build
\`\`\`

### 2. Build Docker Image
\`\`\`bash
docker build -t ${repoName}:latest .
\`\`\`

### 3. Run Locally
\`\`\`bash
docker run -d -p 3000:3000 --name ${repoName} ${repoName}:latest
\`\`\`

### 4. Deploy to Your Server
1. Push Docker image to your registry
2. SSH into your server
3. Pull and run the container
4. Configure reverse proxy (nginx/Caddy)
5. Set up SSL with Let's Encrypt
6. Configure monitoring and logging
`;

	return guides[deployTarget] ?? defaultGuide;
}

function generateCiCdStatus(repoName: string): string {
	return `# CI/CD Pipeline Status

## Pipeline Stages
| Stage | Status | Description |
|-------|--------|-------------|
| 🔍 Lint | ✅ Configured | ESLint + TypeScript type checking |
| 🧪 Test | ✅ Configured | Unit + integration tests |
| 🔒 Security | ✅ Configured | Gitleaks + Semgrep scanning |
| 📦 Build | ✅ Configured | Application + Docker build |
| 🚀 Deploy | ${repoName ? "✅ Configured" : "⏳ Needs configuration"} | Cloud deployment |

## GitHub Secrets Required
| Secret | Description | Required |
|--------|-------------|----------|
| \`DOCKER_USERNAME\` | Docker Hub or GHCR username | Yes |
| \`DOCKER_PASSWORD\` | Docker Hub or GHCR token | Yes |
| \`CLOUD_API_KEY\` | Cloud provider API key | For auto-deploy |
| \`ENV_FILE\` | Base64-encoded .env file | For production |

## Local Testing
\`\`\`bash
# Test the pipeline locally with act
act -j build
act -j test
\`\`\`

## Manual Deployment
If CI/CD is not configured, deploy manually:
1. Build: \`bun run build\`
2. Docker: \`docker build -t ${repoName} . && docker run -p 3000:3000 ${repoName}\`
3. Deploy: Follow the deployment guide for your target platform
`;
}

function generateDockerfile(): string {
	return `FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 appuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER appuser
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["bun", "run", "dist/index.js"]
`;
}

function generateDockerCompose(): string {
	return `version: "3.8"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
      - JWT_SECRET=\${JWT_SECRET}
    env_file:
      - .env.production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - app_data:/app/data

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=\${POSTGRES_DB:-app}
      - POSTGRES_USER=\${POSTGRES_USER:-app}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
  app_data:
`;
}

export async function runPhase5(cwd: string, input?: Phase5Input): Promise<Phase5Output> {
	logger.info("Phase 5: Deployment & Integration started", { cwd });
	const dir = PHASE5_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const phase4Memory = loadPhase4Memory(cwd);
	const repoName = input?.githubRepo ?? path.basename(cwd);
	const deployTarget = input?.deployTarget ?? "none";

	const ciCdPipeline = generateGitHubWorkflow(repoName, deployTarget);
	const deploymentGuide = generateDeploymentGuide(deployTarget, repoName);
	const cicdStatus = generateCiCdStatus(repoName);

	const workflowsDir = path.join(cwd, ".github", "workflows");
	fs.mkdirSync(workflowsDir, { recursive: true });
	fs.writeFileSync(path.join(workflowsDir, "ci.yml"), ciCdPipeline);

	const dockerfilePath = path.join(cwd, "Dockerfile");
	if (!fs.existsSync(dockerfilePath)) {
		fs.writeFileSync(dockerfilePath, generateDockerfile());
	}

	const composePath = path.join(cwd, "docker-compose.yml");
	if (!fs.existsSync(composePath)) {
		fs.writeFileSync(composePath, generateDockerCompose());
	}

	fs.writeFileSync(path.join(dir, "deployment-guide.md"), deploymentGuide);
	fs.writeFileSync(path.join(dir, "cicd-status.md"), cicdStatus);

	const phase5Doc = `# Phase 5: Deployment & Integration Summary

## Overview
- **Generated:** ${new Date().toISOString()}
- **Repository:** ${repoName}
- **Deploy Target:** ${deployTarget}
- **Security Scan Status:** ${phase4Memory.scanSummary ? `Critical: ${phase4Memory.scanSummary.critical}, High: ${phase4Memory.scanSummary.high}` : "No Phase 4 data available"}

## Generated Files
| File | Description |
|------|-------------|
| .github/workflows/ci.yml | GitHub Actions CI/CD pipeline |
| Dockerfile | Multi-stage Docker build |
| docker-compose.yml | Docker Compose with PostgreSQL + Redis |
| deployment-guide.md | Platform-specific deployment instructions |
| cicd-status.md | CI/CD pipeline status and configuration |
| phase-5.md | This summary document |

## Pipeline Stages
1. **Lint** - ESLint + TypeScript checks
2. **Test** - Unit and integration tests
3. **Security** - Gitleaks + Semgrep scanning
4. **Build** - Application build + Docker image
5. **Deploy** - Cloud deployment (if configured)

## Deployment Targets
${
	deployTarget !== "none"
		? `- **Target:** ${deployTarget}\n- **Guide:** See deployment-guide.md\n- **Docker:** Image will be pushed to container registry`
		: "- **Target:** Manual (no cloud target selected)\n- **Action:** Set deployTarget via Phase 5 input"
}

## Next Steps
1. Push code to GitHub repository
2. Configure GitHub Secrets (DOCKER_USERNAME, DOCKER_PASSWORD, etc.)
3. Run the CI/CD pipeline: push to main branch
4. Verify deployment on target platform
5. Set up monitoring and alerting
6. Proceed to Phase 6: Documentation
`;

	fs.writeFileSync(path.join(dir, "phase-5.md"), phase5Doc);

	const memoryContext = {
		phase: "phase-5",
		repoName,
		deployTarget,
		ciGenerated: true,
		dockerGenerated: true,
		hasDockerfile: fs.existsSync(dockerfilePath),
		hasComposeFile: fs.existsSync(composePath),
		completedAt: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(dir, ".memory.json"), JSON.stringify(memoryContext, null, 2));

	let githubCreated = false;
	let prCreated = false;
	let repoUrl = "";

	if (input?.createRepo) {
		const gh = new GitHubManager();
		const ghResult = await gh.createRepo({
			repoName,
			description: `Project generated by Pakalon 6-phase pipeline: ${path.basename(cwd)}`,
			visibility: input?.repoVisibility ?? "public",
			projectDir: cwd,
		});
		githubCreated = ghResult.repoCreated;
		prCreated = ghResult.prCreated;
		repoUrl = ghResult.repoUrl;
		if (ghResult.error) {
			logger.warn("GitHub repo creation result", { error: ghResult.error });
		}
	}

	logger.info("Phase 5 completed", { repoName, deployTarget, githubCreated, prCreated });
	return {
		githubCreated,
		prCreated,
		repoUrl,
		ciCdPipeline,
		deploymentGuide,
		phase5Doc,
	};
}
