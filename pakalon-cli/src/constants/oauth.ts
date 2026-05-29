/**
 * OAuth configuration constants.
 */

export const OAUTH_BETA_HEADER = 'oauth-authorization-code-2025-01-24'

export const CLAUDE_AI_INFERENCE_SCOPE = 'organization:inference'
export const CLAUDE_AI_PROFILE_SCOPE = 'organization:profile'
export const CLAUDE_AI_OAUTH_SCOPES = [
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_PROFILE_SCOPE,
]
export const ALL_OAUTH_SCOPES = CLAUDE_AI_OAUTH_SCOPES

export interface OauthConfig {
  BASE_API_URL: string
  CLAUDE_AI_AUTHORIZE_URL: string
  CONSOLE_AUTHORIZE_URL: string
  CLIENT_ID: string
  TOKEN_URL: string
  MANUAL_REDIRECT_URL: string
  ROLES_URL: string
  API_KEY_URL: string
}

function resolveBaseUrl(): string {
  return process.env.CLAUDE_API_URL ?? 'https://api.anthropic.com'
}

export function getOauthConfig(): OauthConfig {
  return {
    BASE_API_URL: resolveBaseUrl(),
    CLAUDE_AI_AUTHORIZE_URL: 'https://console.anthropic.com/oauth/authorize',
    CONSOLE_AUTHORIZE_URL: 'https://console.anthropic.com/oauth/authorize',
    CLIENT_ID: process.env.CLAUDE_OAUTH_CLIENT_ID ?? 'ant_cli_01',
    TOKEN_URL: 'https://console.anthropic.com/oauth/token',
    MANUAL_REDIRECT_URL: 'https://console.anthropic.com/oauth/manual',
    ROLES_URL: 'https://api.anthropic.com/api/oauth/roles',
    API_KEY_URL: 'https://api.anthropic.com/api/oauth/api_keys',
  }
}
