import * as fs from 'fs/promises';
import * as path from 'path';

export interface XmlArtifact {
  filePath: string;
  content: string;
}

interface BlackboxTestCase {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  technique: string;
  expectedResult: string;
}

interface BlackboxCategory {
  name: string;
  tests: BlackboxTestCase[];
}

interface WhiteboxCheck {
  id: string;
  name: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  tool: string;
  config: string;
}

interface SourceFileSummary {
  path: string;
  language: string;
  linesOfCode: number;
}

const OUTPUT_DIR = path.join('.pakalon-agents', 'phase-4');

const BLACKBOX_CATEGORIES: BlackboxCategory[] = [
  {
    name: 'Information Gathering',
    tests: [
      {
        id: 'BBX-IG-001',
        name: 'DNS Enumeration',
        description: 'Enumerate subdomains, hostnames, and exposed DNS records for the target.',
        severity: 'medium',
        technique: 'Passive and active DNS discovery',
        expectedResult: 'Discovery of attack surface or confirmation of DNS hardening.',
      },
      {
        id: 'BBX-IG-002',
        name: 'Directory Brute-Forcing',
        description: 'Probe common paths, backups, and hidden directories for unintended exposure.',
        severity: 'medium',
        technique: 'Wordlist-based content discovery',
        expectedResult: 'Identify exposed admin, backup, or debug endpoints.',
      },
      {
        id: 'BBX-IG-003',
        name: 'Technology Fingerprinting',
        description: 'Identify server, framework, and middleware versions from headers and responses.',
        severity: 'low',
        technique: 'Header analysis and banner fingerprinting',
        expectedResult: 'Reveal stack details that may enable targeted exploitation.',
      },
    ],
  },
  {
    name: 'Authentication Testing',
    tests: [
      {
        id: 'BBX-AUTHN-001',
        name: 'Authentication Bypass',
        description: 'Attempt direct access to protected resources without valid credentials.',
        severity: 'critical',
        technique: 'Unauthenticated request replay and session omission',
        expectedResult: 'Access is denied for all protected endpoints.',
      },
      {
        id: 'BBX-AUTHN-002',
        name: 'Brute Force Protection',
        description: 'Validate rate limiting, lockout, and MFA enforcement on login flows.',
        severity: 'high',
        technique: 'Credential spraying and repeated login attempts',
        expectedResult: 'Account protections trigger before successful guessing is possible.',
      },
      {
        id: 'BBX-AUTHN-003',
        name: 'Session Fixation',
        description: 'Test whether pre-set session identifiers survive authentication boundaries.',
        severity: 'high',
        technique: 'Pre-auth session reuse across login',
        expectedResult: 'Session identifiers rotate after authentication.',
      },
    ],
  },
  {
    name: 'Authorization Testing',
    tests: [
      {
        id: 'BBX-AUTHZ-001',
        name: 'IDOR Validation',
        description: 'Mutate object identifiers to verify broken object-level authorization controls.',
        severity: 'critical',
        technique: 'Horizontal privilege probing',
        expectedResult: 'Users can only access objects they own or are explicitly allowed to view.',
      },
      {
        id: 'BBX-AUTHZ-002',
        name: 'Privilege Escalation',
        description: 'Attempt access to admin or elevated workflows using low-privilege accounts.',
        severity: 'critical',
        technique: 'Role tampering and route probing',
        expectedResult: 'Unauthorized role escalation is blocked everywhere.',
      },
    ],
  },
  {
    name: 'Input Validation',
    tests: [
      {
        id: 'BBX-INPUT-001',
        name: 'Cross-Site Scripting',
        description: 'Inject reflected and stored XSS payloads in form fields and query parameters.',
        severity: 'high',
        technique: 'Script payload injection and encoding bypass',
        expectedResult: 'Output encoding or sanitization neutralizes payload execution.',
      },
      {
        id: 'BBX-INPUT-002',
        name: 'SQL Injection',
        description: 'Probe SQL query inputs with boolean, error-based, and union-based payloads.',
        severity: 'critical',
        technique: 'DBMS payload injection',
        expectedResult: 'Parameterized queries and input validation prevent injection.',
      },
      {
        id: 'BBX-INPUT-003',
        name: 'Command Injection',
        description: 'Submit shell metacharacters to identify unsafe command execution.',
        severity: 'critical',
        technique: 'OS command separator payloads',
        expectedResult: 'System commands cannot be influenced by user input.',
      },
      {
        id: 'BBX-INPUT-004',
        name: 'Server-Side Request Forgery',
        description: 'Test whether user-controlled URLs can reach internal or cloud metadata targets.',
        severity: 'critical',
        technique: 'URL redirection and internal network targeting',
        expectedResult: 'Outbound requests are restricted to approved destinations only.',
      },
      {
        id: 'BBX-INPUT-005',
        name: 'Local File Inclusion',
        description: 'Attempt path traversal and file inclusion payloads against file parameters.',
        severity: 'critical',
        technique: 'Traversal sequence testing',
        expectedResult: 'File access is constrained to approved application paths.',
      },
    ],
  },
  {
    name: 'Session Management',
    tests: [
      {
        id: 'BBX-SESS-001',
        name: 'Cookie Attributes',
        description: 'Verify secure, HttpOnly, SameSite, and path/domain attributes on cookies.',
        severity: 'high',
        technique: 'Header inspection and cookie replay',
        expectedResult: 'Cookies use the strongest feasible attributes for the application.',
      },
      {
        id: 'BBX-SESS-002',
        name: 'CSRF Resistance',
        description: 'Attempt state-changing requests without CSRF tokens or origin protection.',
        severity: 'high',
        technique: 'Cross-site form and fetch replay',
        expectedResult: 'Requests without valid anti-CSRF protection are rejected.',
      },
      {
        id: 'BBX-SESS-003',
        name: 'Secure Flag Enforcement',
        description: 'Ensure session cookies are never exposed over plaintext transport.',
        severity: 'high',
        technique: 'HTTP downgrade and cookie inspection',
        expectedResult: 'Sensitive cookies are only sent over secure channels.',
      },
    ],
  },
  {
    name: 'Data Validation',
    tests: [
      {
        id: 'BBX-DATA-001',
        name: 'Mass Assignment',
        description: 'Submit extra fields in JSON and form bodies to test server-side field whitelisting.',
        severity: 'high',
        technique: 'Property over-posting',
        expectedResult: 'Only explicitly permitted fields are persisted.',
      },
      {
        id: 'BBX-DATA-002',
        name: 'Parameter Pollution',
        description: 'Duplicate parameters to observe parser inconsistencies and privilege drift.',
        severity: 'medium',
        technique: 'Repeated parameter injection',
        expectedResult: 'Parameter parsing is deterministic and safe.',
      },
    ],
  },
  {
    name: 'Business Logic',
    tests: [
      {
        id: 'BBX-BIZ-001',
        name: 'Workflow Bypass',
        description: 'Skip required UI or API steps to validate server-side business rule enforcement.',
        severity: 'high',
        technique: 'Sequence manipulation and endpoint replay',
        expectedResult: 'Workflow guards prevent out-of-order state changes.',
      },
      {
        id: 'BBX-BIZ-002',
        name: 'Race Condition Testing',
        description: 'Execute concurrent operations to look for double-spend or duplicate-state bugs.',
        severity: 'critical',
        technique: 'Concurrent request flooding',
        expectedResult: 'Critical operations remain atomic and idempotent.',
      },
    ],
  },
];

const WHITEBOX_CHECKS: WhiteboxCheck[] = [
  {
    id: 'WBX-SAST-001',
    name: 'Semgrep Rule Pack',
    category: 'SAST Configuration',
    severity: 'high',
    tool: 'semgrep',
    config: 'semgrep --config p/security-audit --config p/owasp-top-ten',
  },
  {
    id: 'WBX-SAST-002',
    name: 'Gitleaks Pattern Scan',
    category: 'Secret Detection',
    severity: 'critical',
    tool: 'gitleaks',
    config: 'gitleaks detect --no-git --redact --report-format json',
  },
  {
    id: 'WBX-SAST-003',
    name: 'ESLint Security Rules',
    category: 'Code Quality',
    severity: 'medium',
    tool: 'eslint',
    config: 'security/detect-object-injection:error, no-eval:error, no-implied-eval:error',
  },
  {
    id: 'WBX-DEP-001',
    name: 'npm Audit',
    category: 'Dependency Scan',
    severity: 'high',
    tool: 'npm audit',
    config: 'npm audit --json --audit-level high',
  },
  {
    id: 'WBX-DEP-002',
    name: 'Snyk Dependency Review',
    category: 'Dependency Scan',
    severity: 'high',
    tool: 'snyk',
    config: 'snyk test --severity-threshold=high',
  },
  {
    id: 'WBX-DEP-003',
    name: 'Trivy Container Scan',
    category: 'Dependency Scan',
    severity: 'medium',
    tool: 'trivy',
    config: 'trivy fs --scanners vuln,secret,misconfig .',
  },
  {
    id: 'WBX-SEC-001',
    name: 'API Key Pattern Detection',
    category: 'Secret Detection',
    severity: 'critical',
    tool: 'regex',
    config: String.raw`(?i)(api[_-]?key|client[_-]?secret|secret|token)\s*[:=]\s*['\"][^'\"]{12,}['\"]`,
  },
  {
    id: 'WBX-SEC-002',
    name: 'Bearer Token Detection',
    category: 'Secret Detection',
    severity: 'critical',
    tool: 'regex',
    config: String.raw`(?i)bearer\s+[a-z0-9\-_.=]{16,}`, 
  },
  {
    id: 'WBX-SEC-003',
    name: 'Password Assignment Detection',
    category: 'Secret Detection',
    severity: 'high',
    tool: 'regex',
    config: String.raw`(?i)(password|passphrase|pwd)\s*[:=]\s*['\"][^'\"]{8,}['\"]`,
  },
  {
    id: 'WBX-SEC-004',
    name: 'JWT Detection',
    category: 'Secret Detection',
    severity: 'high',
    tool: 'regex',
    config: String.raw`eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}`,
  },
  {
    id: 'WBX-SEC-005',
    name: 'SSH Private Key Detection',
    category: 'Secret Detection',
    severity: 'critical',
    tool: 'regex',
    config: String.raw`-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----`,
  },
  {
    id: 'WBX-QLT-001',
    name: 'Cyclomatic Complexity Threshold',
    category: 'Code Quality',
    severity: 'medium',
    tool: 'eslint',
    config: 'complexity: <= 10 per function',
  },
  {
    id: 'WBX-QLT-002',
    name: 'Duplication Threshold',
    category: 'Code Quality',
    severity: 'medium',
    tool: 'sonarqube',
    config: 'duplication <= 3% per module',
  },
  {
    id: 'WBX-QLT-003',
    name: 'Coverage Threshold',
    category: 'Code Quality',
    severity: 'medium',
    tool: 'vitest',
    config: 'coverage statements >= 80%, branches >= 75%',
  },
];

const COMPLIANCE_CONTROLS = [
  {
    framework: 'PCI-DSS',
    controls: ['6.2 secure coding practices', '6.5 injection defense', '8.2 strong authentication', '11.3 penetration testing'],
  },
  {
    framework: 'SOC2',
    controls: ['CC6.1 logical access', 'CC6.6 vulnerability management', 'CC7.1 monitoring', 'CC7.2 incident response'],
  },
  {
    framework: 'GDPR',
    controls: ['Article 25 privacy by design', 'Article 32 security of processing', 'Article 33 breach detection', 'Article 5 data minimization'],
  },
];

const TOOL_CONFIGURATION = [
  {
    name: 'nmap',
    purpose: 'Network and service discovery',
    command: 'nmap -sV -sC -Pn -T4 --top-ports 1000 <target-host>',
  },
  {
    name: 'nikto',
    purpose: 'Web server and misconfiguration checks',
    command: 'nikto -h <target-host> -Format xml -output .pakalon/nikto-results.xml',
  },
  {
    name: 'zap',
    purpose: 'Dynamic application scanning',
    command: 'zap.sh -cmd -quickurl <target-url> -quickout .pakalon/zap-results.xml',
  },
  {
    name: 'sqlmap',
    purpose: 'Automated SQL injection validation',
    command: 'sqlmap -u "<target-url>" --batch --risk=3 --level=5',
  },
  {
    name: 'ffuf',
    purpose: 'Content discovery and parameter fuzzing',
    command: 'ffuf -u <target-url>/FUZZ -w <wordlist> -mc all',
  },
  {
    name: 'curl',
    purpose: 'Manual request replay and header validation',
    command: 'curl -i -sS -H "Authorization: Bearer <token>" -H "Origin: <origin>" <target-url>',
  },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function xmlElement(name: string, value: string, indent = 0): string {
  const pad = '  '.repeat(indent);
  return `${pad}<${name}>${escapeXml(value)}</${name}>`;
}

function cdataElement(name: string, value: string, indent = 0): string {
  const pad = '  '.repeat(indent);
  return `${pad}<${name}>${cdata(value)}</${name}>`;
}

function normalizeSourcePath(projectDir: string, sourceFile: string): string {
  const absolute = path.isAbsolute(sourceFile) ? sourceFile : path.join(projectDir, sourceFile);
  return path.relative(projectDir, absolute).replace(/\\/g, '/');
}

function languageForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TSX',
    '.js': 'JavaScript',
    '.jsx': 'JSX',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.json': 'JSON',
    '.yml': 'YAML',
    '.yaml': 'YAML',
    '.md': 'Markdown',
    '.html': 'HTML',
    '.css': 'CSS',
    '.sh': 'Shell',
  };
  return map[ext] ?? 'Unknown';
}

async function ensureOutputDir(projectDir: string): Promise<string> {
  const outputDir = path.join(projectDir, OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function summarizeSourceFiles(projectDir: string, sourceFiles: string[]): Promise<SourceFileSummary[]> {
  const summaries: SourceFileSummary[] = [];

  for (const sourceFile of sourceFiles) {
    const normalized = normalizeSourcePath(projectDir, sourceFile);
    const absolute = path.isAbsolute(sourceFile) ? sourceFile : path.join(projectDir, sourceFile);

    try {
      const content = await fs.readFile(absolute, 'utf8');
      const linesOfCode = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
      summaries.push({
        path: normalized,
        language: languageForFile(normalized),
        linesOfCode,
      });
    } catch {
      summaries.push({
        path: normalized,
        language: languageForFile(normalized),
        linesOfCode: 0,
      });
    }
  }

  return summaries;
}

function buildBlackboxXml(targetUrl: string, projectDir: string): string {
  const generatedAt = new Date().toISOString();

  const categoriesXml = BLACKBOX_CATEGORIES.map((category) => [
    `    <category name="${escapeXml(category.name)}">`,
    ...category.tests.map((test) => [
      `      <test-case id="${escapeXml(test.id)}">`,
      xmlElement('name', test.name, 8),
      xmlElement('description', test.description, 8),
      xmlElement('severity', test.severity.toUpperCase(), 8),
      xmlElement('technique', test.technique, 8),
      xmlElement('expected-result', test.expectedResult, 8),
      '      </test-case>',
    ].join('\n')),
    '    </category>',
  ].join('\n')).join('\n');

  const toolConfigXml = TOOL_CONFIGURATION.map((tool) => [
    `    <tool name="${escapeXml(tool.name)}">`,
    xmlElement('purpose', tool.purpose, 6),
    cdataElement('command', tool.command, 6),
    '    </tool>',
  ].join('\n')).join('\n');

  const remediationXml = [
    '    <priority level="P1">',
    xmlElement('severity', 'critical', 6),
    xmlElement('sla', '24 hours', 6),
    xmlElement('examples', 'Authentication bypass, SQL injection, SSRF, command injection', 6),
    '    </priority>',
    '    <priority level="P2">',
    xmlElement('severity', 'high', 6),
    xmlElement('sla', '72 hours', 6),
    xmlElement('examples', 'Authorization flaws, XSS, CSRF, session management gaps', 6),
    '    </priority>',
    '    <priority level="P3">',
    xmlElement('severity', 'medium', 6),
    xmlElement('sla', '7 days', 6),
    xmlElement('examples', 'Information exposure, parameter pollution, fingerprinting', 6),
    '    </priority>',
    '    <priority level="P4">',
    xmlElement('severity', 'low', 6),
    xmlElement('sla', '30 days', 6),
    xmlElement('examples', 'Hardening issues and minor configuration gaps', 6),
    '    </priority>',
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<blackbox-testing>
  <metadata>
${xmlElement('title', 'Phase 4 Blackbox Security Testing', 4)}
${xmlElement('description', 'Blackbox testing plan for dynamic security validation.', 4)}
${xmlElement('target', targetUrl, 4)}
${xmlElement('project-dir', projectDir, 4)}
${xmlElement('generated-at', generatedAt, 4)}
${xmlElement('methodology', 'OWASP Top 10 coverage with authenticated and unauthenticated attack paths.', 4)}
  </metadata>
  <test-categories>
${categoriesXml}
  </test-categories>
  <tool-configuration>
${toolConfigXml}
  </tool-configuration>
  <reporting-template>
    <section name="executive-summary">Target, methodology, and highest-risk findings.</section>
    <section name="test-execution">Test case status, evidence, and timestamps.</section>
    <section name="findings">Severity, impact, reproduction steps, and remediation.</section>
    <section name="appendix">Raw requests, screenshots, and supporting artifacts.</section>
  </reporting-template>
  <remediation-priority-matrix>
${remediationXml}
  </remediation-priority-matrix>
</blackbox-testing>
`;
}

function buildWhiteboxXml(projectDir: string, sourceFiles: SourceFileSummary[]): string {
  const generatedAt = new Date().toISOString();
  const totalLoc = sourceFiles.reduce((sum, file) => sum + file.linesOfCode, 0);

  const filesXml = sourceFiles.map((file) => [
    `      <file path="${escapeXml(file.path)}" language="${escapeXml(file.language)}">`,
    xmlElement('lines-of-code', String(file.linesOfCode), 8),
    '      </file>',
  ].join('\n')).join('\n');

  const languages = new Map<string, { files: number; lines: number }>();
  for (const file of sourceFiles) {
    const current = languages.get(file.language) ?? { files: 0, lines: 0 };
    current.files += 1;
    current.lines += file.linesOfCode;
    languages.set(file.language, current);
  }

  const languagesXml = [...languages.entries()].map(([language, stats]) => [
    `      <language name="${escapeXml(language)}">`,
    xmlElement('files', String(stats.files), 8),
    xmlElement('lines-of-code', String(stats.lines), 8),
    '      </language>',
  ].join('\n')).join('\n');

  const checksXml = WHITEBOX_CHECKS.map((check) => [
    `    <check id="${escapeXml(check.id)}" category="${escapeXml(check.category)}">`,
    xmlElement('name', check.name, 6),
    xmlElement('severity', check.severity.toUpperCase(), 6),
    xmlElement('tool', check.tool, 6),
    cdataElement('config', check.config, 6),
    '    </check>',
  ].join('\n')).join('\n');

  const secretPatterns = [
    String.raw`(?i)(api[_-]?key|client[_-]?secret|secret|token)\s*[:=]\s*['\"][^'\"]{12,}['\"]`,
    String.raw`(?i)(password|passphrase|pwd)\s*[:=]\s*['\"][^'\"]{8,}['\"]`,
    String.raw`eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}`,
    String.raw`-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----`,
  ];

  const complianceXml = COMPLIANCE_CONTROLS.map((framework) => [
    `    <framework name="${escapeXml(framework.framework)}">`,
    ...framework.controls.map((control) => xmlElement('control', control, 6)),
    '    </framework>',
  ].join('\n')).join('\n');

  const secretPatternsXml = secretPatterns.map((pattern) => cdataElement('pattern', pattern, 6)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<whitebox-testing>
  <metadata>
${xmlElement('title', 'Phase 4 Whitebox Security Testing', 4)}
${xmlElement('description', 'Whitebox testing plan for static security validation.', 4)}
${xmlElement('project-dir', projectDir, 4)}
${xmlElement('generated-at', generatedAt, 4)}
${xmlElement('methodology', 'Static analysis, dependency review, secret detection, and code quality thresholds.', 4)}
  </metadata>
  <code-review-scope>
    <files total="${sourceFiles.length}">
${filesXml || '      <file path="(none)" language="Unknown"><lines-of-code>0</lines-of-code></file>'}
    </files>
    <languages>
${languagesXml || '      <language name="Unknown"><files>0</files><lines-of-code>0</lines-of-code></language>'}
    </languages>
    <lines-of-code total="${totalLoc}" />
  </code-review-scope>
  <sast-configuration>
${checksXml}
  </sast-configuration>
  <dependency-scan>
    <check id="WBX-DEP-001" name="npm Audit" category="Dependency Scan" severity="HIGH">
${cdataElement('tool', 'npm audit --json --audit-level high', 6)}
    </check>
    <check id="WBX-DEP-002" name="Snyk" category="Dependency Scan" severity="HIGH">
${cdataElement('tool', 'snyk test --severity-threshold=high', 6)}
    </check>
    <check id="WBX-DEP-003" name="Trivy" category="Dependency Scan" severity="MEDIUM">
${cdataElement('tool', 'trivy fs --scanners vuln,secret,misconfig .', 6)}
    </check>
  </dependency-scan>
  <secret-detection>
${secretPatternsXml}
  </secret-detection>
  <code-quality>
${cdataElement('threshold', 'complexity <= 10', 4)}
${cdataElement('threshold', 'duplication <= 3%', 4)}
${cdataElement('threshold', 'coverage-statements >= 80%', 4)}
${cdataElement('threshold', 'coverage-branches >= 75%', 4)}
  </code-quality>
  <findings-format>
    <field>title</field>
    <field>severity</field>
    <field>file</field>
    <field>line</field>
    <field>description</field>
    <field>remediation</field>
  </findings-format>
  <compliance-mapping>
${complianceXml}
  </compliance-mapping>
</whitebox-testing>
`;
}

export async function generateBlackboxXml(targetUrl: string, projectDir: string): Promise<XmlArtifact> {
  const outputDir = await ensureOutputDir(projectDir);
  const filePath = path.join(outputDir, 'blackbox_testing.xml');
  const content = buildBlackboxXml(targetUrl, projectDir);
  await fs.writeFile(filePath, content, 'utf8');
  return { filePath, content };
}

export async function generateWhiteboxXml(projectDir: string, sourceFiles: string[]): Promise<XmlArtifact> {
  const outputDir = await ensureOutputDir(projectDir);
  const filePath = path.join(outputDir, 'whitebox_testing.xml');
  const summaries = await summarizeSourceFiles(projectDir, sourceFiles);
  const content = buildWhiteboxXml(projectDir, summaries);
  await fs.writeFile(filePath, content, 'utf8');
  return { filePath, content };
}
