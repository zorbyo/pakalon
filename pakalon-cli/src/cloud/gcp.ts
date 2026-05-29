import { type CloudDeploymentOptions, type CloudProvider, type DeploymentManifest, renderJson, resolveAppName } from './types.js'

export function validateCredentials(provider: CloudProvider): boolean {
  void provider
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GCP_SERVICE_ACCOUNT_KEY ||
      process.env.GCLOUD_PROJECT,
  )
}

export function generateDeployScript(provider: CloudProvider): string {
  void provider
  return `#!/usr/bin/env bash
set -euo pipefail

gcloud auth login
gcloud config set project \"${'${GCP_PROJECT:?set GCP_PROJECT}'}\"
gcloud run deploy \"${'${APP_NAME:-app}'}\" --source . --region \"${'${GCP_REGION:-us-central1}'}\" --allow-unauthenticated
`
}

export function generateDeploymentConfig(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentManifest {
  const appName = resolveAppName(projectDir, options.appName)
  const region = options.region ?? 'us-central1'
  const image = options.image ?? `ghcr.io/${appName}:latest`
  const port = options.port ?? 8080
  const env = options.env ?? { NODE_ENV: 'production' }
  const script = generateDeployScript(provider)

  const cloudRunService = {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: { name: appName, annotations: { 'run.googleapis.com/launch-stage': 'BETA' } },
    spec: {
      template: {
        spec: {
          containers: [
            {
              image,
              ports: [{ containerPort: port }],
              env: Object.entries(env).map(([name, value]) => ({ name, value })),
            },
          ],
        },
      },
    },
  }

  const appEngine = `runtime: nodejs20\nservice: ${appName}\ninstance_class: F1\nhandlers:\n  - url: /.*\n    secure: always\n    script: auto\n`

  return {
    provider,
    projectDir,
    appName,
    estimatedMonthlyCostUsd: 18,
    requiredCredentials: ['GOOGLE_APPLICATION_CREDENTIALS', 'GCLOUD_PROJECT'],
    scriptPath: '.pakalon/deployments/gcp/deploy.sh',
    instructions: [
      `Deploy Cloud Run in ${region} with image ${image}.`,
      'Optional App Engine fallback is provided for simpler node workloads.',
      'Run gcloud auth and set GCP_PROJECT before using the script.',
    ],
    files: [
      { path: '.pakalon/deployments/gcp/service.yaml', content: renderJson(cloudRunService) },
      { path: '.pakalon/deployments/gcp/app.yaml', content: appEngine },
      { path: '.pakalon/deployments/gcp/deploy.sh', content: script, executable: true },
    ],
  }
}
