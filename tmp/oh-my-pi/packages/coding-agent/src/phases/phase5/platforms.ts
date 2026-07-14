/**
 * Per-platform Infrastructure-as-Code emitters for Pakalon Phase 5.
 *
 * Each platform has a small `emit*` function that writes the
 * recommended deployment files into the project root. The user picks
 * one of the options in the TUI; the rest are written as a
 * `platforms/` sub-folder for later use.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type Platform = "aws" | "digitalocean" | "azure" | "gcp" | "vercel" | "netlify" | "self-host" | "none";

export interface EmitOptions {
	projectDir: string;
	projectName: string;
	platform: Platform;
}

export interface EmitResult {
	files: string[];
	summary: string;
}

/**
 * Dispatch to the per-platform emitter. Returns the list of files
 * written plus a one-line summary.
 */
export function emitPlatformIaC(opts: EmitOptions): EmitResult {
	switch (opts.platform) {
		case "aws":
			return emitAws(opts);
		case "digitalocean":
			return emitDigitalOcean(opts);
		case "azure":
			return emitAzure(opts);
		case "gcp":
			return emitGcp(opts);
		case "vercel":
			return emitVercel(opts);
		case "netlify":
			return emitNetlify(opts);
		case "self-host":
			return emitSelfHost(opts);
		case "none":
			return { files: [], summary: "No platform selected — README updated only." };
	}
}

function writeFile(projectDir: string, relPath: string, body: string): string {
	const full = path.join(projectDir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, body, "utf-8");
	return relPath;
}

function emitAws(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/aws/app.ts",
			`// AWS CDK app (TypeScript). Run: \`npx cdk deploy\`
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { PlatformStack } from "./stack";

export class ${toPascal(opts.projectName)}App extends cdk.App {
	constructor() {
		super();
		new PlatformStack(this, "${toPascal(opts.projectName)}Stack");
	}
}
`,
		),
		writeFile(
			opts.projectDir,
			"platforms/aws/stack.ts",
			`// AWS CDK stack — ECS Fargate behind an ALB.
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export class PlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);
		const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2 });
		const cluster = new ecs.Cluster(this, "Cluster", { vpc });
		const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", { cpu: 512, memoryLimitMiB: 1024 });
		taskDef.addContainer("App", { image: ecs.ContainerImage.fromAsset("."), portMappings: [{ containerPort: 3000 }] });
		const service = new ecs.FargateService(this, "Service", { cluster, taskDefinition: taskDef });
		const lb = new elbv2.ApplicationLoadBalancer(this, "LB", { vpc, internetFacing: true });
		const tg = lb.addListener("Listener", { port: 80 }).addTargets("ECS", { port: 3000, targets: [service] });
		new cdk.CfnOutput(this, "URL", { value: tg.urlOutput });
	}
}
`,
		),
		writeFile(
			opts.projectDir,
			"platforms/aws/cdk.json",
			JSON.stringify({ app: "npx ts-node platforms/aws/app.ts" }, null, 2),
		),
	];
	return { files, summary: `AWS CDK stack written (${files.length} files). Run \`cdk deploy\` to provision.` };
}

function emitDigitalOcean(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/digitalocean/app.yaml",
			`# DigitalOcean App Platform spec — \`doctl apps create --spec platforms/digitalocean/app.yaml\`
name: ${opts.projectName}
region: nyc
services:
  - name: web
    github:
      branch: main
      deploy_on_push: true
    source_dir: /
    dockerfile_path: Dockerfile
    http_port: 3000
    instance_count: 1
    instance_size_slug: basic-xxs
    envs:
      - key: NODE_ENV
        value: production
`,
		),
	];
	return { files, summary: "DigitalOcean App Platform spec written." };
}

function emitAzure(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/azure/main.bicep",
			`@description('Container app for ${opts.projectName}')
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
	name: '${opts.projectName}'
	location: resourceGroup().location
	properties: {
		managedEnvironmentId: env.id
		template: {
			containers: [{
				name: 'app'
				image: 'ghcr.io/OWNER/${opts.projectName}:latest'
				resources: { cpu: json('0.5'), memory: '1Gi' }
				env: [{ name: 'NODE_ENV', value: 'production' }]
			}]
		}
	}
}
`,
		),
	];
	return { files, summary: "Azure Container Apps bicep written." };
}

function emitGcp(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/gcp/cloudbuild.yaml",
			`steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/${opts.projectName}:$SHORT_SHA', '.']
  - name: gcr.io/cloud-builders/docker
    args: ['push', 'gcr.io/$PROJECT_ID/${opts.projectName}:$SHORT_SHA']
  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args: ['run', 'deploy', '${opts.projectName}', '--image', 'gcr.io/$PROJECT_ID/${opts.projectName}:$SHORT_SHA', '--region', 'us-central1', '--platform', 'managed', '--allow-unauthenticated']
`,
		),
	];
	return { files, summary: "Google Cloud Build pipeline written." };
}

function emitVercel(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/vercel.json",
			JSON.stringify(
				{
					buildCommand: "bun run build",
					outputDirectory: "dist",
					framework: "nextjs",
					installCommand: "bun install",
				},
				null,
				2,
			),
		),
	];
	return { files, summary: "Vercel project config written." };
}

function emitNetlify(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/netlify.toml",
			`[build]
command = "bun run build"
publish = "dist"

[[headers]]
for = "/*"
[headers.values]
X-Frame-Options = "DENY"
X-Content-Type-Options = "nosniff"
`,
		),
	];
	return { files, summary: "Netlify config written." };
}

function emitSelfHost(opts: EmitOptions): EmitResult {
	const files = [
		writeFile(
			opts.projectDir,
			"platforms/self-host/docker-compose.yml",
			`version: "3.9"
services:
  app:
    build: .
    restart: unless-stopped
    ports: ["3000:3000"]
    env_file: .env
`,
		),
		writeFile(
			opts.projectDir,
			"platforms/self-host/Caddyfile",
			`example.com {
	encode zstd gzip
	reverse_proxy app:3000
}
`,
		),
	];
	return { files, summary: "Self-host docker-compose + Caddy reverse-proxy written." };
}

function toPascal(s: string): string {
	return s
		.replace(/[-_]+/g, " ")
		.split(/\s+/)
		.map(p => p.charAt(0).toUpperCase() + p.slice(1))
		.join("");
}

/** List the platforms supported. */
export const SUPPORTED_PLATFORMS: Platform[] = [
	"aws",
	"digitalocean",
	"azure",
	"gcp",
	"vercel",
	"netlify",
	"self-host",
	"none",
];
