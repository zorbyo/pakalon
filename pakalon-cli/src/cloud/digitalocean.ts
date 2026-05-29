import { type CloudDeploymentOptions, type CloudProvider, type DeploymentManifest, resolveAppName } from './types.js'

export function validateCredentials(provider: CloudProvider): boolean {
  void provider
  return Boolean(process.env.DO_API_TOKEN || process.env.DIGITALOCEAN_TOKEN)
}

export function generateDeployScript(provider: CloudProvider): string {
  void provider
  return `#!/usr/bin/env bash
set -euo pipefail

APP_NAME=\"${'${APP_NAME:-app}'}\"
doctl auth init -t \"${'${DO_API_TOKEN:?set DO_API_TOKEN}'}\"
doctl apps create --spec .pakalon/deployments/digitalocean/spec.yml
`
}

export function generateDeploymentConfig(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentManifest {
  const appName = resolveAppName(projectDir, options.appName)
  const region = options.region ?? 'nyc'
  const image = options.image ?? `ghcr.io/${appName}:latest`
  const port = options.port ?? 8000
  const env = options.env ?? { NODE_ENV: 'production' }
  const script = generateDeployScript(provider)

  const spec = `name: ${appName}\nregion: ${region}\nservices:\n  - name: ${appName}\n    image:\n      registry_type: GHCR\n      repository: ${image}\n    http_port: ${port}\n    instance_count: 1\n    instance_size_slug: basic-xxs\n    envs:\n${Object.entries(env)
      .map(([key, value]) => `      - key: ${key}\n        value: ${JSON.stringify(value)}`)
      .join('\n')}\n`

  const dropletScript = `#!/usr/bin/env bash\nset -euo pipefail\n\napt-get update\napt-get install -y docker.io git\nsystemctl enable docker\nsystemctl start docker\n`

  return {
    provider,
    projectDir,
    appName,
    estimatedMonthlyCostUsd: 12,
    requiredCredentials: ['DO_API_TOKEN'],
    scriptPath: '.pakalon/deployments/digitalocean/deploy.sh',
    instructions: [
      'Create a DigitalOcean App Platform app from the generated spec.',
      `Use the ${region} region and push the image ${image}.`,
      'For a droplet deployment, run the generated setup script on a fresh Ubuntu host.',
    ],
    files: [
      { path: '.pakalon/deployments/digitalocean/spec.yml', content: spec },
      { path: '.pakalon/deployments/digitalocean/deploy.sh', content: dropletScript, executable: true },
    ],
  }
}
