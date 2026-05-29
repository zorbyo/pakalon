/**
 * AWS auth status manager — tracks and manages AWS authentication state.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAwsCredentials, getAwsRegion, hasAwsCredentials } from './aws.js'

export type AwsAuthStatus =
  | 'authenticated'
  | 'expired'
  | 'invalid'
  | 'not_configured'

export interface AwsAuthState {
  status: AwsAuthStatus
  region: string
  profile: string
  lastChecked: number
  expiresAt?: number
  error?: string
}

function getStateFilePath(): string {
  const configDir =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(configDir, 'pakalon', 'aws-auth-state.json')
}

export function getAwsAuthState(): AwsAuthState {
  const filePath = getStateFilePath()
  if (!fs.existsSync(filePath)) {
    return checkAwsAuthStatus()
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const state = JSON.parse(raw) as AwsAuthState

    if (state.status === 'authenticated' && state.expiresAt) {
      if (Date.now() > state.expiresAt) {
        return { ...state, status: 'expired' }
      }
    }

    return state
  } catch {
    return checkAwsAuthStatus()
  }
}

export function checkAwsAuthStatus(): AwsAuthState {
  const hasCreds = hasAwsCredentials()
  const region = getAwsRegion()
  const profile = process.env.AWS_PROFILE ?? 'default'

  if (!hasCreds) {
    const state: AwsAuthState = {
      status: 'not_configured',
      region,
      profile,
      lastChecked: Date.now(),
      error: 'No AWS credentials found in environment or ~/.aws/credentials',
    }
    saveAwsAuthState(state)
    return state
  }

  const creds = getAwsCredentials()
  if (!creds) {
    const state: AwsAuthState = {
      status: 'invalid',
      region,
      profile,
      lastChecked: Date.now(),
      error: 'AWS credentials found but are incomplete',
    }
    saveAwsAuthState(state)
    return state
  }

  const state: AwsAuthState = {
    status: 'authenticated',
    region: creds.region,
    profile,
    lastChecked: Date.now(),
    expiresAt: creds.expiresAt,
  }
  saveAwsAuthState(state)
  return state
}

export function saveAwsAuthState(state: AwsAuthState): void {
  const filePath = getStateFilePath()
  const dir = path.dirname(filePath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), { mode: 0o600 })
}

export function clearAwsAuthState(): void {
  const filePath = getStateFilePath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function isAwsAuthenticated(): boolean {
  const state = getAwsAuthState()
  return state.status === 'authenticated'
}

export function getAwsAuthErrorMessage(): string | undefined {
  const state = getAwsAuthState()
  return state.error
}

export async function validateAwsCredentials(): Promise<boolean> {
  const creds = getAwsCredentials()
  if (!creds) return false

  try {
    const { getAwsAuthStatus } = await import('./awsAuthStatusManager.js')
    const status = await getAwsAuthStatus()
    return status === 'authenticated'
  } catch {
    return true
  }
}

export async function getAwsAuthStatus(): Promise<AwsAuthStatus> {
  const state = getAwsAuthState()
  return state.status
}
