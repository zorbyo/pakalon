/**
 * CYBER_RISK_INSTRUCTION
 *
 * This instruction provides guidance for the AI's behavior when handling
 * security-related requests. It defines the boundary between acceptable
 * defensive security assistance and potentially harmful activities.
 *
 * IMPORTANT: DO NOT MODIFY THIS INSTRUCTION WITHOUT SECURITY TEAM REVIEW
 *
 * This instruction is owned by the Security team and has been carefully
 * crafted and evaluated to balance security utility with safety. Changes
 * to this text can have significant implications for:
 *   - How the AI handles penetration testing and CTF requests
 *   - What security tools and techniques the AI will assist with
 *   - The boundary between defensive and offensive security assistance
 *
 * If you need to modify this instruction:
 *   1. Contact the Security team
 *   2. Ensure proper evaluation of the changes
 *   3. Get explicit approval before merging
 */
export const CYBER_RISK_INSTRUCTION = `IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`

/**
 * Security-related constants for code analysis
 */
export const SECURITY_SCAN_PATTERNS = {
  // Common vulnerability patterns to detect
  SQL_INJECTION: /(\$\{|%s|%d|\+\s*['"])/,
  XSS: /(innerHTML|outerHTML|document\.write|eval\()/,
  COMMAND_INJECTION: /(exec|spawn|system|shell_exec|passthru)/,
  PATH_TRAVERSAL: /(\.\.\/|\.\.\\)/,
  HARDCODED_SECRETS: /(api[_-]?key|password|secret|token)\s*[=:]\s*['"][^'"]+['"]/i,
  INSECURE_RANDOM: /(Math\.random|random\.random)/,
  INSECURE_HASH: /(md5|sha1)\(/i,
} as const

/**
 * Severity levels for security findings
 */
export const SECURITY_SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
} as const

export type SecuritySeverity = (typeof SECURITY_SEVERITY)[keyof typeof SECURITY_SEVERITY]

/**
 * Security tool integrations
 */
export const SECURITY_TOOLS = {
  SAST: ['semgrep', 'bandit', 'eslint-security'],
  DAST: ['zap', 'nuclei'],
  DEPENDENCY: ['npm-audit', 'pip-audit', 'snyk'],
  SECRETS: ['trufflehog', 'gitleaks'],
} as const
