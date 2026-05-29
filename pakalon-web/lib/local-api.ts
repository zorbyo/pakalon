export interface LocalModel {
  id: string
  name: string
  provider: 'ollama' | 'lmstudio'
  base_url: string
  context_window: number
  parameters?: string | null
  quantization?: string | null
  family?: string | null
}

export interface LocalProviderStatus {
  name: 'ollama' | 'lmstudio'
  base_url: string
  enabled: boolean
  available: boolean
  model_count: number
  error?: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LocalProvidersResponse {
  providers: LocalProviderStatus[]
  mode: string
}

export interface LocalModelsResponse {
  mode: string
  models: LocalModel[]
  total: number
}

export interface LocalHealthResponse {
  mode: string
  status: string
  service: string
}

export interface LocalChatRequest {
  model: string
  messages: ChatMessage[]
  system?: string
  temperature?: number
  max_tokens?: number
}

class LocalApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'LocalApiError'
  }
}

export class LocalApiClient {
  private readonly baseUrl: string

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async getProviders(): Promise<LocalProvidersResponse> {
    return this.request<LocalProvidersResponse>('/local/providers')
  }

  async getModels(): Promise<LocalModelsResponse> {
    return this.request<LocalModelsResponse>('/local/models')
  }

  async health(): Promise<LocalHealthResponse> {
    return this.request<LocalHealthResponse>('/local/health')
  }

  async chat(request: LocalChatRequest): Promise<Response> {
    if (!request?.model) {
      throw new LocalApiError('Local chat request failed: model is required')
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new LocalApiError('Local chat request failed: messages must be a non-empty array')
    }

    const response = await fetch(this.url('/local/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const detail = await this.readErrorDetails(response)
      throw new LocalApiError(
        `Local chat request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`,
        response.status,
      )
    }

    return response
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response

    try {
      response = await fetch(this.url(path), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error'
      throw new LocalApiError(`Request to ${path} failed: ${message}`)
    }

    if (!response.ok) {
      const detail = await this.readErrorDetails(response)
      throw new LocalApiError(
        `Request to ${path} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`,
        response.status,
      )
    }

    try {
      return (await response.json()) as T
    } catch {
      throw new LocalApiError(`Request to ${path} failed: response was not valid JSON`)
    }
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private async readErrorDetails(response: Response): Promise<string> {
    try {
      const text = await response.text()
      if (!text) return ''

      try {
        const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown }
        if (typeof parsed.detail === 'string') return parsed.detail
        if (typeof parsed.message === 'string') return parsed.message
      } catch {
        // Not JSON, fall through to raw text.
      }

      return text
    } catch {
      return ''
    }
  }
}

export const localApi = new LocalApiClient()
