import { Flag } from "../flag/flag"

export interface User {
  id: string
  email: string
  github_login: string
  plan: "free" | "pro"
  trial_days_used: number
  trial_days_remaining: number
  is_admin: boolean
}

export interface DeviceCodeCreateRequest {
  device_id?: string
  machine_id: string
}

export interface DeviceCodeCreateResponse {
  device_id: string
  code: string
  expires_in: number
  verification_url: string
  is_first_machine_run: boolean
  launch_experience?: string
}

export interface DeviceCodePollResponse {
  status: "pending" | "approved" | "expired"
  token?: string
  access_token?: string
  token_type?: string
  user_id?: string
  plan?: string
  github_login?: string
  display_name?: string
  trial_days_remaining?: number
  billing_days_remaining?: number
  trial_ends_at?: string
}

export interface DeviceCodeConfirmRequest {
  code: string
}

export interface DeviceCodeConfirmResponse {
  status: "approved"
  token: string
  user_id: string
  plan: string
}

export interface DeviceCodeWebConfirmRequest {
  code: string
  email: string
  github_login: string
  display_name?: string
}

export interface DeviceCodeWebConfirmResponse {
  status: "approved"
  user_id: string
  plan: string
  token: string
  message: string
}

export interface WebSignInRequest {
  github_login: string
  email: string
  display_name?: string
}

export interface WebSignInResponse {
  token: string
  user_id: string
  plan: string
  github_login: string
}

export interface LogoutResponse {
  revoked: boolean
  message: string
}

export interface ModelInfo {
  id?: string
  model_id?: string
  name: string
  tier?: string
  pricing_tier?: string
  description?: string
  context_length: number
  pricing?: {
    prompt: string
    completion: string
  }
  top_provider?: {
    context_length: number
    max_completion_tokens: number
  }
  architecture?: {
    modality: string
    tokenizer: string
    instruct_type: string | null
  }
  supported_parameters?: string[]
  reasoning?: boolean | Record<string, unknown>
  supports_reasoning?: boolean
  is_free?: boolean
  per_request_limits?: Record<string, unknown> | null
  remaining_pct?: number
}

export interface ModelsResponse {
  models: ModelInfo[]
  plan: string
  count: number
}

export interface ModelContextResponse {
  model_id: string
  remaining_pct: number
  exhausted: boolean
  message: string
}

export interface DailyTokens {
  date: string
  tokens: number
}

export interface DailyLines {
  date: string
  lines: number
}

export interface TokensByModel {
  model_id: string
  total_tokens: number
}

export interface UsageResponse {
  user_id: string
  plan: string
  trial_days_used: number
  trial_days_remaining: number
  subscription_id?: string
  subscription_status?: string
  current_period_start?: string
  current_period_end?: string
  days_into_cycle?: number
  is_in_grace_period: boolean
  grace_period_warning: boolean
  grace_days_remaining: number
  total_tokens: number
  tokens_by_model: Record<string, number> | TokensByModel[]
  daily_tokens: DailyTokens[]
  daily_lines_written: DailyLines[]
  lines_written: number
  sessions_count: number
}

export interface ContributionDay {
  date: string
  lines_added: number
  lines_deleted: number
  commits: number
  tokens_used: number
  sessions_count: number
  level: number
}

export interface HeatmapResponse {
  year: number
  contributions: ContributionDay[]
  total_lines_added: number
  total_lines_deleted: number
  total_commits: number
  total_tokens: number
}

export interface Session {
  id: string
  user_id: string
  mode?: string
  messages_count?: number
  tokens_used?: number
  input_tokens?: number
  output_tokens?: number
  lines_written?: number
  context_pct_used?: number
  lines_added?: number
  lines_deleted?: number
  prompt_text?: string
  created_at: string
  title?: string
  model_id?: string
}

export interface SessionsResponse {
  sessions: Session[]
  total: number
}

export interface SessionMessagesResponse {
  messages: Message[]
  total: number
}

export interface Message {
  id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  created_at: string
}

export interface CreateSessionRequest {
  title?: string
  model_id?: string
  mode?: string
  machine_id?: string
  created_at?: string
}

export interface CreateMessageRequest {
  role: "user" | "assistant" | "system"
  content: string
  tokens_used?: number
  input_tokens?: number
  output_tokens?: number
  created_at?: string
}

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface ChatRequest {
  model?: string
  model_id?: string
  messages: ChatMessage[]
  system?: string
  temperature?: number
  max_tokens?: number
  thinking_enabled?: boolean
  privacy_mode?: boolean
  session_id?: string
  lines_delta?: number
  stream?: boolean
}

export interface ChatResponse {
  content?: string
  model: string
  prompt_tokens?: number
  completion_tokens?: number
  remaining_pct?: number
  id?: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ChatStreamChunk {
  type?: "chunk" | "done" | "error"
  content?: string
  prompt_tokens?: number
  completion_tokens?: number
  remaining_pct?: number
  detail?: string
  id?: string
  choices?: Array<{
    index: number
    delta: {
      content?: string
      role?: string
    }
    finish_reason?: string
  }>
}

export interface CreditBalanceResponse {
  user_id: string
  plan: string
  credits_total: number
  credits_used: number
  credits_remaining: number
  period_start: string
  period_end: string
}

export interface CreditHistoryEntry {
  period_start: string
  period_end: string
  plan: string
  credits_total: number
  credits_used: number
  credits_remaining: number
}

export type CreditHistoryResponse = CreditHistoryEntry[]

export interface StartupCheckApiResponse {
  can_interact: boolean
  credits_remaining: number
  plan: string
  reason?: string
}

export interface StartupCheckResponse {
  allowed: boolean
  reason?: string
  trial_days_remaining?: number
  credits_remaining?: number
  plan?: string
}

export interface BillingCheckoutRequest {
  price_id: string
  success_url: string
  cancel_url: string
}

export interface BillingCheckoutResponse {
  checkout_url: string
  session_id: string
}

export interface BillingSubscriptionResponse {
  id: string
  status: string
  plan: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
}

export interface BillingPortalResponse {
  portal_url: string
}

export function getBackendUrl(): string {
  return Flag.PAKALON_BACKEND_URL
}

export function isBackendEnabled(): boolean {
  return Flag.PAKALON_ENABLE_BACKEND
}
