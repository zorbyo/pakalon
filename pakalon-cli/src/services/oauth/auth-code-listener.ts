/**
 * Auth code listener — local HTTP server for OAuth callback capture.
 */
import * as http from 'http'
import { openBrowser } from '../../utils/browser.js'

export class AuthCodeListener {
  private server: http.Server | null = null
  private port: number | null = null
  private pendingResponse = false
  private resolveAuthCode: ((code: string) => void) | null = null
  private rejectAuthCode: ((error: Error) => void) | null = null

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end(`Authentication failed: ${error}`)
          this.rejectAuthCode?.(new Error(`OAuth error: ${error}`))
          return
        }

        if (code) {
          this.pendingResponse = true
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 40px;">
                <h1>Authentication Successful</h1>
                <p>You can close this window and return to the CLI.</p>
              </body>
            </html>
          `)
          this.resolveAuthCode?.(code)
          return
        }

        res.writeHead(404)
        res.end()
      })

      this.server.on('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          resolve(this.port)
        } else {
          reject(new Error('Could not determine server port'))
        }
      })
    })
  }

  async waitForAuthorization(
    expectedState: string,
    onReady: () => Promise<void>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolveAuthCode = resolve
      this.rejectAuthCode = reject

      onReady().catch(reject)
    })
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse
  }

  handleSuccessRedirect(scopes: string[]): void {
    if (!this.pendingResponse) return

    const scopesParam = scopes.length > 0 ? `&scope=${encodeURIComponent(scopes.join(' '))}` : ''
    const successUrl = `https://console.anthropic.com/oauth/success?status=approved${scopesParam}`
    openBrowser(successUrl).catch(() => {})
  }

  handleErrorRedirect(): void {
    if (!this.pendingResponse) return
    openBrowser('https://console.anthropic.com/oauth/success?status=error').catch(() => {})
  }

  close(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.pendingResponse = false
    this.resolveAuthCode = null
    this.rejectAuthCode = null
  }
}
