/**
 * OAuth Configuration
 * Handles OAuth authentication flows for Pakalon CLI
 */

import { isEnvTruthy } from '../utils/envUtils.js'

// Default to prod config, override with test/staging if enabled
type OauthConfigType = 'prod' | 'staging' | 'local'

function getOauthConfigType(): OauthConfigType {
  if (process.env.USER_TYPE === 'ant') {
    if (isEnvTruthy(process.env.USE_LOCAL_OAUTH)) {
      return 'local'
    }
    if (isEnvTruthy(process.env.USE_STAGING_OAUTH)) {
      return 'staging'
    }
  }
  return 'prod'
}

export function fileSuffixForOauthConfig(): string {
  if (process.env.PAKALON_CUSTOM_OAUTH_URL) {
    return '-custom-oauth'
  }
  switch (getOauthConfigType()) {
    case 'local':
      return '-local-oauth'
    case 'staging':
      return '-staging-oauth'
    case 'prod':
      // No suffix for production config
      return ''
  }
}

export const PAKALON_INFERENCE_SCOPE = 'user:inference' as const
export const PAKALON_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  PAKALON_PROFILE_SCOPE,
] as const

// Pakalon OAuth scopes - for subscribers (Pro/Max/Team/Enterprise)
export const PAKALON_OAUTH_SCOPES = [
  PAKALON_PROFILE_SCOPE,
  PAKALON_INFERENCE_SCOPE,
  'user:sessions:pakalon_code',
  'user:mcp_servers',
  'user:file_upload',
] as const

// All OAuth scopes - union of all scopes used in Pakalon CLI
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...PAKALON_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  PAKALON_AUTHORIZE_URL: string
  PAKALON_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  PAKALON_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

// Production OAuth configuration - Used in normal operation
const PROD_OAUTH_CONFIG: OauthConfig = {
  BASE_API_URL: 'https://api.pakalon.ai',
  CONSOLE_AUTHORIZE_URL: 'https://platform.pakalon.ai/oauth/authorize',
  PAKALON_AUTHORIZE_URL: 'https://pakalon.ai/oauth/authorize',
  PAKALON_ORIGIN: 'https://pakalon.ai',
  TOKEN_URL: 'https://platform.pakalon.ai/v1/oauth/token',
  API_KEY_URL: 'https://api.pakalon.ai/api/oauth/pakalon_cli/create_api_key',
  ROLES_URL: 'https://api.pakalon.ai/api/oauth/pakalon_cli/roles',
  CONSOLE_SUCCESS_URL:
    'https://platform.pakalon.ai/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dpakalon-cli',
  PAKALON_SUCCESS_URL:
    'https://platform.pakalon.ai/oauth/code/success?app=pakalon-cli',
  MANUAL_REDIRECT_URL: 'https://platform.pakalon.ai/oauth/code/callback',
  CLIENT_ID: 'pakalon-cli-client-id',
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: 'https://mcp-proxy.pakalon.ai',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
}

// Staging OAuth configuration
const STAGING_OAUTH_CONFIG: OauthConfig | undefined =
  process.env.USER_TYPE === 'ant'
    ? {
        BASE_API_URL: 'https://api-staging.pakalon.ai',
        CONSOLE_AUTHORIZE_URL: 'https://platform.staging.pakalon.ai/oauth/authorize',
        PAKALON_AUTHORIZE_URL: 'https://staging.pakalon.ai/oauth/authorize',
        PAKALON_ORIGIN: 'https://staging.pakalon.ai',
        TOKEN_URL: 'https://platform.staging.pakalon.ai/v1/oauth/token',
        API_KEY_URL: 'https://api-staging.pakalon.ai/api/oauth/pakalon_cli/create_api_key',
        ROLES_URL: 'https://api-staging.pakalon.ai/api/oauth/pakalon_cli/roles',
        CONSOLE_SUCCESS_URL:
          'https://platform.staging.pakalon.ai/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dpakalon-cli',
        PAKALON_SUCCESS_URL:
          'https://platform.staging.pakalon.ai/oauth/code/success?app=pakalon-cli',
        MANUAL_REDIRECT_URL: 'https://platform.staging.pakalon.ai/oauth/code/callback',
        CLIENT_ID: 'pakalon-cli-staging-client-id',
        OAUTH_FILE_SUFFIX: '-staging-oauth',
        MCP_PROXY_URL: 'https://mcp-proxy-staging.pakalon.ai',
        MCP_PROXY_PATH: '/v1/mcp/{server_id}',
      }
    : undefined

// Local dev config
function getLocalOauthConfig(): OauthConfig {
  const api = process.env.PAKALON_LOCAL_OAUTH_API_BASE?.replace(/\/$/, '') ?? 'http://localhost:8000'
  const apps = process.env.PAKALON_LOCAL_OAUTH_APPS_BASE?.replace(/\/$/, '') ?? 'http://localhost:4000'
  const consoleBase = process.env.PAKALON_LOCAL_OAUTH_CONSOLE_BASE?.replace(/\/$/, '') ?? 'http://localhost:3000'
  
  return {
    BASE_API_URL: api,
    CONSOLE_AUTHORIZE_URL: `${consoleBase}/oauth/authorize`,
    PAKALON_AUTHORIZE_URL: `${apps}/oauth/authorize`,
    PAKALON_ORIGIN: apps,
    TOKEN_URL: `${api}/v1/oauth/token`,
    API_KEY_URL: `${api}/api/oauth/pakalon_cli/create_api_key`,
    ROLES_URL: `${api}/api/oauth/pakalon_cli/roles`,
    CONSOLE_SUCCESS_URL: `${consoleBase}/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dpakalon-cli`,
    PAKALON_SUCCESS_URL: `${consoleBase}/oauth/code/success?app=pakalon-cli`,
    MANUAL_REDIRECT_URL: `${consoleBase}/oauth/code/callback`,
    CLIENT_ID: 'pakalon-cli-local-client-id',
    OAUTH_FILE_SUFFIX: '-local-oauth',
    MCP_PROXY_URL: 'http://localhost:8205',
    MCP_PROXY_PATH: '/v1/toolbox/shttp/mcp/{server_id}',
  }
}

// Allowed base URLs for custom OAuth URL override
const ALLOWED_OAUTH_BASE_URLS = [
  'https://pakalon.fedstart.com',
  'https://pakalon-staging.fedstart.com',
]

/**
 * MCP Client Metadata URL for MCP OAuth (CIMD / SEP-991)
 */
export const MCP_CLIENT_METADATA_URL = 'https://pakalon.ai/oauth/pakalon-cli-client-metadata'

// Get OAuth configuration based on environment
export function getOauthConfig(): OauthConfig {
  let config: OauthConfig = (() => {
    switch (getOauthConfigType()) {
      case 'local':
        return getLocalOauthConfig()
      case 'staging':
        return STAGING_OAUTH_CONFIG ?? PROD_OAUTH_CONFIG
      case 'prod':
        return PROD_OAUTH_CONFIG
    }
  })()

  // Allow overriding all OAuth URLs to point to an approved deployment
  const oauthBaseUrl = process.env.PAKALON_CUSTOM_OAUTH_URL
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '')
    if (!ALLOWED_OAUTH_BASE_URLS.includes(base)) {
      throw new Error('PAKALON_CUSTOM_OAUTH_URL is not an approved endpoint.')
    }
    config = {
      ...config,
      BASE_API_URL: base,
      CONSOLE_AUTHORIZE_URL: `${base}/oauth/authorize`,
      PAKALON_AUTHORIZE_URL: `${base}/oauth/authorize`,
      PAKALON_ORIGIN: base,
      TOKEN_URL: `${base}/v1/oauth/token`,
      API_KEY_URL: `${base}/api/oauth/pakalon_cli/create_api_key`,
      ROLES_URL: `${base}/api/oauth/pakalon_cli/roles`,
      CONSOLE_SUCCESS_URL: `${base}/oauth/code/success?app=pakalon-cli`,
      PAKALON_SUCCESS_URL: `${base}/oauth/code/success?app=pakalon-cli`,
      MANUAL_REDIRECT_URL: `${base}/oauth/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    }
  }

  // Allow CLIENT_ID override via environment variable
  const clientIdOverride = process.env.PAKALON_OAUTH_CLIENT_ID
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    }
  }

  return config
}
