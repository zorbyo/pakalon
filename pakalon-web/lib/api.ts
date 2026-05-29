'use client'

import { useState, useEffect } from 'react'

// Types matching backend schemas
export interface User {
  id: string
  github_login: string
  email: string
  display_name: string
  plan: string
  privacy_mode: boolean
  trial_days_used: number
  trial_days_remaining: number
  created_at: string
}

export interface Session {
  id: string
  title: string | null
  mode: string
  model_id: string | null
  created_at: string
  messages_count: number
  tokens_used: number
  input_tokens?: number
  output_tokens?: number
  lines_written: number
}

export interface Model {
  id: string
  name: string
  provider: string
  context_length: number
  remaining_pct: number
  tier: string
}

export interface UsageData {
  user_id: string
  plan: string
  total_tokens: number
  tokens_by_model: Record<string, number>
  daily_tokens: { date: string; tokens: number }[]
  daily_lines_written: { date: string; lines: number }[]
  lines_written: number
  sessions_count: number
  // Subscription / trial fields
  subscription_id: string | null
  subscription_status: string | null
  current_period_start: string | null
  current_period_end: string | null
  days_into_cycle: number | null
  is_in_grace_period: boolean
  grace_period_warning: boolean
  grace_days_remaining: number
  trial_days_used: number
  trial_days_remaining: number
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

export interface WebSignInResponse {
  token: string
  user_id: string
  plan: string
  github_login: string
}

export interface BillingStatus {
  status: string // active | canceled | past_due | none
  polar_sub_id: string | null
  period_start?: string | null
  current_period_end: string | null
  grace_until: string | null
  plan: string | null
  days_remaining: number | null
  in_grace_period: boolean
  days_into_cycle?: number | null
  billing_model?: string | null
  security_deposit_usd?: number | null
  platform_fee_rate?: number | null
  usage_charges_usd?: number | null
  platform_fee_usd?: number | null
  deposit_applied_usd?: number | null
  estimated_total_due_usd?: number | null
  cycle_token_usage?: number | null
  usage_by_model?: Array<{
    model_id: string
    tokens: number
    approx_usage_usd: number
  }>
}

export interface LoginEvent {
  id: string
  login_type: 'web' | 'device_code' | 'token' | 'account_created'
  ip_address: string | null
  browser: string | null
  os: string | null
  device_name: string | null
  machine_id: string | null
  created_at: string
}

export interface DashboardSession {
  id: string
  title: string | null
  prompt_text: string | null
  model_id: string | null
  mode: string | null
  project_dir: string | null
  machine_id: string | null
  lines_added: number
  lines_deleted: number
  messages_count: number
  tokens_used: number
  current_context_tokens?: number
  input_tokens?: number
  output_tokens?: number
  context_pct_used: number | null
  created_at: string | null
  updated_at: string | null
}

export interface DashboardModelUsage {
  model_id: string
  total_tokens: number
  total_lines: number
  call_count: number
}

export interface DashboardStats {
  user: {
    id: string
    email: string | null
    github_login: string | null
    plan: string
    trial_days_remaining: number
    trial_days_used: number
    created_at: string | null
  }
  subscription: {
    id: string
    polar_sub_id: string | null
    status: string
    plan: string
    period_start: string | null
    period_end: string | null
  } | null
  sessions: DashboardSession[]
  model_usage: DashboardModelUsage[]
  monthly_tokens: Array<{
    month: string
    tokens: number
  }>
  totals: {
    tokens: number
    lines: number
    sessions: number
    sessions_today: number
  }
  credits: {
    balance: number
  } | null
  login_events: LoginEvent[]
  window_days: number
  generated_at: string
}

export interface AutomationTemplate {
  key: string
  name: string
  description: string
  recommended_connectors: string[]
  default_cron: string
  prompt_hint: string
}

export interface AutomationRecord {
  id: string
  name: string
  description: string | null
  prompt: string
  model_id: string | null
  template_key: string | null
  inferred_config: Record<string, any>
  required_connectors: string[]
  workflow_json: Record<string, any> | null
  workflow_version: number
  is_visual: boolean
  schedule_cron: string | null
  schedule_timezone: string
  enabled: boolean
  webhook_id: string | null
  trigger_type: string
  trigger_config: Record<string, any> | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  missing_connectors: string[]
}

export interface AutomationExecution {
  id: string
  automation_id: string
  user_id: string
  status: string
  trigger_type: string
  trigger_data: Record<string, any>
  execution_data: Record<string, any>
  workflow_snapshot: Record<string, any> | null
  error_message: string | null
  duration_ms: number | null
  started_at: string
  completed_at: string | null
}

export interface AutomationNodeLog {
  id: string
  execution_id: string
  automation_id: string
  node_id: string
  node_name: string | null
  node_type: string
  status: string
  level: string
  message: string | null
  input_data: Record<string, any> | null
  output_data: Record<string, any> | null
  error_message: string | null
  retry_count: number
  duration_ms: number | null
  sort_order: number
  started_at: string
  completed_at: string | null
}

export interface AutomationVersion {
  id: string
  automation_id: string
  version: number
  workflow_json: Record<string, any>
  change_summary: string | null
  created_by: string | null
  created_at: string
}

export interface AutomationConnector {
  provider: string
  display_name: string
  category: string
  logo_domain?: string | null
  logo_url?: string | null
  oauth_supported: boolean
  enabled: boolean
  connected: boolean
  connection_status: string
  account_label: string | null
  scopes: string[]
  coming_soon: boolean
}

export interface ConnectorResource {
  id: string
  name: string
  type: string
}

export interface AutomationConnectorCatalog {
  connected: AutomationConnector[]
  available: AutomationConnector[]
}

export interface AutomationLogRecord {
  id: string
  automation_id: string
  trigger_type: string
  status: string
  summary: string | null
  details: Record<string, any>
  started_at: string
  completed_at: string | null
}

export interface AutomationCronJob {
  automation_id: string
  automation_name: string
  schedule_cron: string
  schedule_timezone: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function buildNetworkErrorMessage(): string {
  return `Could not connect to the Pakalon backend at ${API_BASE}. Make sure the backend server is running and reachable.`
}

class ApiClient {
  private token: string | null = null

  setToken(token: string) {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('pakalon_token', token)
    }
  }

  getToken(): string | null {
    if (this.token) return this.token
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pakalon_token')
    }
    return null
  }

  clearToken() {
    this.token = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pakalon_token')
    }
  }

  logout() {
    const token = this.getToken()
    const finish = () => {
      this.clearToken()
      if (typeof window !== 'undefined') {
        window.location.href = '/logout'
      }
    }

    if (!token) {
      finish()
      return
    }

    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
      .catch(() => undefined)
      .finally(finish)
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken()
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    }

    let response: Response
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      })
    } catch {
      throw new Error(buildNetworkErrorMessage())
    }

    if (!response.ok) {
      // On 401 clear the stale token and redirect to login
      if (response.status === 401) {
        this.clearToken()
        if (typeof window !== 'undefined') {
          window.location.href = '/login?error=Session%20expired.%20Please%20sign%20in%20again.'
        }
      }
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  // Auth
  async getMe(): Promise<User> {
    return this.fetch<User>('/auth/me')
  }

  async getDeviceCode(): Promise<{ device_code: string; verification_uri: string; user_code: string; interval: number }> {
    return this.fetch('/auth/devices', { method: 'POST' })
  }

  async pollForToken(device_code: string): Promise<{ access_token: string }> {
    return this.fetch(`/auth/devices/${device_code}/token`, { method: 'POST' })
  }

  // Sessions
  async listSessions(limit = 50, offset = 0): Promise<{ sessions: Session[]; total: number }> {
    return this.fetch(`/sessions?limit=${limit}&offset=${offset}`)
  }

  async getSession(id: string): Promise<Session> {
    return this.fetch(`/sessions/${id}`)
  }

  async createSession(title?: string, model_id?: string, mode?: string): Promise<Session> {
    return this.fetch('/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, model_id, mode }),
    })
  }

  // Models
  async listModels(): Promise<{ models: Model[]; plan: string; count: number }> {
    return this.fetch('/models')
  }

  async getModelContext(model_id: string): Promise<{ remaining_pct: number; context_window_size: number }> {
    return this.fetch(`/models/${model_id}/context`)
  }

  // Usage
  async getUsage(): Promise<UsageData> {
    return this.fetch('/usage')
  }

  async getHeatmap(year?: number): Promise<{
    year: number
    contributions: ContributionDay[]
    total_lines_added: number
    total_lines_deleted: number
  }> {
    const params = year ? `?year=${year}` : ''
    return this.fetch(`/usage/heatmap${params}`)
  }

  // User
  async updateProfile(data: { display_name?: string; privacy_mode?: boolean }, userId?: string): Promise<User> {
    const id = userId ?? await this.getMe().then(u => u.id)
    return this.fetch(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteAccount(userId: string): Promise<void> {
    return this.fetch(`/users/${userId}`, { method: 'DELETE' })
  }

  // Billing
  async createCheckout(priceId: string): Promise<{ url: string }> {
    return this.fetch('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ price_id: priceId }),
    })
  }

  async getBillingStatus(): Promise<BillingStatus | null> {
    return this.fetch<BillingStatus>('/billing/subscription').catch(() => null)
  }

  async getPortalUrl(): Promise<string> {
    const res = await this.fetch<{ portal_url: string }>('/billing/portal-url')
    return res.portal_url
  }

  async cancelSubscription(): Promise<void> {
    return this.fetch('/billing/cancel', { method: 'DELETE' })
  }

  async getLoginEvents(): Promise<LoginEvent[]> {
    const res = await this.fetch<{ login_events?: LoginEvent[] }>('/dashboard/stats?days=90')
    return res.login_events ?? []
  }

  async getDashboardStats(days = 30, startDate?: string, endDate?: string): Promise<DashboardStats> {
    const params = new URLSearchParams({ days: String(days) })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    return this.fetch<DashboardStats>(`/dashboard/stats?${params.toString()}`)
  }

  // Automations
  async getAutomations(): Promise<{ automations: AutomationRecord[]; templates: AutomationTemplate[] }> {
    return this.fetch('/automations')
  }

  async createAutomation(data: {
    name: string
    prompt: string
    model_id?: string
    required_connectors?: string[]
    schedule_cron?: string
    schedule_timezone?: string
    template_key?: string
    workflow_json?: Record<string, any> | null
  }): Promise<AutomationRecord> {
    return this.fetch('/automations', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAutomation(id: string, data: { enabled?: boolean; schedule_cron?: string; schedule_timezone?: string }): Promise<AutomationRecord> {
    return this.fetch(`/automations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteAutomation(id: string): Promise<{ queued: boolean; automation_id: string; message: string }> {
    return this.fetch(`/automations/${id}`, { method: 'DELETE' })
  }

  async runAutomation(id: string): Promise<{ queued: boolean; automation_id: string; message: string }> {
    return this.fetch(`/automations/${id}/run`, { method: 'POST' })
  }

  async getAutomationConnectors(): Promise<AutomationConnectorCatalog> {
    return this.fetch('/automations/connectors')
  }

  async fetchConnectorResources(provider: string): Promise<ConnectorResource[]> {
    const response = await fetch(`${API_BASE}/automations/connectors/${provider}/resources`, {
      headers: { ...authHeaders() },
    })
    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`Failed to fetch ${provider} resources`)
    }
    const data = await response.json()
    return data.resources ?? []
  }

  async startAutomationOAuth(provider: string): Promise<{ provider: string; auth_url: string }> {
    return this.fetch(`/automations/connectors/${provider}/oauth/start`, { method: 'POST' })
  }

  async toggleAutomationConnector(provider: string, enabled: boolean): Promise<AutomationConnectorCatalog> {
    return this.fetch(`/automations/connectors/${provider}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    })
  }

  async getAutomationCronJobs(): Promise<{ cron_jobs: AutomationCronJob[] }> {
    return this.fetch('/automations/cron-jobs')
  }

  async getAutomationLogs(automationId?: string): Promise<{ logs: AutomationLogRecord[] }> {
    const params = automationId ? `?automation_id=${encodeURIComponent(automationId)}` : ''
    return this.fetch(`/automations/logs${params}`)
  }

  // Visual Workflow Editor
  async getWorkflow(id: string): Promise<AutomationRecord> {
    return this.fetch(`/automations/${id}/workflow`)
  }

  async saveWorkflow(id: string, data: {
    name?: string
    description?: string
    workflow_json: { nodes: any[]; edges: any[] }
    trigger_type?: string
    trigger_config?: Record<string, any>
    required_connectors?: string[]
    change_summary?: string
  }): Promise<AutomationRecord> {
    return this.fetch(`/automations/${id}/workflow`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async autoSaveWorkflow(id: string, data: {
    name?: string
    description?: string
    workflow_json: { nodes: any[]; edges: any[] }
  }): Promise<AutomationRecord> {
    return this.fetch(`/automations/${id}/workflow/auto-save`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Executions
  async getExecutions(automationId: string, limit = 50): Promise<{ executions: AutomationExecution[] }> {
    return this.fetch(`/automations/${automationId}/executions?limit=${limit}`)
  }

  async getExecution(automationId: string, executionId: string): Promise<AutomationExecution> {
    return this.fetch(`/automations/${automationId}/executions/${executionId}`)
  }

  async getExecutionNodeLogs(executionId: string): Promise<{ node_logs: AutomationNodeLog[] }> {
    return this.fetch(`/automations/executions/${executionId}/node-logs`)
  }

  async executeWorkflow(automationId: string, triggerData?: Record<string, any>): Promise<AutomationExecution> {
    return this.fetch(`/automations/${automationId}/execute`, {
      method: 'POST',
      body: JSON.stringify(triggerData || {}),
    })
  }

  // Versions
  async getVersions(automationId: string): Promise<{ versions: AutomationVersion[] }> {
    return this.fetch(`/automations/${automationId}/versions`)
  }

  async rollbackVersion(automationId: string, version: number): Promise<AutomationRecord> {
    return this.fetch(`/automations/${automationId}/versions/${version}/rollback`, { method: 'POST' })
  }

  // Webhooks
  async getWebhookUrl(automationId: string): Promise<{ webhook_id: string; webhook_url: string }> {
    return this.fetch(`/automations/${automationId}/webhook-url`)
  }

  // Templates
  async getTemplates(): Promise<{ templates: Array<{
    key: string
    name: string
    description: string
    category: string
    recommended_connectors: string[]
    default_cron: string
    prompt_hint: string
    workflow_json: Record<string, any> | null
    tags: string[]
  }> }> {
    return this.fetch('/automations/templates')
  }

  async useTemplate(templateKey: string, name: string): Promise<AutomationRecord> {
    return this.fetch(`/automations/templates/${templateKey}/use`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  // Import/Export
  async exportWorkflow(automationId: string): Promise<Record<string, any>> {
    return this.fetch(`/automations/${automationId}/export`)
  }

  async importWorkflow(data: Record<string, any>): Promise<AutomationRecord> {
    return this.fetch('/automations/import', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Web sign-in (GitHub OAuth via Clerk)
  async webSignIn(
    clerkToken: string,
    github_login: string,
    email?: string | null,
    display_name?: string | null,
  ): Promise<WebSignInResponse> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/auth/web-signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${clerkToken}`,
        },
        body: JSON.stringify({ github_login, email, display_name }),
      })
    } catch {
      throw new Error(buildNetworkErrorMessage())
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Sign-in failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }

  // Support
  async submitSupport(data: { name: string; email: string; subject: string; message: string }): Promise<{ success: boolean; message: string }> {
    return this.fetch('/support', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
}

export const api = new ApiClient()

// React hooks for data fetching
export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getMe()
      .then(setUser)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { user, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useSessions(limit = 50) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listSessions(limit)
      .then(data => setSessions(data.sessions))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [limit])

  return { sessions, loading, error, refetch: () => setLoading(true) }
}

export function useUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getUsage()
      .then(setUsage)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { usage, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useHeatmap(year?: number) {
  const [data, setData] = useState<ContributionDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getHeatmap(year)
      .then(res => setData(res.contributions))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [year, tick])

  return { data, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useModels() {
  const [models, setModels] = useState<Model[]>([])
  const [plan, setPlan] = useState<string>('free')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.listModels()
      .then(data => {
        setModels(data.models)
        setPlan(data.plan)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { models, plan, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useBillingStatus() {
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getBillingStatus()
      .then(setBillingStatus)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { billingStatus, loading, error }
}

export function useLoginEvents() {
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getLoginEvents()
      .then(setLoginEvents)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { loginEvents, loading, error }
}

export function useDashboardStats(days = 30, startDate?: string, endDate?: string) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getDashboardStats(days, startDate, endDate)
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [days, startDate, endDate, tick])

  return { stats, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useAutomations() {
  const [automations, setAutomations] = useState<AutomationRecord[]>([])
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getAutomations()
      .then((data) => {
        setAutomations(data.automations)
        setTemplates(data.templates)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { automations, templates, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useAutomationConnectors() {
  const [catalog, setCatalog] = useState<AutomationConnectorCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getAutomationConnectors()
      .then(setCatalog)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { catalog, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useAutomationCronJobs() {
  const [cronJobs, setCronJobs] = useState<AutomationCronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getAutomationCronJobs()
      .then(data => setCronJobs(data.cron_jobs))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [tick])

  return { cronJobs, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useAutomationLogs(automationId?: string) {
  const [logs, setLogs] = useState<AutomationLogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getAutomationLogs(automationId)
      .then(data => setLogs(data.logs))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [automationId, tick])

  return { logs, loading, error, refetch: () => setTick(t => t + 1) }
}

export function useConnectorResources(provider: string | null) {
  const [resources, setResources] = useState<ConnectorResource[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!provider) {
      setResources([])
      return
    }
    setLoading(true)
    api.fetchConnectorResources(provider)
      .then(setResources)
      .catch(() => setResources([]))
      .finally(() => setLoading(false))
  }, [provider])

  return { resources, loading }
}
