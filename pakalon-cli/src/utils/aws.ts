/**
 * AWS utility — AWS authentication and credential management.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  expiresAt?: number
}

export interface AwsAuthConfig {
  profile: string
  credentialsFile: string
  configFile: string
}

function getAwsDir(): string {
  return path.join(os.homedir(), '.aws')
}

export function getAwsCredentialsPath(): string {
  return path.join(getAwsDir(), 'credentials')
}

export function getAwsConfigPath(): string {
  return path.join(getAwsDir(), 'config')
}

export function getAwsAuthConfig(): AwsAuthConfig {
  return {
    profile: process.env.AWS_PROFILE ?? 'default',
    credentialsFile: getAwsCredentialsPath(),
    configFile: getAwsConfigPath(),
  }
}

export function parseAwsCredentialsFile(
  filePath: string = getAwsCredentialsPath()
): Record<string, AwsCredentials> {
  if (!fs.existsSync(filePath)) return {}

  const content = fs.readFileSync(filePath, 'utf-8')
  const result: Record<string, AwsCredentials> = {}
  let currentProfile = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentProfile = trimmed.slice(1, -1)
      result[currentProfile] = {
        accessKeyId: '',
        secretAccessKey: '',
        region: process.env.AWS_REGION ?? 'us-east-1',
      }
    } else if (currentProfile && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=').trim()
      const k = key?.trim()
      if (k === 'aws_access_key_id') {
        result[currentProfile]!.accessKeyId = value
      } else if (k === 'aws_secret_access_key') {
        result[currentProfile]!.secretAccessKey = value
      } else if (k === 'aws_session_token') {
        result[currentProfile]!.sessionToken = value
      }
    }
  }

  return result
}

export function getAwsRegion(): string {
  return (
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    'us-east-1'
  )
}

export function hasAwsCredentials(): boolean {
  const { accessKeyId, secretAccessKey } = getAwsCredentialsFromEnv()
  if (accessKeyId && secretAccessKey) return true

  const config = getAwsAuthConfig()
  const creds = parseAwsCredentialsFile(config.credentialsFile)
  const profile = creds[config.profile]
  return Boolean(profile?.accessKeyId && profile?.secretAccessKey)
}

export function getAwsCredentialsFromEnv(): {
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  sessionToken: string | undefined
  region: string
} {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: getAwsRegion(),
  }
}

export function getAwsCredentials(): AwsCredentials | null {
  const env = getAwsCredentialsFromEnv()
  if (env.accessKeyId && env.secretAccessKey) {
    return {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      sessionToken: env.sessionToken,
      region: env.region,
    }
  }

  const config = getAwsAuthConfig()
  const creds = parseAwsCredentialsFile(config.credentialsFile)
  const profile = creds[config.profile]

  if (profile?.accessKeyId && profile?.secretAccessKey) {
    return profile
  }

  return null
}

export function generateAwsSignatureV4(
  method: string,
  url: string,
  payload: string,
  credentials: AwsCredentials,
  service = 'execute-api'
): Record<string, string> {
  const now = new Date()
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')

  const canonicalUri = new URL(url, 'https://example.com').pathname
  const canonicalHeaders = `content-type:application/json\nhost:${new URL(url, 'https://example.com').host}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-date'
  const payloadHash = crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex')

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${credentials.region}/${service}/aws4_request`
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signingKey = getSignatureKey(
    credentials.secretAccessKey,
    dateStamp,
    credentials.region,
    service
  )
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex')

  const authorizationHeader = [
    `${algorithm} Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  return {
    Authorization: authorizationHeader,
    'X-Amz-Date': amzDate,
    'Content-Type': 'application/json',
    ...(credentials.sessionToken && { 'X-Amz-Security-Token': credentials.sessionToken }),
  }
}

function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Buffer {
  const kSecret = Buffer.from(`AWS4${key}`, 'utf8')
  const kDate = crypto.createHmac('sha256', kSecret).update(dateStamp).digest()
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest()
  const kService = crypto
    .createHmac('sha256', kRegion)
    .update(serviceName)
    .digest()
  return crypto.createHmac('sha256', kService).update('aws4_request').digest()
}
