import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./remote-trigger.txt"
import { Log } from "../util/log"

export const log = Log.create({ service: "remote-trigger-tool" })

const DEFAULT_TIMEOUT = 30_000

export const RemoteTriggerTool = Tool.define("remote_trigger", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      url: z
        .string()
        .url()
        .describe("The URL to trigger (webhook endpoint or remote service)"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE", "PATCH"])
        .optional()
        .describe("HTTP method. Default: POST"),
      body: z
        .record(z.unknown())
        .optional()
        .describe("Optional request body (JSON object)"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Optional additional headers"),
      timeout: z
        .number()
        .positive()
        .optional()
        .describe(`Request timeout in milliseconds. Default: ${DEFAULT_TIMEOUT}`),
    }),
    async execute(params, ctx) {
      const { url, method = "POST", body, headers = {}, timeout = DEFAULT_TIMEOUT } = params

      // Request permission
      await ctx.ask({
        permission: "remote_trigger",
        patterns: [url],
        always: [new URL(url).origin + "/*"],
        metadata: {},
      })

      log.info("remote trigger", { url, method })

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        // Handle abort from context
        const abortHandler = () => controller.abort()
        ctx.abort.addEventListener("abort", abortHandler, { once: true })

        const requestHeaders: Record<string, string> = {
          "User-Agent": "Pakalon-CLI/1.0",
          ...headers,
        }

        // Add Content-Type for requests with body
        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
          requestHeaders["Content-Type"] = "application/json"
        }

        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        ctx.abort.removeEventListener("abort", abortHandler)

        // Read response body
        let responseBody: string
        const contentType = response.headers.get("content-type") || ""

        if (contentType.includes("application/json")) {
          const json = await response.json()
          responseBody = JSON.stringify(json, null, 2)
        } else {
          responseBody = await response.text()
        }

        // Truncate response if too long
        const maxLength = 10_000
        const truncated = responseBody.length > maxLength
        if (truncated) {
          responseBody = responseBody.substring(0, maxLength) + "\n\n[Response truncated]"
        }

        log.info("remote trigger complete", {
          url,
          method,
          status: response.status,
          truncated,
        })

        return {
          title: `${method} ${new URL(url).hostname}`,
          metadata: {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            truncated,
          },
          output: `Status: ${response.status} ${response.statusText}\n\n${responseBody}`,
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return {
            title: `${method} ${new URL(url).hostname}`,
            metadata: {
              url,
              method,
              error: "Request timed out or was aborted",
            },
            output: `Request failed: timed out after ${timeout}ms`,
          }
        }

        log.error("remote trigger failed", { url, error: String(error) })
        throw error
      }
    },
  }
})
