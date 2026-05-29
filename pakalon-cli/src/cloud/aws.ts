import { sanitizeName, type CloudDeploymentOptions, type CloudProvider, type DeploymentManifest, renderJson, resolveAppName } from './types.js'

function toEcsCpuUnits(cpu?: number): string {
  const normalized = Math.max(0.25, cpu ?? 0.5)
  if (normalized <= 0.25) return '256'
  if (normalized <= 0.5) return '512'
  if (normalized <= 1) return '1024'
  if (normalized <= 2) return '2048'
  if (normalized <= 4) return '4096'
  return `${Math.round(normalized * 1024)}`
}

export function validateCredentials(provider: CloudProvider): boolean {
  void provider
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_SHARED_CREDENTIALS_FILE,
  )
}

export function generateDeployScript(provider: CloudProvider): string {
  void provider
  return `#!/usr/bin/env bash
set -euo pipefail

APP_NAME="\${APP_NAME:-app}"
AWS_REGION="\${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="\${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID}"
ECR_REPOSITORY="\${ECR_REPOSITORY:-\${APP_NAME}}"
IMAGE_TAG="\${IMAGE_TAG:-latest}"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
docker build -t "$APP_NAME" .
docker tag "$APP_NAME" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG"
aws ecs register-task-definition --cli-input-json file://.pakalon/deployments/aws/task-definition.json
aws ecs update-service --cluster "\${AWS_ECS_CLUSTER:?set AWS_ECS_CLUSTER}" --service "\${AWS_ECS_SERVICE:?set AWS_ECS_SERVICE}" --force-new-deployment
`
}

export function generateDeploymentConfig(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentManifest {
  const appName = resolveAppName(projectDir, options.appName)
  const region = options.region ?? 'us-east-1'
  const image = options.image ?? `ghcr.io/${appName}:latest`
  const port = options.port ?? 8000
  const env = options.env ?? { NODE_ENV: 'production' }
  const script = generateDeployScript(provider)
  const taskDefinition = {
    family: sanitizeName(appName),
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: toEcsCpuUnits(options.cpu),
    memory: `${Math.max(512, options.memoryMb ?? 1024)}`,
    executionRoleArn: 'arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskExecutionRole',
    taskRoleArn: 'arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskRole',
    containerDefinitions: [
      {
        name: appName,
        image,
        essential: true,
        portMappings: [{ containerPort: port, hostPort: port, protocol: 'tcp' }],
        environment: Object.entries(env).map(([name, value]) => ({ name, value })),
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/ecs/${appName}`,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'ecs',
          },
        },
      },
    ],
  }

  const workflow = `name: Deploy AWS ECS
on:
  push:
    branches: [${JSON.stringify(options.branch ?? 'main')}]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${region}
      - run: bash .pakalon/deployments/aws/deploy.sh
`

  return {
    provider,
    projectDir,
    appName,
    estimatedMonthlyCostUsd: 29.5,
    requiredCredentials: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    scriptPath: '.pakalon/deployments/aws/deploy.sh',
    instructions: [
      `Push the image to ${image}.`,
      'Provision an ECS cluster, task role, and service using the generated task definition.',
      `Set AWS_REGION to ${region} and configure the GitHub secrets referenced in the workflow.`,
    ],
    files: [
      { path: '.pakalon/deployments/aws/task-definition.json', content: renderJson(taskDefinition) },
      { path: '.pakalon/deployments/aws/deploy.sh', content: script, executable: true },
      { path: '.github/workflows/aws-deploy.yml', content: workflow },
    ],
  }
}
