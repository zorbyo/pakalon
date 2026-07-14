import { Log } from "../util/log"
import { getBackendUrl } from "./types"

const log = Log.create({ service: "backend:client" })

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message)
    this.name = "BackendError"
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  headers?: Record<string, string>
  timeout?: number
}

export class BackendClient {
  private baseUrl: string
  private token: string | null = null
  private tokenBootstrapAttempted = false
  private tokenBootstrapPromise: Promise<void> | null = null
  private retryCount = 3
  private retryDelay = 1000

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getBackendUrl()
  }

  setToken(token: string | null): void {
    this.token = token
    this.tokenBootstrapAttempted = true
  }

  getToken(): string | null {
    return this.token
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    }
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`
    }
    return headers
  }

  private async ensureTokenBootstrapped(): Promise<void> {
    if (this.tokenBootstrapAttempted || this.token) {
      return
    }

    if (this.tokenBootstrapPromise) {
      await this.tokenBootstrapPromise
      return
    }

    this.tokenBootstrapPromise = (async () => {
      try {
        const authModule = await import("../auth")
        const auth = await authModule.Auth.get("pakalon")
        if (!auth) {
          return
        }

        if (auth.type === "api") {
          this.token = auth.key
          return
        }

        if (auth.type === "oauth") {
          this.token = auth.access
          return
        }

        if (auth.type === "wellknown") {
          this.token = auth.token
        }
      } catch (error) {
        log.debug("failed to bootstrap backend token from auth store", { error })
      } finally {
        this.tokenBootstrapAttempted = true
        this.tokenBootstrapPromise = null
      }
    })()

    await this.tokenBootstrapPromise
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, headers = {}, timeout = 30000 } = options
    await this.ensureTokenBootstrapped()
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: this.getHeaders(headers),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!res.ok) {
          let bodyText = ""
          try {
            bodyText = await res.text()
            const bodyJson = JSON.parse(bodyText)
            throw new BackendError(
              bodyJson.detail || `HTTP ${res.status}`,
              res.status,
              bodyJson,
            )
          } catch (e) {
            if (e instanceof BackendError) throw e
            throw new BackendError(
              bodyText || `HTTP ${res.status}`,
              res.status,
            )
          }
        }

        const text = await res.text()
        if (text === "") {
          return undefined as T
        }
        return JSON.parse(text) as T
      } catch (e) {
        lastError = e as Error
        if (e instanceof BackendError) {
          if (e.status >= 400 && e.status < 500 && e.status !== 429) {
            throw e
          }
        }
        if (attempt < this.retryCount - 1) {
          await new Promise((r) => setTimeout(r, this.retryDelay * (attempt + 1)))
        }
      }
    }

    clearTimeout(timeoutId)
    throw lastError
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" })
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "POST", body })
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PUT", body })
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PATCH", body })
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" })
  }

  async stream(
    endpoint: string,
    body: unknown,
    onChunk: (chunk: string) => void,
    options?: RequestOptions,
  ): Promise<void> {
    await this.ensureTokenBootstrapped()
    const url = `${this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new BackendError(`Stream error: ${res.status}`, res.status, text)
    }

    if (!res.body) {
      throw new BackendError("Empty response body", 500)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        onChunk(text)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

let clientInstance: BackendClient | null = null

export function getClient(baseUrl?: string): BackendClient {
  if (!clientInstance) {
    clientInstance = new BackendClient(baseUrl)
  }
  return clientInstance
}

export function resetClient(): void {
  clientInstance = null
}
