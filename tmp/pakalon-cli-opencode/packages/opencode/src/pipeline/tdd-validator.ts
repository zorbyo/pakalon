import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import type { PhaseNumber } from "../pakalon"

const log = Log.create({ service: "pipeline:tdd-validator" })

export interface ValidationIssue {
  type: "mismatch" | "missing" | "extra" | "style" | "layout"
  description: string
  severity: "high" | "medium" | "low"
  element?: string
  expected?: string
  actual?: string
}

export interface ValidationResult {
  passed: boolean
  issues: ValidationIssue[]
  score: number
  timestamp: string
}

export namespace TDDValidator {
  export async function validateWireframe(
    projectPath: string,
    requirements: string,
  ): Promise<ValidationResult> {
    log.info("validating wireframe", { path: projectPath })

    const issues: ValidationIssue[] = []

    // Read wireframe files
    const wireframeDir = `${projectPath}/.pakalon-agents/wireframes`
    const hasWireframes = await FileStructure.exists(wireframeDir).catch(() => false)

    if (!hasWireframes) {
      issues.push({
        type: "missing",
        description: "No wireframes found",
        severity: "high",
      })
    }

    // Parse requirements
    const requirementsList = parseRequirements(requirements)

    // Check each requirement against wireframes
    for (const req of requirementsList) {
      const reqIssues = await checkRequirement(projectPath, req)
      issues.push(...reqIssues)
    }

    // Calculate score
    const totalChecks = requirementsList.length || 1
    const passedChecks = totalChecks - issues.filter((i) => i.severity === "high").length
    const score = Math.round((passedChecks / totalChecks) * 100)

    return {
      passed: issues.filter((i) => i.severity === "high").length === 0,
      issues,
      score,
      timestamp: new Date().toISOString(),
    }
  }

  export async function validateFrontend(
    projectPath: string,
    wireframePath: string,
  ): Promise<ValidationResult> {
    log.info("validating frontend against wireframe", { projectPath, wireframePath })

    const issues: ValidationIssue[] = []

    // Check if frontend files exist
    const srcDir = `${projectPath}/src`
    const hasFrontend = await FileStructure.exists(srcDir).catch(() => false)

    if (!hasFrontend) {
      issues.push({
        type: "missing",
        description: "No frontend source files found",
        severity: "high",
      })
    }

    // Check for common components
    const requiredComponents = ["layout", "header", "footer", "navigation"]
    for (const component of requiredComponents) {
      const exists = await checkComponentExists(projectPath, component)
      if (!exists) {
        issues.push({
          type: "missing",
          description: `Missing ${component} component`,
          severity: "medium",
          element: component,
        })
      }
    }

    // Check styling
    const hasStyles = await checkStylesExist(projectPath)
    if (!hasStyles) {
      issues.push({
        type: "missing",
        description: "No styling files found",
        severity: "medium",
      })
    }

    const score = calculateScore(issues)

    return {
      passed: issues.filter((i) => i.severity === "high").length === 0,
      issues,
      score,
      timestamp: new Date().toISOString(),
    }
  }

  export async function validateTDD(
    projectPath: string,
    phase: PhaseNumber,
  ): Promise<ValidationResult> {
    log.info("running TDD validation", { projectPath, phase })

    const screenshotsDir = `${projectPath}/.pakalon-agents/ai-agents/phase-${phase}/tdd-screenshots`
    await FileStructure.ensurePhaseDir(projectPath, phase)

    // Take screenshot
    const screenshotPath = `${screenshotsDir}/validation-${Date.now()}.png`
    await takeScreenshot(projectPath, screenshotPath)

    // Compare with requirements
    const phase1Content = await FileStructure.readArtifact(projectPath, 1, "plan.md")
    const result = await validateWireframe(projectPath, phase1Content ?? "")

    // Save validation report
    const report = generateValidationReport(result)
    await FileStructure.writeArtifact(projectPath, phase, "tdd-validation.md", report)

    return result
  }

  export function generateValidationReport(result: ValidationResult): string {
    const lines = [
      "# TDD Validation Report",
      "",
      `## Status: ${result.passed ? "✅ PASSED" : "❌ FAILED"}`,
      `## Score: ${result.score}%`,
      `## Timestamp: ${result.timestamp}`,
      "",
      "## Issues Found",
      "",
    ]

    if (result.issues.length === 0) {
      lines.push("No issues found. All requirements met.")
    } else {
      for (const issue of result.issues) {
        const icon =
          issue.severity === "high" ? "🔴" : issue.severity === "medium" ? "🟡" : "🔵"
        lines.push(`### ${icon} ${issue.type.toUpperCase()}: ${issue.description}`)
        if (issue.element) lines.push(`**Element:** ${issue.element}`)
        if (issue.expected) lines.push(`**Expected:** ${issue.expected}`)
        if (issue.actual) lines.push(`**Actual:** ${issue.actual}`)
        lines.push("")
      }
    }

    lines.push("---")
    lines.push("*Generated by Pakalon TDD Validator*")

    return lines.join("\n")
  }

  function parseRequirements(requirements: string): string[] {
    const lines = requirements.split("\n")
    const reqs: string[] = []

    for (const line of lines) {
      if (line.startsWith("- ") || line.startsWith("* ") || line.match(/^\d+\./)) {
        reqs.push(line.replace(/^[-*\d.]+\s*/, "").trim())
      }
    }

    return reqs.filter((r) => r.length > 3)
  }

  async function checkRequirement(
    projectPath: string,
    requirement: string,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = []

    // Simple keyword matching
    const keywords = requirement.toLowerCase().split(/\s+/)

    // Check for specific requirements
    if (keywords.includes("navigation") || keywords.includes("navbar")) {
      const hasNav = await checkComponentExists(projectPath, "nav")
      if (!hasNav) {
        issues.push({
          type: "missing",
          description: "Navigation component not found",
          severity: "high",
          element: "navigation",
          expected: "Navigation bar or menu",
          actual: "Not found",
        })
      }
    }

    if (keywords.includes("button")) {
      const hasButton = await checkComponentExists(projectPath, "button")
      if (!hasButton) {
        issues.push({
          type: "missing",
          description: "Button component not found",
          severity: "medium",
          element: "button",
        })
      }
    }

    return issues
  }

  async function checkComponentExists(
    projectPath: string,
    componentName: string,
  ): Promise<boolean> {
    const patterns = [
      `**/*${componentName}*`,
      `**/${componentName}.tsx`,
      `**/${componentName}.jsx`,
      `**/${componentName}.vue`,
    ]

    for (const pattern of patterns) {
      try {
        const { glob } = await import("fs/promises")
        const files = await Array.fromAsync?.(glob(pattern, { cwd: projectPath })) ?? []
        if (files.length > 0) return true
      } catch {
        // Continue to next pattern
      }
    }

    return false
  }

  async function checkStylesExist(projectPath: string): Promise<boolean> {
    const stylePatterns = [
      "**/*.css",
      "**/*.scss",
      "**/tailwind.config.*",
      "**/styles/**",
    ]

    for (const pattern of stylePatterns) {
      try {
        const { glob } = await import("fs/promises")
        const files = await Array.fromAsync?.(glob(pattern, { cwd: projectPath })) ?? []
        if (files.length > 0) return true
      } catch {
        // Continue
      }
    }

    return false
  }

  async function takeScreenshot(projectPath: string, outputPath: string): Promise<void> {
    // In production, this would use a headless browser
    log.info("taking screenshot", { outputPath })

    // Create placeholder screenshot
    const fs = await import("fs/promises")
    const dir = outputPath.substring(0, outputPath.lastIndexOf("/"))
    await fs.mkdir(dir, { recursive: true })

    // Write placeholder
    await fs.writeFile(outputPath, "Screenshot placeholder", "utf-8")
  }

  function calculateScore(issues: ValidationIssue[]): number {
    const highCount = issues.filter((i) => i.severity === "high").length
    const mediumCount = issues.filter((i) => i.severity === "medium").length
    const lowCount = issues.filter((i) => i.severity === "low").length

    // Each high = -20, medium = -10, low = -5
    const deductions = highCount * 20 + mediumCount * 10 + lowCount * 5
    return Math.max(0, 100 - deductions)
  }
}
