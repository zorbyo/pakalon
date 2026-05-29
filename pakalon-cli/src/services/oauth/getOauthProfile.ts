/**
 * OAuth profile fetching service.
 */
import axios from 'axios'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { logError } from '../../utils/log.js'

export interface OauthProfile {
  account: {
    uuid: string
    email: string
    display_name: string
    created_at: string
  }
  organization: {
    uuid: string
    name: string
    organization_type: string
    rate_limit_tier: string
    billing_type: string | null
    has_extra_usage_enabled: boolean
    subscription_created_at: string | null
  }
}

export async function getOauthProfileFromApiKey(
  accountUuid: string,
  apiKey: string
): Promise<OauthProfile | undefined> {
  if (!accountUuid || !apiKey) return undefined

  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli_profile`

  try {
    const response = await axios.get<OauthProfile>(endpoint, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
      params: { account_uuid: accountUuid },
      timeout: 10_000,
    })
    return response.data
  } catch (error) {
    logError(error as Error)
    return undefined
  }
}

export async function getOauthProfileFromOauthToken(
  accessToken: string
): Promise<OauthProfile | undefined> {
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/oauth/profile`

  try {
    const response = await axios.get<OauthProfile>(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    })
    return response.data
  } catch (error) {
    logError(error as Error)
    return undefined
  }
}
