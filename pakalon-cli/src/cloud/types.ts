import path from 'path'

export type CloudProvider = 'aws' | 'digitalocean' | 'azure' | 'gcp'

export interface CloudDeploymentOptions {
  appName?: string
  region?: string
  image?: string
  port?: number
  cpu?: number
  memoryMb?: number
  env?: Record<string, string>
  repository?: string
  branch?: string
}

export interface DeploymentFile {
  path: string
  content: string
  executable?: boolean
}

export interface DeploymentManifest {
  provider: CloudProvider
  projectDir: string
  appName: string
  files: DeploymentFile[]
  instructions: string[]
  estimatedMonthlyCostUsd: number
  requiredCredentials: string[]
  scriptPath: string
}

export interface ResourceEstimate {
  cpu?: number
  memoryGb?: number
  instances?: number
  storageGb?: number
  bandwidthGb?: number
  requestsPerMonth?: number
}

export interface CostEstimateResult {
  monthlyUsd: number
  notes: string[]
}

export function resolveAppName(projectDir: string, appName?: string): string {
  const fallback = path.basename(path.resolve(projectDir)) || 'app'
  return sanitizeName(appName ?? fallback)
}

export function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app'
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export function renderShellExports(env: Record<string, string>): string {
  const entries = Object.entries(env)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `export ${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join('\n')
}

export function renderYamlEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)
    .join('\n')
}

export function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
