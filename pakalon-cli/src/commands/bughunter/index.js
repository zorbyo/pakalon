import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import type { Command } from '../../commands.js'

const BUGHUNTER_MARKDOWN = `---
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(git remote show:*), Read, Glob, Grep, LS, Task
description: Analyze pending branch changes for bugs, security vulnerabilities, and code quality issues
---

You are a senior code reviewer performing a bug-hunting analysis of the changes on this branch.

GIT STATUS:

\`\`\`
!\`git status\`
\`\`\`

FILES MODIFIED:

\`\`\`
!\`git diff --name-only origin/HEAD...\`
\`\`\`

COMMITS:

\`\`\`
!\`git log --no-decorate origin/HEAD...\`
\`\`\`

DIFF CONTENT:

\`\`\`
!\`git diff origin/HEAD...\`
\`\`\`

Review the complete diff above. This contains all code changes in the PR.

OBJECTIVE:
Perform a bug-hunting review focused on concrete defects introduced by this PR. Identify bugs, security vulnerabilities, correctness problems, race conditions, broken edge cases, and actionable code quality issues that are likely to affect real users.

CRITICAL INSTRUCTIONS:
1. MINIMIZE FALSE POSITIVES: Only report issues with clear code evidence and plausible impact.
2. FOCUS ON NEW CHANGES: Do not report pre-existing issues unless the PR makes them materially worse.
3. BE SPECIFIC: Every finding must include exact file and line locations.
4. BE ACTIONABLE: Each finding must include a concrete fix recommendation.
5. AVOID NOISE: Skip style nitpicks unless they cause maintainability or correctness problems.

WHAT TO LOOK FOR:

**Bugs / Correctness Issues**
- Off-by-one errors, wrong comparisons, broken branching logic
- Missing null / undefined checks where runtime failure is plausible
- State synchronization bugs and stale data usage
- Incorrect async handling, forgotten awaits, swallowed errors
- Broken edge cases, especially empty / partial / malformed inputs

**Security Vulnerabilities**
- Injection issues, path traversal, authz bypass, unsafe deserialization
- Secret leakage, unsafe logging, unsafe filesystem or shell usage
- Insecure direct object references or privilege escalation paths

**Code Smells / Anti-patterns**
- Duplicated logic, overly complex control flow, leaky abstractions
- Misleading names, dead code, unreachable branches, brittle assumptions
- Poor error handling that masks failures or creates silent corruption

ANALYSIS METHOD:
1. Use repository exploration tools to understand surrounding context and established patterns.
2. Inspect the full branch diff and trace data flow through changed code.
3. For each suspicious pattern, determine whether it is concrete and user-facing.

REQUIRED OUTPUT FORMAT:

Return a structured markdown report with one section per finding.

For each finding include:
- File and line number
- Severity: Critical, High, Medium, or Low
- Category: bug, security, code_smell, race_condition, data_loss, etc.
- Description
- Why it matters / impact
- Recommendation

Example:

# Finding 1: Incorrect cache key causes stale results: `src/foo.ts:42`

* Severity: High
* Category: bug
* Description: The cache key omits `userId`, so requests from different users can reuse each other's cached data.
* Impact: Users may see incorrect data and, depending on the payload, sensitive information can leak across sessions.
* Recommendation: Include `userId` in the cache key or scope the cache per authenticated session.

SEVERITY GUIDELINES:
- **CRITICAL**: Data loss, remote code execution, auth bypass, or other severe user-impacting failures
- **HIGH**: Serious correctness or security issues with clear failure modes
- **MEDIUM**: Real bugs requiring specific conditions, but with practical impact
- **LOW**: Smaller but concrete issues worth fixing

CONFIDENCE GUIDELINES:
- Only report findings with confidence of 8/10 or higher.
- Prefer fewer, higher-quality findings over broad speculation.
- If a potential issue is too speculative, omit it.

FINAL OUTPUT:
Produce only the markdown report.
`

const bughunter = {
  type: 'prompt',
  name: 'bughunter',
  description:
    'Analyze pending branch changes for bugs, security vulnerabilities, and code quality issues',
  progressMessage: 'hunting bugs in code changes',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(_args, context) {
    const parsed = parseFrontmatter(BUGHUNTER_MARKDOWN)
    const allowedTools = parseSlashCommandToolsFromFrontmatter(
      parsed.frontmatter['allowed-tools'],
    )

    const processedContent = await executeShellCommandsInPrompt(
      parsed.content,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: allowedTools,
              },
            },
          }
        },
      },
      'bughunter',
    )

    return [
      {
        type: 'text',
        text: processedContent,
      },
    ]
  },
} satisfies Command

export default bughunter
