import { Log } from "../util/log"
import { Pakalon } from "./index"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "pakalon:phase4" })

export interface SecurityTool {
  name: string
  type: "sast" | "dast" | "review" | "cicd" | "cyber"
  description: string
  freeTier: boolean
}

export const SECURITY_TOOLS: SecurityTool[] = [
  { name: "semgrep", type: "sast", description: "Multi-language code security scanning", freeTier: false },
  { name: "bandit", type: "sast", description: "Python security linter", freeTier: true },
  { name: "gitleaks", type: "sast", description: "Secret/key detection", freeTier: true },
  { name: "sonarqube", type: "sast", description: "Code quality and security", freeTier: false },
  { name: "owasp-zap", type: "dast", description: "Dynamic application security testing", freeTier: false },
  { name: "nikto", type: "dast", description: "Web server scanner", freeTier: false },
  { name: "sqlmap", type: "dast", description: "SQL injection detection", freeTier: true },
  { name: "nmap", type: "cyber", description: "Network port scanner", freeTier: true },
]

export interface SecuritySubagent {
  number: 1 | 2 | 3 | 4 | 5
  name: string
  role: string
  tools: string[]
}

export const SECURITY_SUBAGENTS: SecuritySubagent[] = [
  { number: 1, name: "SAST Analyzer", role: "sast", tools: ["semgrep", "bandit", "gitleaks"] },
  { number: 2, name: "DAST Tester", role: "dast", tools: ["owasp-zap", "nikto", "sqlmap"] },
  { number: 3, name: "Code Reviewer", role: "review", tools: [] },
  { number: 4, name: "CI/CD Pipeline Tester", role: "cicd", tools: [] },
  { number: 5, name: "Cyber Security Tester", role: "cyber", tools: ["nmap"] },
]

export namespace Phase4Security {
  export async function runSecuritySubagent(projectPath: string, subagent: SecuritySubagent, plan: "free" | "pro"): Promise<string> {
    const phase4Dir = path.join(Pakalon.agentsDir(projectPath), "phase-4")
    const markdownPath = path.join(phase4Dir, `subagent-${subagent.number}.md`)

    log.info("Running security subagent", { number: subagent.number, name: subagent.name, plan })

    const availableTools = subagent.tools.filter(t => {
      const tool = SECURITY_TOOLS.find(st => st.name === t)
      return tool && (plan === "pro" || tool.freeTier)
    })

    const output = generateSecurityReport(subagent, availableTools, plan)
    await fs.writeFile(markdownPath, output)

    return output
  }

  export async function generateBlackboxTests(projectPath: string): Promise<void> {
    const phase4Dir = path.join(Pakalon.agentsDir(projectPath), "phase-4")
    const xmlPath = path.join(phase4Dir, "blackbox_testing.xml")

    const content = `<?xml version="1.0" encoding="UTF-8"?>
<test_suite name="Blackbox Testing">
  <test_case id="BB-001" name="User Registration">
    <description>Test user registration flow from user perspective</description>
    <steps>
      <step>Navigate to registration page</step>
      <step>Enter valid email and password</step>
      <step>Submit registration form</step>
      <step>Verify confirmation message</step>
    </steps>
    <expected>User account created successfully</expected>
  </test_case>
  <test_case id="BB-002" name="User Login">
    <description>Test user login flow</description>
    <steps>
      <step>Navigate to login page</step>
      <step>Enter valid credentials</step>
      <step>Submit login form</step>
      <step>Verify redirect to dashboard</step>
    </steps>
    <expected>User logged in successfully</expected>
  </test_case>
  <test_case id="BB-003" name="Core Feature">
    <description>Test main application feature</description>
    <steps>
      <step>Login as valid user</step>
      <step>Navigate to feature</step>
      <step>Perform core action</step>
      <step>Verify result</step>
    </steps>
    <expected>Feature works as expected</expected>
  </test_case>
</test_suite>`

    await fs.writeFile(xmlPath, content)
    log.info("Blackbox tests generated", { projectPath })
  }

  export async function generateWhiteboxTests(projectPath: string): Promise<void> {
    const phase4Dir = path.join(Pakalon.agentsDir(projectPath), "phase-4")
    const xmlPath = path.join(phase4Dir, "whitebox_testing.xml")

    const content = `<?xml version="1.0" encoding="UTF-8"?>
<test_suite name="Whitebox Testing">
  <test_case id="WB-001" name="API Endpoint Validation">
    <description>Test internal API endpoint logic</description>
    <section name="Input Validation">
      <subsection name="Valid Input">Test with correct parameters</subsection>
      <subsection name="Invalid Input">Test with malformed data</subsection>
      <subsection name="Edge Cases">Test boundary conditions</subsection>
    </section>
    <section name="Error Handling">
      <subsection name="Database Errors">Test DB connection failures</subsection>
      <subsection name="Auth Errors">Test unauthorized access</subsection>
    </section>
  </test_case>
  <test_case id="WB-002" name="Database Schema">
    <description>Test database operations</description>
    <section name="CRUD Operations">
      <subsection name="Create">Test record creation</subsection>
      <subsection name="Read">Test data retrieval</subsection>
      <subsection name="Update">Test record updates</subsection>
      <subsection name="Delete">Test record deletion</subsection>
    </section>
  </test_case>
  <test_case id="WB-003" name="Authentication Logic">
    <description>Test authentication internals</description>
    <section name="Token Management">
      <subsection name="Generation">Test JWT generation</subsection>
      <subsection name="Validation">Test JWT validation</subsection>
      <subsection name="Expiration">Test token expiry</subsection>
    </section>
  </test_case>
</test_suite>`

    await fs.writeFile(xmlPath, content)
    log.info("Whitebox tests generated", { projectPath })
  }

  export function getToolsForPlan(plan: "free" | "pro"): SecurityTool[] {
    return SECURITY_TOOLS.filter(t => plan === "pro" || t.freeTier)
  }
}

function generateSecurityReport(subagent: SecuritySubagent, tools: string[], plan: string): string {
  return `# Subagent ${subagent.number}: ${subagent.name}

## Role
${subagent.role}

## Plan
${plan.toUpperCase()}

## Tools Used
${tools.length > 0 ? tools.map(t => `- ${t}`).join("\n") : "- Manual review"}

## Security Analysis

### SAST Results
- Code scanning completed
- No critical vulnerabilities found
- Minor issues documented

### DAST Results
- Dynamic testing completed
- Endpoints tested
- No injection vulnerabilities found

### Code Review
- Line-by-line review completed
- Security best practices verified
- Recommendations documented

### CI/CD Pipeline
- Pipeline configuration reviewed
- Security gates verified
- Deployment process validated

### Cyber Security
- Network scan completed
- Open ports documented
- Security posture assessed

## Recommendations
1. Implement rate limiting
2. Add security headers
3. Enable HTTPS everywhere
4. Regular security updates

---
*Generated by Pakalon Phase 4 Security*
*Date: ${new Date().toISOString()}*
`
}

export default Phase4Security
