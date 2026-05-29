import * as fs from 'fs'
import * as path from 'path'
import { type CloudDeploymentOptions, type CloudProvider, type CostEstimateResult, type DeploymentManifest, type ResourceEstimate } from './types.js'
import { generateDeploymentConfig as generateAwsDeploymentConfig, generateDeployScript as generateAwsDeployScript, validateCredentials as validateAwsCredentials } from './aws.js'
import { generateDeploymentConfig as generateAzureDeploymentConfig, generateDeployScript as generateAzureDeployScript, validateCredentials as validateAzureCredentials } from './azure.js'
import { generateDeploymentConfig as generateDigitalOceanDeploymentConfig, generateDeployScript as generateDigitalOceanDeployScript, validateCredentials as validateDigitalOceanCredentials } from './digitalocean.js'
import { generateDeploymentConfig as generateGcpDeploymentConfig, generateDeployScript as generateGcpDeployScript, validateCredentials as validateGcpCredentials } from './gcp.js'

export type { CloudDeploymentOptions, CloudProvider, CostEstimateResult, DeploymentManifest, ResourceEstimate } from './types.js'

export interface DeploymentResult {
  manifest: DeploymentManifest
  filesWritten: string[]
  instructions: string[]
}

export function getCloudProviders(): Array<{ id: CloudProvider; label: string }> {
  return [
    { id: 'aws', label: 'AWS' },
    { id: 'digitalocean', label: 'DigitalOcean' },
    { id: 'azure', label: 'Azure' },
    { id: 'gcp', label: 'GCP' },
  ]
}

export function validateCredentials(provider: CloudProvider): boolean {
  switch (provider) {
    case 'aws':
      return validateAwsCredentials(provider)
    case 'digitalocean':
      return validateDigitalOceanCredentials(provider)
    case 'azure':
      return validateAzureCredentials(provider)
    case 'gcp':
      return validateGcpCredentials(provider)
  }
}

export function generateDeployScript(provider: CloudProvider): string {
  switch (provider) {
    case 'aws':
      return generateAwsDeployScript(provider)
    case 'digitalocean':
      return generateDigitalOceanDeployScript(provider)
    case 'azure':
      return generateAzureDeployScript(provider)
    case 'gcp':
      return generateGcpDeployScript(provider)
  }
}

export function generateDeploymentConfig(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentManifest {
  switch (provider) {
    case 'aws':
      return generateAwsDeploymentConfig(projectDir, provider, options)
    case 'digitalocean':
      return generateDigitalOceanDeploymentConfig(projectDir, provider, options)
    case 'azure':
      return generateAzureDeploymentConfig(projectDir, provider, options)
    case 'gcp':
      return generateGcpDeploymentConfig(projectDir, provider, options)
  }
}

export function estimateCost(
  provider: CloudProvider,
  resources: ResourceEstimate,
): CostEstimateResult {
  const cpu = resources.cpu ?? 1
  const memoryGb = resources.memoryGb ?? 1
  const instances = resources.instances ?? 1
  const storageGb = resources.storageGb ?? 0
  const bandwidthGb = resources.bandwidthGb ?? 0
  const requests = resources.requestsPerMonth ?? 0

  const baseHours = 730
  let monthlyUsd = 0
  const notes: string[] = []

  switch (provider) {
    case 'aws':
      monthlyUsd = instances * baseHours * (cpu * 0.04048 + memoryGb * 0.004445)
      notes.push('Approximate ECS Fargate pricing.')
      break
    case 'digitalocean':
      monthlyUsd = Math.max(5, instances * (cpu <= 1 && memoryGb <= 1 ? 5 : 12))
      notes.push('Approximate App Platform or small droplet pricing.')
      break
    case 'azure':
      monthlyUsd = instances * baseHours * (cpu * 0.000024 + memoryGb * 0.000003)
      notes.push('Approximate Container Apps consumption pricing.')
      break
    case 'gcp':
      monthlyUsd = instances * baseHours * (cpu * 0.000024 + memoryGb * 0.0000025)
      notes.push('Approximate Cloud Run request-based pricing.')
      break
  }

  monthlyUsd += storageGb * 0.10 + bandwidthGb * 0.08 + requests * 0.000001

  return { monthlyUsd: Number(monthlyUsd.toFixed(2)), notes }
}

export function deployProject(
  projectDir: string,
  provider: CloudProvider,
  options: CloudDeploymentOptions = {},
): DeploymentResult {
  const manifest = generateDeploymentConfig(projectDir, provider, options)
  const filesWritten: string[] = []

  for (const file of manifest.files) {
    const absolutePath = path.join(projectDir, file.path)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, file.content, 'utf-8')
    if (file.executable) {
      try {
        fs.chmodSync(absolutePath, 0o755)
      } catch {
        // Windows and some filesystems ignore executable bits.
      }
    }
    filesWritten.push(absolutePath)
  }

  return {
    manifest,
    filesWritten,
    instructions: manifest.instructions,
  }
}
