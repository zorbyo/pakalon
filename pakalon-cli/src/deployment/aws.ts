/**
 * Phase 5 — AWS Deployment Module
 *
 * Generates AWS CDK / CloudFormation stacks and deployment scripts
 * for the Pakalon backend and related services.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface AwsDeploymentOptions {
  outputDir: string;
  region?: string;
  stackName?: string;
  domain?: string;
  database?: "aurora" | "rds" | "sqlite";
  useCdk?: boolean;
  enableAutoScaling?: boolean;
}

export interface AwsDeploymentResult {
  filesCreated: string[];
  stackName: string;
  region: string;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_STACK = "PakalonStack";

/**
 * Generate the full AWS deployment scaffold.
 */
export async function generateAwsDeployment(opts: AwsDeploymentOptions): Promise<AwsDeploymentResult> {
  const region = opts.region ?? DEFAULT_REGION;
  const stackName = opts.stackName ?? DEFAULT_STACK;
  const dir = path.join(opts.outputDir, "deployment", "aws");
  const files: string[] = [];

  await fs.mkdir(dir, { recursive: true });

  // CDK stack (or CloudFormation if useCdk === false)
  if (opts.useCdk !== false) {
    // cdk.json
    await fs.writeFile(
      path.join(dir, "cdk.json"),
      JSON.stringify(
        {
          app: "npx ts-node bin/pakalon-stack.ts",
          watch: { include: ["bin/**", "lib/**"] },
          context: { "@aws-cdk/core:bootstrapQualifier": "pakalon" },
        },
        null,
        2,
      ),
      "utf-8",
    );
    files.push("cdk.json");

    // bin/pakalon-stack.ts
    await fs.writeFile(
      path.join(dir, "bin", "pakalon-stack.ts"),
      `#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { PakalonStack } from "../lib/pakalon-stack";

const app = new cdk.App();
new PakalonStack(app, "${stackName}", {
  env: {
    region: "${region}",
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: "Pakalon backend deployment (Phase 5)",
});
`,
      "utf-8",
    );
    files.push("bin/pakalon-stack.ts");

    // lib/pakalon-stack.ts
    await fs.writeFile(
      path.join(dir, "lib", "pakalon-stack.ts"),
      `import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface PakalonStackProps extends cdk.StackProps {
  dbInstanceClass?: string;
  desiredCount?: number;
}

export class PakalonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PakalonStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "PakalonVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, "PakalonCluster", { vpc });

    // Database
    const dbInstance = new rds.DatabaseInstance(this, "PakalonDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      multiAz: false,
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task definition
    const taskDef = new ecs.FargateTaskDefinition(this, "PakalonTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    taskDef.addContainer("PakalonContainer", {
      image: ecs.ContainerImage.fromAsset("."),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "Pakalon" }),
      environment: {
        DATABASE_URL: dbInstance.dbInstanceEndpointAddress,
        REGION: "${region}",
      },
      secrets: {
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
          new secrets.Secret(this, "DbPassword"),
        ),
      },
    });

    new ecs.FargateService(this, "PakalonService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: props?.desiredCount ?? 1,
    });
  }
}
`,
      "utf-8",
    );
    files.push("lib/pakalon-stack.ts");

    // package.json
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "pakalon-aws",
          version: "1.0.0",
          scripts: {
            cdk: "cdk",
            deploy: "cdk deploy",
            synth: "cdk synth",
            diff: "cdk diff",
            destroy: "cdk destroy",
          },
          dependencies: {
            "aws-cdk-lib": "^2.150.0",
            constructs: "^10.3.0",
          },
          devDependencies: {
            "aws-cdk": "^2.150.0",
            "ts-node": "^10.9.2",
            typescript: "^5.5.0",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    files.push("package.json");
  }

  // Dockerfile for AWS ECS
  await fs.writeFile(
    path.join(dir, "Dockerfile"),
    `FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8000
CMD ["bun", "run", "dist/index.js"]
`,
    "utf-8",
  );
  files.push("Dockerfile");

  // deploy.sh
  await fs.writeFile(
    path.join(dir, "deploy.sh"),
    `#!/usr/bin/env bash
set -euo pipefail

REGION="${region}"
STACK="${stackName}"

echo "=== AWS Deployment ==="
echo "Region: $REGION"
echo "Stack:  $STACK"
echo ""

# Bootstrap CDK (first time only)
npx cdk bootstrap aws://\$(aws sts get-caller-identity --query Account --output text)/\$REGION

# Deploy
npx cdk deploy --region \$REGION

echo ""
echo "=== Done ==="
echo "Stack: $STACK"
echo "Region: $REGION"
`,
    "utf-8",
  );
  files.push("deploy.sh");

  return { filesCreated: files, stackName, region };
}