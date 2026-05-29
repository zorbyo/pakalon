import { type CloudDeploymentOptions, type CloudProvider, type DeploymentManifest, renderJson, resolveAppName } from './types.js'

export function validateCredentials(provider: CloudProvider): boolean {
  void provider
  return Boolean(
    process.env.AZURE_CLIENT_ID ||
      process.env.AZURE_CREDENTIALS ||
      (process.env.AZURE_TENANT_ID && process.env.AZURE_SUBSCRIPTION_ID && process.env.AZURE_CLIENT_SECRET),
  )
}

export function generateDeployScript(provider: CloudProvider): string {
  void provider
  return `#!/usr/bin/env bash
set -euo pipefail

az login --use-device-code
az containerapp up --name \"${'${APP_NAME:-app}'}\" --source . --resource-group \"${'${AZURE_RESOURCE_GROUP:?set AZURE_RESOURCE_GROUP}'}\" --location \"${'${AZURE_LOCATION:-eastus}'}\"
`
}

export function generateDeploymentConfig(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentManifest {
  const appName = resolveAppName(projectDir, options.appName)
  const region = options.region ?? 'eastus'
  const image = options.image ?? `ghcr.io/${appName}:latest`
  const port = options.port ?? 8000
  const env = options.env ?? { NODE_ENV: 'production' }
  const script = generateDeployScript(provider)

  const containerApp = {
    location: region,
    properties: {
      configuration: {
        ingress: { external: true, targetPort: port },
        registries: [{ server: 'ghcr.io', identity: 'system' }],
      },
      template: {
        containers: [
          {
            name: appName,
            image,
            env: Object.entries(env).map(([name, value]) => ({ name, value })),
          },
        ],
      },
    },
  }

  const pipeline = `trigger:\n- main\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - checkout: self\n  - task: AzureCLI@2\n    inputs:\n      azureSubscription: \"${'${AZURE_SERVICE_CONNECTION}'}\"\n      scriptType: bash\n      scriptLocation: inlineScript\n      inlineScript: |\n        bash .pakalon/deployments/azure/deploy.sh\n`

  return {
    provider,
    projectDir,
    appName,
    estimatedMonthlyCostUsd: 24,
    requiredCredentials: ['AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'],
    scriptPath: '.pakalon/deployments/azure/deploy.sh',
    instructions: [
      `Deploy the container app in ${region} with image ${image}.`,
      'Create an Azure DevOps service connection named in AZURE_SERVICE_CONNECTION.',
      'Ensure the resource group exists before running the deployment script.',
    ],
    files: [
      { path: '.pakalon/deployments/azure/container-app.json', content: renderJson(containerApp) },
      { path: '.pakalon/deployments/azure/azure-pipelines.yml', content: pipeline },
      { path: '.pakalon/deployments/azure/deploy.sh', content: script, executable: true },
    ],
  }
}
