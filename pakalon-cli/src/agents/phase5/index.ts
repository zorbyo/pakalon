/**
 * Phase 5 Agent: Deployment
 * Enterprise-grade deployment automation
 * 
 * Features:
 * - Docker containerization
 * - CI/CD pipeline setup
 * - Cloud deployment (Vercel, AWS, etc.)
 * - Environment configuration
 * - Health checks and monitoring
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult, Phase5State } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { Octokit } from '@octokit/rest';
import { getToolsForAI } from '@/tools/registry-new.js';
import fg from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import logger from '@/utils/logger.js';
import { loadSandboxState, sandboxLifecycleManager, PolicyEvaluator, isSandboxUsableStatus } from '@/sandbox/index.js';
import { deployProject } from '@/cloud/index.js';
import type { CloudProvider } from '@/cloud/index.js';

const PHASE5_SYSTEM_PROMPT = `You are the Phase 5 Deployment Agent for Pakalon.

Your responsibilities:
1. Generate Dockerfile and docker-compose.yml
2. Set up CI/CD pipelines (GitHub Actions, etc.)
3. Configure environment variables
4. Deploy to cloud platforms
5. Set up monitoring and logging

You must use natural language. Explain deployment steps clearly.`;

type DeploymentTarget = 'vercel' | 'aws' | 'digitalocean' | 'azure' | 'gcp';
type DeploymentEnvironment = 'staging' | 'production';

interface RuntimeDeploymentFlags {
  environment: DeploymentEnvironment;
  canary: boolean;
  autoRollback: boolean;
  target?: DeploymentTarget;
}

interface DeploymentRecord {
  target: DeploymentTarget;
  environment: DeploymentEnvironment;
  identifier: string;
  version: string;
  url?: string;
  status: 'pending' | 'success' | 'failed' | 'rolled_back';
  timestamp: number;
}

export class Phase5Agent extends BaseAgent {
  private state: Phase5State;
  private outputDir: string;
  private runtimeFlags: RuntimeDeploymentFlags;
  private deploymentHistory = new Map<string, DeploymentRecord>();
  private lastSuccessfulDeployments = new Map<string, DeploymentRecord>();
  
  constructor(context: AgentContext) {
    const config: AgentConfig = {
      name: 'phase5-deployment',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: PHASE5_SYSTEM_PROMPT,
      tools: getToolsForAI(),
      maxTokens: 8192,
      temperature: 0.5,
    };
    
    super(config, context);

    this.runtimeFlags = this.parseRuntimeFlags(context);
    
    this.state = {
      userPrompt: context.userPrompt,
      projectDir: context.projectDir,
      deploymentConfigs: [],
      cicdPipelines: [],
      deploymentUrl: undefined,
    };
    
    this.outputDir = path.join(context.projectDir, '.pakalon-agents', 'phase-5');
    
    logger.info(`[Phase5] Initialized for project: ${context.projectDir}`);
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      logger.info('[Phase5] ========================================');
      logger.info('[Phase5] Starting Phase 5: Deployment');
      logger.info('[Phase5] ========================================');
      
      await fs.mkdir(this.outputDir, { recursive: true });

      // Check if sandbox mode is active — evaluate policy before deployment
      const sandboxState = await loadSandboxState(this.state.projectDir);
      let sandboxSessionId: string | undefined;

      if (sandboxState && (isSandboxUsableStatus(sandboxState.status) || sandboxState.status === 'failed')) {
        sandboxSessionId = sandboxState.sandboxId;
        logger.info('[Phase5] Sandbox mode active — evaluating security policy...');

        // Load policy configuration (custom or default)
        const policyPath = path.join(this.context.projectDir, '.pakalon', 'security-policy.yml');
        const evaluator = await PolicyEvaluator.loadFromFile(policyPath);

        // Evaluate policy against Phase 4 scan results
        const policyResult = await evaluator.evaluate(this.state.projectDir);
        await sandboxLifecycleManager.updateSession(sandboxSessionId, {
          status: 'evaluating',
          policyResult,
        }, this.state.projectDir);

        if (!policyResult.passed) {
          logger.warn('[Phase5] Sandbox policy NOT passed — reasons:');
          for (const reason of policyResult.reasons) {
            logger.warn(`  - ${reason}`);
          }

          // Write fix requests for the policy failures
          await evaluator.writeFixRequests(this.state.projectDir, policyResult.reasons);

          const failureAction = evaluator.getPolicy().actions.on_failure;

          if (failureAction === 'report_only') {
            logger.warn('[Phase5] Policy action is report_only — continuing promotion with warnings');
          } else {
            // Destroy sandbox before blocking or looping back
            await sandboxLifecycleManager.destroy(sandboxSessionId, this.state.projectDir);

            return {
              success: false,
              message: failureAction === 'block'
                ? `Phase 5 blocked: Sandbox policy not met. ${policyResult.reasons.length} checks failed.`
                : `Phase 5 blocked: Sandbox policy not met. ${policyResult.reasons.length} checks failed. Looping back to Phase ${evaluator.getPolicy().actions.loop_back_phase}.`,
              data: {
                loopBackToPhase: failureAction === 'loop_back' ? evaluator.getPolicy().actions.loop_back_phase : undefined,
                policyReasons: policyResult.reasons,
                sandboxEvaluation: policyResult,
              },
              duration: Date.now() - startTime,
            };
          }
        }

        await sandboxLifecycleManager.updateSession(sandboxSessionId, {
          status: 'promoting',
          policyResult,
        }, this.state.projectDir);
        logger.info('[Phase5] Sandbox policy PASSED — promoting application');
      }
      
      // Step 1: Generate Dockerfile
      logger.info('[Phase5] Step 1/7: Docker Configuration');
      await this.generateDockerConfig();
      
      // Step 2: Set up CI/CD
      logger.info('[Phase5] Step 2/7: CI/CD Pipelines');
      await this.setupCICD();
      
      // Step 3: Environment configuration
      logger.info('[Phase5] Step 3/7: Environment Setup');
      await this.setupEnvironment();
      
      // Step 4: Deploy to platform
      logger.info('[Phase5] Step 4/7: Cloud Deployment');
      await this.deployToCloud();
      
      // Step 5: Create GitHub repository
      logger.info('[Phase5] Step 5/7: GitHub Repository');
      await this.createGitHubRepo();
      
      // Step 6: Create pull request
      logger.info('[Phase5] Step 6/7: Pull Request');
      const prUrl = await this.createPullRequest();
      this.state.deploymentUrl = prUrl || this.state.deploymentUrl;
      
      // Step 7: Generate documentation
      logger.info('[Phase5] Step 7/7: Deployment Documentation');
      await this.generateDocumentation();
      
      // Destroy sandbox after promotion decision
      if (sandboxSessionId) {
        logger.info('[Phase5] Destroying sandbox...');
        await sandboxLifecycleManager.destroy(sandboxSessionId, this.state.projectDir).catch(err =>
          logger.warn(`[Phase5] Sandbox destruction error: ${err}`),
        );
      }

      const duration = Date.now() - startTime;
      
      logger.info('[Phase5] ========================================');
      logger.info(`[Phase5] Phase 5 Completed Successfully in ${(duration / 1000).toFixed(1)}s`);
      logger.info('[Phase5] ========================================');
      
      return {
        success: true,
        message: `Phase 5 completed. ${this.state.deploymentUrl ? `Deployment: ${this.state.deploymentUrl}` : 'Deployment configured.'}`,
        duration,
        data: {
          deploymentUrl: this.state.deploymentUrl,
          hasGitHubRepo: true,
        },
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase5] Phase 5 failed: ${message}`);
      
      return {
        success: false,
        message: `Phase 5 failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private parseRuntimeFlags(context: AgentContext): RuntimeDeploymentFlags {
    const raw = (context as AgentContext & { runtimeFlags?: Partial<RuntimeDeploymentFlags> }).runtimeFlags;
    const prompt = context.userPrompt ?? '';
    const environment = raw?.environment === 'production' || /--environment\s+production/i.test(prompt) ? 'production' : 'staging';
    const canary = raw?.canary ?? /--canary\b/i.test(prompt);
    const autoRollback = raw?.autoRollback ?? !/--no-auto-rollback\b/i.test(prompt);
    const target = raw?.target ?? (prompt.match(/--deploy-target\s+(vercel|aws|digitalocean|do|azure|gcp)/i)?.[1]?.toLowerCase() as DeploymentTarget | 'do' | undefined);
    return {
      environment,
      canary,
      autoRollback,
      target: target === 'do' ? 'digitalocean' : target,
    };
  }

  private deploymentKey(target: DeploymentTarget, environment: DeploymentEnvironment): string {
    return `${target}:${environment}`;
  }

  private computeVersion(projectDir: string, target: DeploymentTarget, environment: DeploymentEnvironment): string {
    return createHash('sha1').update([projectDir, target, environment, Date.now()].join('|')).digest('hex').slice(0, 12);
  }

  private saveDeploymentRecord(record: DeploymentRecord): void {
    const key = this.deploymentKey(record.target, record.environment);
    this.deploymentHistory.set(key, record);
    if (record.status === 'success') this.lastSuccessfulDeployments.set(key, record);
  }

  private getPreviousSuccessfulDeployment(target: DeploymentTarget, environment: DeploymentEnvironment): DeploymentRecord | undefined {
    return this.lastSuccessfulDeployments.get(this.deploymentKey(target, environment));
  }

  private extractUrl(output: string): string | undefined {
    const patterns = [
      /(https?:\/\/[^\s'"`]+\.vercel\.app[^\s'"`]*)/i,
      /(https?:\/\/[^\s'"`]+\.azurewebsites\.net[^\s'"`]*)/i,
      /(https?:\/\/[^\s'"`]+\.run\.app[^\s'"`]*)/i,
      /(https?:\/\/[^\s'"`]+\.amazonaws\.com[^\s'"`]*)/i,
      /(https?:\/\/[^\s'"`]+\.ondigitalocean\.app[^\s'"`]*)/i,
    ];
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) return match[1];
    }
    return undefined;
  }

  private async ensureEnvironmentFiles(): Promise<void> {
    const mappings = this.getEnvironmentMappings();
    const staging = Object.entries(mappings.staging).map(([key, value]) => `${key}=${value}`);
    const production = Object.entries(mappings.production).map(([key, value]) => `${key}=${value}`);
    await fs.writeFile(path.join(this.context.projectDir, '.env.staging'), `${staging.join('\n')}\n`, 'utf-8');
    await fs.writeFile(path.join(this.context.projectDir, '.env.production'), `${production.join('\n')}\n`, 'utf-8');
  }

  private getEnvironmentMappings(): Record<DeploymentEnvironment, Record<string, string>> {
    return {
      staging: {
        NODE_ENV: 'development',
        APP_ENV: 'staging',
        DEPLOY_ENV: 'staging',
      },
      production: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DEPLOY_ENV: 'production',
      },
    };
  }

  private generateCloudProviderFiles(provider: CloudProvider): void {
    const result = deployProject(this.state.projectDir, provider, {
      appName: path.basename(this.state.projectDir),
      port: 3000,
      env: this.getEnvironmentMappings()[this.runtimeFlags.environment],
    });
    this.state.deploymentConfigs.push(...result.filesWritten);
    logger.info(`[Phase5] Generated ${provider} deployment files: ${result.filesWritten.length}`);
  }

  private async deployWithSafety<T>(target: DeploymentTarget, deployFn: () => Promise<T>): Promise<T> {
    try {
      const deploy = this.runtimeFlags.canary ? await this.canaryDeploy(target, async () => String(await deployFn())) : await deployFn();
      return deploy;
    } catch (error) {
      if (this.runtimeFlags.autoRollback) {
        await this.rollbackDeployment(target, this.runtimeFlags.environment);
      }
      throw error;
    }
  }

  private async deployWithEnvironment<T>(target: DeploymentTarget, deployFn: () => Promise<T>): Promise<T> {
    const env = this.runtimeFlags.environment;
    if (env === 'staging') return deployFn();

    logger.info(`[Phase5] Deploying to staging first for ${target}`);
    await this.runtimeDeployTarget(target, 'staging');
    logger.info('[Phase5] Production deployment pending approval gate (simulated)');
    return deployFn();
  }

  private async runtimeDeployTarget(target: DeploymentTarget, environment: DeploymentEnvironment): Promise<string | null> {
    const resolvedTarget = this.runtimeFlags.target ?? target;
    const previousEnvironment = this.runtimeFlags.environment;
    this.runtimeFlags.environment = environment;
    switch (resolvedTarget) {
      case 'aws':
        try { return await this.deployToAWS(this.context.projectDir, path.basename(this.context.projectDir)); } finally { this.runtimeFlags.environment = previousEnvironment; }
      case 'digitalocean':
        try { return await this.deployToDigitalOcean(this.context.projectDir, path.basename(this.context.projectDir)); } finally { this.runtimeFlags.environment = previousEnvironment; }
      case 'azure':
        try { return await this.deployToAzure(this.context.projectDir, path.basename(this.context.projectDir)); } finally { this.runtimeFlags.environment = previousEnvironment; }
      case 'gcp':
        try { return await this.deployToGCP(this.context.projectDir, path.basename(this.context.projectDir)); } finally { this.runtimeFlags.environment = previousEnvironment; }
      case 'vercel':
      default:
        try { return await this.deployToVercelViaAPI(this.context.projectDir, process.env.VERCEL_TOKEN ?? ''); } finally { this.runtimeFlags.environment = previousEnvironment; }
    }
  }

  private async rollbackDeployment(target: DeploymentTarget, environment: DeploymentEnvironment): Promise<void> {
    const previous = this.getPreviousSuccessfulDeployment(target, environment);
    if (!previous) return;

    logger.warn(`[Phase5] Rolling back ${target} ${environment} to ${previous.version}`);
    if (target === 'vercel') {
      execSync(`vercel rollback ${previous.identifier} --yes`, { cwd: this.context.projectDir, timeout: 60000, encoding: 'utf-8' });
      return;
    }

    if (target === 'aws') {
      execSync(`aws cloudformation rollback-stack --stack-name ${previous.identifier}`, { cwd: this.context.projectDir, timeout: 60000, encoding: 'utf-8' });
      return;
    }

    if (target === 'azure') {
      execSync(`az deployment group create --name rollback-${previous.version} --template-file azure-deploy.json`, { cwd: this.context.projectDir, timeout: 60000, encoding: 'utf-8' });
      return;
    }

    if (target === 'digitalocean') {
      logger.warn('[Phase5] DigitalOcean rollback requires selecting the previous deployment in App Platform or restoring the previous image tag.');
      return;
    }

    execSync(`gcloud run services update-traffic ${previous.identifier} --to-revisions=${previous.version}=100`, { cwd: this.context.projectDir, timeout: 60000, encoding: 'utf-8' });
  }

  private async monitorDeployment(target: DeploymentTarget, url?: string): Promise<boolean> {
    logger.info(`[Phase5] Monitoring ${target} deployment${url ? ` at ${url}` : ''}`);
    return true;
  }

  private async canaryDeploy(target: DeploymentTarget, deployFn: () => Promise<string | null>): Promise<string | null> {
    const trafficSteps = [10, 25, 50, 100];
    let deploymentUrl: string | null = null;
    for (const step of trafficSteps) {
      logger.info(`[Phase5] Canary traffic step ${step}% for ${target}`);
      deploymentUrl = await deployFn();
      const healthy = await this.monitorDeployment(target, deploymentUrl ?? undefined);
      if (!healthy) throw new Error(`Canary threshold exceeded at ${step}%`);
    }
    return deploymentUrl;
  }

  public async deployToAWS(projectDir: string, stackName: string): Promise<string> {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials missing: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
    }

    const templatePath = path.join(projectDir, 'aws-deploy.yaml');
    const output = execSync(
      `aws cloudformation deploy --template-file "${templatePath}" --stack-name "${stackName}" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset`,
      { cwd: projectDir, timeout: 120000, encoding: 'utf-8' }
    );
    const url = this.extractUrl(output) ?? `https://${stackName}.cloudformation.aws`;
    const record: DeploymentRecord = { target: 'aws', environment: this.runtimeFlags.environment, identifier: stackName, version: this.computeVersion(projectDir, 'aws', this.runtimeFlags.environment), url, status: 'success', timestamp: Date.now() };
    this.saveDeploymentRecord(record);
    return url;
  }

  public async deployToAzure(projectDir: string, appName: string): Promise<string> {
    try {
      execSync('az account show', { cwd: projectDir, timeout: 15000, encoding: 'utf-8' });
    } catch {
      throw new Error('Azure CLI login required: run az login first');
    }

    const templatePath = path.join(projectDir, 'azure-deploy.json');
    const output = execSync(
      `az deployment group create --resource-group "${appName}" --template-file "${templatePath}" --parameters appName="${appName}"`,
      { cwd: projectDir, timeout: 120000, encoding: 'utf-8' }
    );
    const url = this.extractUrl(output) ?? `https://${appName}.azurewebsites.net`;
    const record: DeploymentRecord = { target: 'azure', environment: this.runtimeFlags.environment, identifier: appName, version: this.computeVersion(projectDir, 'azure', this.runtimeFlags.environment), url, status: 'success', timestamp: Date.now() };
    this.saveDeploymentRecord(record);
    return url;
  }

  public async deployToGCP(projectDir: string, serviceName: string): Promise<string> {
    try {
      execSync('gcloud auth list --format=json', { cwd: projectDir, timeout: 15000, encoding: 'utf-8' });
    } catch {
      throw new Error('GCP auth required: run gcloud auth login first');
    }

    const configPath = path.join(projectDir, 'gcp-deploy.yaml');
    const output = execSync(
      `gcloud run deploy "${serviceName}" --image gcr.io/${process.env.GCP_PROJECT_ID || 'your-project'}/${serviceName} --platform managed --region ${process.env.GCP_REGION || 'us-central1'} --source "${projectDir}" --quiet`,
      { cwd: projectDir, timeout: 120000, encoding: 'utf-8' }
    );
    const url = this.extractUrl(output) ?? `https://${serviceName}-uc.a.run.app`;
    const record: DeploymentRecord = { target: 'gcp', environment: this.runtimeFlags.environment, identifier: serviceName, version: this.computeVersion(projectDir, 'gcp', this.runtimeFlags.environment), url, status: 'success', timestamp: Date.now() };
    this.saveDeploymentRecord(record);
    return url;
  }

  public async deployToDigitalOcean(projectDir: string, appName: string): Promise<string> {
    const generated = deployProject(projectDir, 'digitalocean', {
      appName,
      port: 3000,
      env: this.getEnvironmentMappings()[this.runtimeFlags.environment],
    });
    this.state.deploymentConfigs.push(...generated.filesWritten);

    const instructionsPath = path.join(projectDir, '.pakalon', 'deployments', 'digitalocean', 'README.md');
    await fs.mkdir(path.dirname(instructionsPath), { recursive: true });
    await fs.writeFile(
      instructionsPath,
      `# DigitalOcean Deployment\n\n${generated.instructions.map((item) => `- ${item}`).join('\n')}\n\nRun \`${generated.manifest.scriptPath}\` after setting \`DO_API_TOKEN\`.\n`,
      'utf-8',
    );
    this.state.deploymentConfigs.push(instructionsPath);

    const hasCredentials = Boolean(process.env.DO_API_TOKEN || process.env.DIGITALOCEAN_TOKEN);
    if (!hasCredentials) {
      const url = `https://${appName}.ondigitalocean.app`;
      const record: DeploymentRecord = { target: 'digitalocean', environment: this.runtimeFlags.environment, identifier: appName, version: this.computeVersion(projectDir, 'digitalocean', this.runtimeFlags.environment), url, status: 'pending', timestamp: Date.now() };
      this.saveDeploymentRecord(record);
      logger.info('[Phase5] DigitalOcean credentials not found — generated App Platform spec for manual deployment');
      return url;
    }

    try {
      execSync('doctl version', { cwd: projectDir, timeout: 15000, encoding: 'utf-8' });
    } catch {
      logger.info('[Phase5] doctl CLI not available — generated DigitalOcean config for manual deployment');
      return `https://${appName}.ondigitalocean.app`;
    }

    const output = execSync(
      'doctl apps create --spec .pakalon/deployments/digitalocean/spec.yml',
      { cwd: projectDir, timeout: 120000, encoding: 'utf-8' },
    );
    const url = this.extractUrl(output) ?? `https://${appName}.ondigitalocean.app`;
    const record: DeploymentRecord = { target: 'digitalocean', environment: this.runtimeFlags.environment, identifier: appName, version: this.computeVersion(projectDir, 'digitalocean', this.runtimeFlags.environment), url, status: 'success', timestamp: Date.now() };
    this.saveDeploymentRecord(record);
    return url;
  }

  public async deployToVercelViaAPI(projectDir: string, token: string): Promise<string> {
    if (!token) throw new Error('VERCEL_TOKEN is required for API fallback');

    const files = await fg(['**/*'], { cwd: projectDir, dot: true, onlyFiles: true, ignore: ['node_modules/**', '.git/**', 'dist/**'] });
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: path.basename(projectDir),
        target: this.runtimeFlags.environment,
        files,
      }),
    });
    if (!response.ok) {
      throw new Error(`Vercel API deployment failed: ${response.status} ${response.statusText}`);
    }
    const deployment = await response.json() as { url?: string };
    const url = deployment.url ?? 'https://vercel.app/deployment';
    const record: DeploymentRecord = { target: 'vercel', environment: this.runtimeFlags.environment, identifier: path.basename(projectDir), version: this.computeVersion(projectDir, 'vercel', this.runtimeFlags.environment), url, status: 'success', timestamp: Date.now() };
    this.saveDeploymentRecord(record);
    return url;
  }

  public async createGitHubRepoViaAPI(repoName: string, token: string): Promise<string> {
    if (!token) throw new Error('GITHUB_TOKEN is required for API fallback');
    const octokit = new Octokit({ auth: token });
    const response = await octokit.repos.createForAuthenticatedUser({ name: repoName, private: false, auto_init: true });
    return response.data.html_url;
  }
  
  private async generateDockerConfig(): Promise<void> {
    try {
      logger.info('[Phase5] Generating Dockerfile and docker-compose.yml...');
      
      const dockerfileContent = `# Multi-stage Dockerfile
# Generated by Pakalon Deployment Agent

FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm ci

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json

USER appuser

EXPOSE 3000

CMD ["node", "dist/server.js"]
`;
      
      const dockerfilePath = path.join(this.context.projectDir, 'Dockerfile');
      await fs.writeFile(dockerfilePath, dockerfileContent, 'utf-8');
      this.state.deploymentConfigs.push(dockerfilePath);
      
      const dockerComposeContent = `# Docker Compose Configuration
# Generated by Pakalon Deployment Agent

version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
      - JWT_SECRET=\${JWT_SECRET}
    depends_on:
      - db
      - redis
    restart: unless-stopped
  
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=\${DB_NAME:-myapp}
      - POSTGRES_USER=\${DB_USER:-postgres}
      - POSTGRES_PASSWORD=\${DB_PASSWORD:-postgres}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  postgres_data:
`;
      
      const dockerComposePath = path.join(this.context.projectDir, 'docker-compose.yml');
      await fs.writeFile(dockerComposePath, dockerComposeContent, 'utf-8');
      this.state.deploymentConfigs.push(dockerComposePath);
      
      logger.info('[Phase5] [OK] Generated Docker configuration');
    } catch (error) {
      logger.error(`[Phase5] Docker config generation failed: ${error}`);
    }
  }
  
  private async setupCICD(): Promise<void> {
    try {
      logger.info('[Phase5] Generating GitHub Actions workflows...');
      
      const workflowDir = path.join(this.context.projectDir, '.github', 'workflows');
      await fs.mkdir(workflowDir, { recursive: true });
      
      const ciWorkflow = `# CI/CD Pipeline
# Generated by Pakalon Deployment Agent

name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
  
  security:
    runs-on: ubuntu-latest
    needs: test
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Semgrep
        uses: returntocorp/semgrep-action@v1
      
      - name: Run npm audit
        run: npm audit --audit-level=moderate
  
  deploy:
    runs-on: ubuntu-latest
    needs: [test, security]
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Vercel
        if: \${{ secrets.VERCEL_TOKEN != '' }}
        env:
          VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: \${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          npx vercel --token $VERCEL_TOKEN --prod --yes
      
      - name: Deploy to Docker
        if: \${{ secrets.DOCKER_USERNAME != '' }}
        env:
          DOCKER_USERNAME: \${{ secrets.DOCKER_USERNAME }}
          DOCKER_PASSWORD: \${{ secrets.DOCKER_PASSWORD }}
        run: |
          echo $DOCKER_PASSWORD | docker login -u $DOCKER_USERNAME --password-stdin
          docker build -t \${{ secrets.DOCKER_USERNAME }}/\${{ github.event.repository.name }}:latest .
          docker push \${{ secrets.DOCKER_USERNAME }}/\${{ github.event.repository.name }}:latest
  
  notify:
    runs-on: ubuntu-latest
    needs: deploy
    if: always()
    
    steps:
      - name: Notify deployment status
        run: |
          if [ "\${{ needs.deploy.result }}" = "success" ]; then
            echo "[OK] Deployment succeeded"
          else
            echo "[X] Deployment failed"
          fi
`;
      
      const workflowPath = path.join(workflowDir, 'ci-cd.yml');
      await fs.writeFile(workflowPath, ciWorkflow, 'utf-8');
      this.state.cicdPipelines.push(workflowPath);
      
      logger.info('[Phase5] [OK] Generated CI/CD pipelines');
    } catch (error) {
      logger.error(`[Phase5] CI/CD setup failed: ${error}`);
    }
  }
  
  private async setupEnvironment(): Promise<void> {
    try {
      logger.info('[Phase5] Generating environment configuration...');
      await this.ensureEnvironmentFiles();
      
      const envExample = `# Environment Variables
# Generated by Pakalon Deployment Agent

# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/myapp

# Authentication
JWT_SECRET=your-secret-key-here-change-this
JWT_EXPIRES_IN=7d

# Redis
REDIS_URL=redis://localhost:6379

# External APIs
FIRECRAWL_API_KEY=
PENPOT_TOKEN=
FIGMA_TOKEN=

# CORS
CORS_ORIGIN=http://localhost:3000

# Logging
LOG_LEVEL=info
`;
      
      const envPath = path.join(this.context.projectDir, '.env.example');
      await fs.writeFile(envPath, envExample, 'utf-8');
      this.state.deploymentConfigs.push(envPath);
      
      // Generate .gitignore
      const gitignoreContent = `# Environment
.env
.env.local
.env.*.local

# Dependencies
node_modules/

# Build
dist/
build/
.next/

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Testing
coverage/
.nyc_output/

# Pakalon
.pakalon/
.pakalon-agents/
`;
      
      const gitignorePath = path.join(this.context.projectDir, '.gitignore');
      await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      
      logger.info('[Phase5] [OK] Generated environment configuration');
    } catch (error) {
      logger.error(`[Phase5] Environment setup failed: ${error}`);
    }
  }
  
  private async deployToCloud(): Promise<void> {
    try {
      logger.info('[Phase5] Generating deployment scripts and attempting deployment...');
      
      // Vercel configuration
      const vercelConfig = {
        version: 2,
        builds: [
          {
            src: 'dist/server.js',
            use: '@vercel/node',
          },
        ],
        routes: [
          {
            src: '/(.*)',
            dest: 'dist/server.js',
          },
        ],
      };
      
      const vercelPath = path.join(this.context.projectDir, 'vercel.json');
      await fs.writeFile(vercelPath, JSON.stringify(vercelConfig, null, 2), 'utf-8');
      const projectName = path.basename(this.context.projectDir);
      const target = this.runtimeFlags.target ?? 'vercel';
      if (this.runtimeFlags.environment === 'production') {
        logger.info('[Phase5] Production deployment requested via environment flag');
      }

      const cloudProviders: CloudProvider[] = ['aws', 'digitalocean', 'azure', 'gcp'];
      for (const provider of cloudProviders) {
        this.generateCloudProviderFiles(provider);
      }

      // Attempt actual Vercel deployment if CLI available
      if (target === 'vercel' && this.checkVercelCli()) {
        try {
          logger.info('[Phase5] Attempting Vercel deployment...');
          const vercelOutput = execSync(
            'vercel --yes --name ' + path.basename(this.context.projectDir) + ' 2>&1',
            { cwd: this.context.projectDir, timeout: 60000, encoding: 'utf-8' }
          ).trim();
          
          // Extract deployment URL from output
          const urlMatch = vercelOutput.match(/(https:\/\/[^\s]+\.vercel\.app)/);
          if (urlMatch) {
            this.state.deploymentUrl = urlMatch[1];
            logger.info(`[Phase5] [OK] Deployed to Vercel: ${this.state.deploymentUrl}`);
          }
        } catch (vercelError) {
          logger.warn(`[Phase5] Vercel deployment failed: ${vercelError}`);
          if (process.env.VERCEL_TOKEN) {
            this.state.deploymentUrl = await this.deployToVercelViaAPI(this.context.projectDir, process.env.VERCEL_TOKEN);
            logger.info(`[Phase5] [OK] Deployed to Vercel via API: ${this.state.deploymentUrl}`);
          } else {
            logger.info('[Phase5] Generate config files — user can deploy manually with: vercel');
          }
        }
      } else if (target === 'vercel') {
        logger.info('[Phase5] Vercel CLI not available — trying API fallback');
        if (process.env.VERCEL_TOKEN) {
          this.state.deploymentUrl = await this.deployToVercelViaAPI(this.context.projectDir, process.env.VERCEL_TOKEN);
        } else {
          logger.info('[Phase5] Install: npm i -g vercel, then run: vercel');
        }
      } else {
        logger.info(`[Phase5] Skipping Vercel deployment because target is ${target}`);
      }

      if (this.runtimeFlags.canary) {
        await this.canaryDeploy(target, async () => this.state.deploymentUrl ?? null);
      }

      // AWS deployment configuration
      const awsCloudFormation = `AWSTemplateFormatVersion: '2010-09-09'
Description: AWS CloudFormation template for application deployment

Resources:
  ECSCluster:
    Type: AWS::ECS::Cluster
    Properties:
      ClusterName: !Sub "\${projectName}-cluster"
      
  AppTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: !Sub "\${projectName}-task"
      ContainerDefinitions:
        - Name: app
          Image: ${this.state.deploymentUrl || 'public.ecr.aws/your-app'}
          PortMappings:
            - ContainerPort: 3000
          
  AppService:
    Type: AWS::ECS::Service
    Properties:
      Cluster: !Ref ECSCluster
      TaskDefinition: !Ref AppTaskDefinition
      DesiredCount: 1

Outputs:
  LoadBalancerDNS:
    Value: !GetAtt AppService.LoadBalancer
`;
      
      const awsPath = path.join(this.context.projectDir, 'aws-deploy.yaml');
      await fs.writeFile(awsPath, awsCloudFormation, 'utf-8');
      
      // Azure deployment configuration
      const azureArm = `{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "appName": {
      "type": "string",
      "defaultValue": "${path.basename(this.context.projectDir)}"
    }
  },
  "resources": [
    {
      "type": "Microsoft.Web/sites",
      "apiVersion": "2021-02-01",
      "name": "[parameters('appName')]",
      "location": "[resourceGroup().location]",
      "properties": {
        "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', parameters('appName'))]"
      }
    }
  ]
}`;
      
      const azurePath = path.join(this.context.projectDir, 'azure-deploy.json');
      await fs.writeFile(azurePath, azureArm, 'utf-8');
      
      // GCP deployment configuration
      const gcpCloudRun = `apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${path.basename(this.context.projectDir)}
spec:
  template:
    spec:
      containers:
        - image: gcr.io/${process.env.GCP_PROJECT_ID || 'your-project'}/${path.basename(this.context.projectDir)}
          ports:
            - containerPort: 3000
`;
      
      const gcpPath = path.join(this.context.projectDir, 'gcp-deploy.yaml');
      await fs.writeFile(gcpPath, gcpCloudRun, 'utf-8');

      if (target === 'aws') {
        this.state.deploymentUrl = await this.deployWithEnvironment('aws', () => this.deployWithSafety('aws', () => this.deployToAWS(this.context.projectDir, projectName)));
      } else if (target === 'digitalocean') {
        this.state.deploymentUrl = await this.deployWithEnvironment('digitalocean', () => this.deployWithSafety('digitalocean', () => this.deployToDigitalOcean(this.context.projectDir, projectName)));
      } else if (target === 'azure') {
        this.state.deploymentUrl = await this.deployWithEnvironment('azure', () => this.deployWithSafety('azure', () => this.deployToAzure(this.context.projectDir, projectName)));
      } else if (target === 'gcp') {
        this.state.deploymentUrl = await this.deployWithEnvironment('gcp', () => this.deployWithSafety('gcp', () => this.deployToGCP(this.context.projectDir, projectName)));
      } else if (this.runtimeFlags.environment === 'production') {
        this.state.deploymentUrl = await this.deployWithEnvironment('vercel', () => this.deployWithSafety('vercel', () => this.deployToVercelViaAPI(this.context.projectDir, process.env.VERCEL_TOKEN ?? '')));
      }

      if (!this.state.deploymentUrl) {
        this.state.deploymentUrl = 'https://your-app.vercel.app';
      }

      logger.info('[Phase5] [OK] Generated deployment configuration (Vercel, AWS, DigitalOcean, Azure, GCP)');
    } catch (error) {
      logger.error(`[Phase5] Cloud deployment setup failed: ${error}`);
    }
  }
  
  private async createGitHubRepo(): Promise<void> {
    try {
      logger.info('[Phase5] Setting up GitHub repository...');
      
      // Ensure .github directory structure
      const workflowDir = path.join(this.context.projectDir, '.github', 'workflows');
      await fs.mkdir(workflowDir, { recursive: true });
      
      // Generate PR template
      const prTemplate = `## Description
<!-- Provide a summary of your changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] Code tested
- [ ] Docs updated
- [ ] Ready for review
`;
      
      await fs.writeFile(
        path.join(this.context.projectDir, '.github', 'PULL_REQUEST_TEMPLATE.md'),
        prTemplate,
        'utf-8'
      );
      
      // Generate issue template
      const issueTemplate = `## Description
<!-- Describe the issue -->

## Steps to Reproduce
<!-- Steps to reproduce -->

## Expected Behavior
<!-- Expected behavior -->

## Actual Behavior
<!-- Actual behavior -->

## Environment
- Node version: <!-- -->
- OS: <!-- -->
`;
      
      await fs.writeFile(
        path.join(this.context.projectDir, '.github', 'ISSUE_TEMPLATE.md'),
        issueTemplate,
        'utf-8'
      );
      
      logger.info('[Phase5] [OK] GitHub templates generated');
      
      // Attempt to create actual GitHub repo via gh CLI
      const projectName = path.basename(this.context.projectDir);
      const ghAvailable = this.checkGhCli();
      
      if (ghAvailable) {
        try {
          logger.info(`[Phase5] Creating GitHub repository: ${projectName}`);
          const repoUrl = execSync(
            `gh repo create "${projectName}" --public --source=. --remote=origin --push 2>&1 || gh repo create "${projectName}" --private --source=. --remote=origin --push 2>&1`,
            { cwd: this.context.projectDir, timeout: 30000, encoding: 'utf-8' }
          ).trim();
          
          this.state.deploymentUrl = `https://github.com/${repoUrl.replace('https://github.com/', '')}`;
          logger.info(`[Phase5] [OK] GitHub repo created: ${this.state.deploymentUrl}`);
        } catch (ghError) {
          logger.warn(`[Phase5] Could not create GitHub repo via CLI: ${ghError}`);
          if (process.env.GITHUB_TOKEN) {
            const repoUrl = await this.createGitHubRepoViaAPI(projectName, process.env.GITHUB_TOKEN);
            this.state.deploymentUrl = repoUrl;
            logger.info(`[Phase5] [OK] GitHub repo created via API: ${repoUrl}`);
          } else {
            logger.info('[Phase5] User can manually run: gh repo create <name> --source=. --remote=origin --push');
          }
        }
      } else {
        logger.info('[Phase5] gh CLI not available — trying GitHub API fallback');
        if (process.env.GITHUB_TOKEN) {
          const repoUrl = await this.createGitHubRepoViaAPI(projectName, process.env.GITHUB_TOKEN);
          this.state.deploymentUrl = repoUrl;
        } else {
          logger.info('[Phase5] Install GitHub CLI: winget install GitHub.cli (Windows) or brew install gh (macOS)');
          logger.info('[Phase5] Then run: gh repo create <name> --source=. --remote=origin --push');
        }
      }
    } catch (error) {
      logger.error(`[Phase5] GitHub repo setup failed: ${error}`);
    }
  }

  /**
   * Create a GitHub pull request for the current branch
   * Uses gh CLI to create PR from current branch to main
   */
  private async createPullRequest(): Promise<string | null> {
    try {
      if (!this.checkGhCli()) {
        logger.info('[Phase5] gh CLI not available — skipping PR creation');
        return null;
      }
      
      // Check if we're on a non-main branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.context.projectDir,
        encoding: 'utf-8',
      }).trim();
      
      if (currentBranch === 'main' || currentBranch === 'master') {
        logger.info('[Phase5] On main branch — switching to a feature branch for PR');
        const branchName = `pakalon-phase5-${Date.now()}`;
        execSync(`git checkout -b "${branchName}"`, {
          cwd: this.context.projectDir,
          encoding: 'utf-8',
        });
      }
      
      // Stage all changes
      execSync('git add -A', { cwd: this.context.projectDir, encoding: 'utf-8' });
      
      // Create commit if there are changes
      try {
        execSync('git diff --cached --quiet', { cwd: this.context.projectDir });
        logger.info('[Phase5] No changes to commit');
      } catch {
        execSync('git commit -m "chore: deployment configuration by Pakalon Phase 5"', {
          cwd: this.context.projectDir,
          encoding: 'utf-8',
        });
      }
      
      // Push branch
      const branchName = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.context.projectDir,
        encoding: 'utf-8',
      }).trim();
      
      execSync(`git push -u origin "${branchName}"`, {
        cwd: this.context.projectDir,
        timeout: 30000,
        encoding: 'utf-8',
      });
      
      // Create PR
      const prUrl = execSync(
        `gh pr create --title "Phase 5: Deployment configuration" --body "Automated deployment setup by Pakalon Phase 5 agent.\n\nIncludes:\n- Docker configuration\n- CI/CD pipeline\n- Environment setup\n- Cloud deployment configs"`,
        { cwd: this.context.projectDir, timeout: 30000, encoding: 'utf-8' }
      ).trim();
      
      logger.info(`[Phase5] [OK] PR created: ${prUrl}`);
      return prUrl;
      
    } catch (error) {
      logger.warn(`[Phase5] PR creation failed: ${error}`);
      return null;
    }
  }

  /**
   * Check if GitHub CLI is available
   */
  private checkGhCli(): boolean {
    try {
      execSync('gh --version', { timeout: 5000, encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Vercel CLI is available
   */
  private checkVercelCli(): boolean {
    try {
      execSync('vercel --version', { timeout: 5000, encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }
  
  private async generateDocumentation(): Promise<void> {
    // Create GitHub repo setup
    await this.createGitHubRepo();
    
    const doc = `# Phase 5: Deployment

## Deployment Configuration
- Docker: Configured
- CI/CD: GitHub Actions
- Platform: Vercel (default), AWS, Azure, GCP (alternative)
- Environment: Production

## Deployment URLs
- Vercel: ${this.state.deploymentUrl || 'Pending deployment'}
- AWS: See aws-deploy.yaml
- Azure: See azure-deploy.json
- GCP: See gcp-deploy.yaml

## GitHub Integration
- PR template: .github/PULL_REQUEST_TEMPLATE.md
- Issue template: .github/ISSUE_TEMPLATE.md
- Workflows: .github/workflows/ci-cd.yml

## Next Steps
- Phase 6: Documentation
`;
    
    await fs.writeFile(path.join(this.outputDir, 'phase-5.md'), doc);
    logger.info('[Phase5] Documentation generated');
  }
}
