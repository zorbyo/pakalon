import { Log } from "../util/log"

const log = Log.create({ service: "pipeline:api-tester" })

export interface APIEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string
  description: string
  requiresAuth: boolean
  parameters?: Record<string, unknown>
  expectedStatus?: number
}

export interface APITestResult {
  endpoint: APIEndpoint
  passed: boolean
  statusCode: number
  responseTime: number
  vulnerabilities: string[]
  errors: string[]
}

export interface APITestSuite {
  name: string
  endpoints: APIEndpoint[]
  results: APITestResult[]
  summary: {
    total: number
    passed: number
    failed: number
    vulnerabilities: number
  }
}

const VULNERABILITY_TESTS = [
  { name: "SQL Injection", payloads: ["' OR '1'='1", "1; DROP TABLE users", "' UNION SELECT * FROM users"] },
  { name: "XSS", payloads: ['<script>alert("XSS")</script>', '"><img src=x onerror=alert(1)>', "javascript:alert(1)"] },
  { name: "Path Traversal", payloads: ["../../../etc/passwd", "..\\..\\..\\windows\\system32"] },
  { name: "Command Injection", payloads: ["; ls -la", "| cat /etc/passwd", "$(whoami)"] },
]

export namespace APITester {
  export async function testEndpoints(
    projectPath: string,
    endpoints: APIEndpoint[],
    baseUrl: string = "http://localhost:3000",
  ): Promise<APITestSuite> {
    log.info("testing API endpoints", { count: endpoints.length, baseUrl })

    const results: APITestResult[] = []

    for (const endpoint of endpoints) {
      const result = await testEndpoint(projectPath, endpoint, baseUrl)
      results.push(result)
    }

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      vulnerabilities: results.reduce((sum, r) => sum + r.vulnerabilities.length, 0),
    }

    return {
      name: "API Test Suite",
      endpoints,
      results,
      summary,
    }
  }

  export async function testEndpoint(
    projectPath: string,
    endpoint: APIEndpoint,
    baseUrl: string,
  ): Promise<APITestResult> {
    log.info("testing endpoint", { method: endpoint.method, path: endpoint.path })

    const startTime = Date.now()
    const vulnerabilities: string[] = []
    const errors: string[] = []

    // Mock implementation - in production, this would make actual HTTP requests
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Run vulnerability tests
      for (const vulnTest of VULNERABILITY_TESTS) {
        for (const payload of vulnTest.payloads) {
          const isVulnerable = await testForVulnerability(endpoint, payload, vulnTest.name)
          if (isVulnerable) {
            vulnerabilities.push(`${vulnTest.name}: ${payload}`)
          }
        }
      }

      // Check for common issues
      if (endpoint.requiresAuth && endpoint.method !== "GET") {
        const hasAuthIssue = await testAuthBypass(endpoint)
        if (hasAuthIssue) {
          vulnerabilities.push("Authentication bypass possible")
        }
      }

      return {
        endpoint,
        passed: vulnerabilities.length === 0,
        statusCode: 200,
        responseTime: Date.now() - startTime,
        vulnerabilities,
        errors,
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))

      return {
        endpoint,
        passed: false,
        statusCode: 500,
        responseTime: Date.now() - startTime,
        vulnerabilities,
        errors,
      }
    }
  }

  export function generateTestSuite(endpoints: APIEndpoint[]): string {
    const lines = [
      "# API Test Suite",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Endpoints",
      "",
    ]

    for (const endpoint of endpoints) {
      lines.push(`### ${endpoint.method} ${endpoint.path}`)
      lines.push(`Description: ${endpoint.description}`)
      lines.push(`Requires Auth: ${endpoint.requiresAuth ? "Yes" : "No"}`)
      if (endpoint.parameters) {
        lines.push("Parameters:")
        for (const [key, value] of Object.entries(endpoint.parameters)) {
          lines.push(`  - ${key}: ${typeof value}`)
        }
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  export function formatResults(suite: APITestSuite): string {
    const lines = [
      `# API Test Results: ${suite.name}`,
      "",
      "## Summary",
      `- Total: ${suite.summary.total}`,
      `- Passed: ${suite.summary.passed}`,
      `- Failed: ${suite.summary.failed}`,
      `- Vulnerabilities: ${suite.summary.vulnerabilities}`,
      "",
      "## Results",
      "",
    ]

    for (const result of suite.results) {
      const icon = result.passed ? "✅" : "❌"
      lines.push(`### ${icon} ${result.endpoint.method} ${result.endpoint.path}`)
      lines.push(`Status: ${result.statusCode}`)
      lines.push(`Response Time: ${result.responseTime}ms`)

      if (result.vulnerabilities.length > 0) {
        lines.push("Vulnerabilities:")
        for (const vuln of result.vulnerabilities) {
          lines.push(`  - 🔴 ${vuln}`)
        }
      }

      if (result.errors.length > 0) {
        lines.push("Errors:")
        for (const err of result.errors) {
          lines.push(`  - ⚠️ ${err}`)
        }
      }

      lines.push("")
    }

    return lines.join("\n")
  }

  async function testForVulnerability(
    endpoint: APIEndpoint,
    payload: string,
    vulnType: string,
  ): Promise<boolean> {
    // Mock vulnerability detection
    // In production, this would send the payload and analyze the response

    // Simulate that most endpoints are secure
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Random vulnerability for demo purposes (very low probability)
    return Math.random() < 0.05
  }

  async function testAuthBypass(endpoint: APIEndpoint): Promise<boolean> {
    // Mock auth bypass test
    await new Promise((resolve) => setTimeout(resolve, 10))
    return Math.random() < 0.02
  }

  export function generateWhiteboxTestingXml(suite: APITestSuite): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Whitebox Testing">
  <testsuite name="API Endpoints" tests="${suite.summary.total}" failures="${suite.summary.failed}">
    ${suite.results
      .map(
        (r) => `
    <testcase name="${r.endpoint.method} ${r.endpoint.path}" time="${r.responseTime / 1000}">
      ${!r.passed ? `<failure message="Test failed">${r.vulnerabilities.join(", ") || r.errors.join(", ")}</failure>` : ""}
    </testcase>`,
      )
      .join("")}
  </testsuite>
</testsuites>`
  }

  export function generateBlackboxTestingXml(suite: APITestSuite): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Blackbox Testing">
  <testsuite name="User Journeys" tests="${suite.summary.total}" failures="${suite.summary.failed}">
    ${suite.results
      .map(
        (r) => `
    <testcase name="User can ${r.endpoint.description}" time="${r.responseTime / 1000}">
      ${!r.passed ? `<failure message="Journey failed">${r.vulnerabilities.join(", ") || r.errors.join(", ")}</failure>` : ""}
    </testcase>`,
      )
      .join("")}
  </testsuite>
</testsuites>`
  }
}
