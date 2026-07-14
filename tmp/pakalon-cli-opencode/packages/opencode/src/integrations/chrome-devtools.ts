import { Log } from "../util/log"

const log = Log.create({ service: "integrations:chrome-devtools" })

/**
 * Stub Chrome DevTools Protocol integration.
 *
 * Chrome must be launched with --remote-debugging-port=9222 for real CDP access.
 */
export namespace ChromeDevToolsIntegration {
  export async function connect(url: string): Promise<{ cdp: unknown }> {
    try {
      log.info("chrome-devtools connect stub invoked", { url })
      return {
        cdp: {
          stub: true,
          endpoint: url,
          note: "Launch Chrome with --remote-debugging-port=9222",
        },
      }
    } catch (error) {
      log.error("chrome-devtools connect stub failed", { url, error })
      throw error
    }
  }

  export async function getPerformanceMetrics(
    cdp: unknown,
  ): Promise<{ loadTime: number; domContentLoaded: number }> {
    try {
      log.info("chrome-devtools getPerformanceMetrics stub invoked", { hasCdp: !!cdp })
      return {
        loadTime: 0,
        domContentLoaded: 0,
      }
    } catch (error) {
      log.error("chrome-devtools getPerformanceMetrics stub failed", { error })
      throw error
    }
  }

  export async function getConsoleLogs(cdp: unknown): Promise<Array<{ level: string; message: string }>> {
    try {
      log.info("chrome-devtools getConsoleLogs stub invoked", { hasCdp: !!cdp })
      return []
    } catch (error) {
      log.error("chrome-devtools getConsoleLogs stub failed", { error })
      throw error
    }
  }

  export async function getNetworkRequests(cdp: unknown): Promise<Array<{ url: string; status: number }>> {
    try {
      log.info("chrome-devtools getNetworkRequests stub invoked", { hasCdp: !!cdp })
      return []
    } catch (error) {
      log.error("chrome-devtools getNetworkRequests stub failed", { error })
      throw error
    }
  }
}
