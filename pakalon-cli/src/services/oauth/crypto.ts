/**
 * OAuth crypto utilities — PKCE code verifier/challenge generation.
 */
import * as crypto from 'crypto'

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function generateCodeVerifier(): string {
  const buffer = crypto.randomBytes(32)
  return base64UrlEncode(buffer)
}

export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest()
  return base64UrlEncode(hash)
}

export function generateState(): string {
  const buffer = crypto.randomBytes(16)
  return base64UrlEncode(buffer)
}

export function verifyCodeChallenge(codeVerifier: string, expectedChallenge: string): boolean {
  const computed = generateCodeChallenge(codeVerifier)
  return computed === expectedChallenge
}
