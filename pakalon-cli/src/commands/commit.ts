import type { Command } from '../commands.js'
import { getAttributionTexts } from '../utils/attribution.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'
import { execSync } from 'child_process'

const ALLOWED_TOOLS = [
  'Bash(git add:*)',
  'Bash(git status:*)',
  'Bash(git commit:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
]

// ---------------------------------------------------------------------------
// Conventional Commit Types (12 standard types)
// ---------------------------------------------------------------------------

export type ConventionalCommitType = 
  | 'feat'     // New feature
  | 'fix'      // Bug fix
  | 'docs'     // Documentation only
  | 'style'    // Formatting, missing semi colons, etc (no code change)
  | 'refactor' // Refactoring production code
  | 'perf'     // Performance improvements
  | 'test'     // Adding or correcting tests
  | 'build'    // Build system or external dependencies
  | 'ci'       // CI configuration files and scripts
  | 'chore'    // Other changes that don't modify src or test files
  | 'revert'   // Reverts a previous commit
  | 'init'     // Initial commit / project initialization

export const CONVENTIONAL_COMMIT_TYPES: Record<ConventionalCommitType, string> = {
  feat: 'New feature',
  fix: 'Bug fix',
  docs: 'Documentation only changes',
  style: 'Code style changes (formatting, semicolons, etc)',
  refactor: 'Code change that neither fixes a bug nor adds a feature',
  perf: 'Performance improvement',
  test: 'Adding or correcting tests',
  build: 'Changes to build system or dependencies',
  ci: 'Changes to CI configuration',
  chore: 'Other changes that modify src or test files',
  revert: 'Reverts a previous commit',
  init: 'Initial commit or project initialization',
}

// Filler/meta words that should not be used in commit messages
export const FILLER_WORDS = [
  'minor', 'trivial', 'small', 'little', 'quick', 'simple',
  'stuff', 'things', 'update', 'fix', 'change', 'adjust',
]

// ---------------------------------------------------------------------------
// Commit Validation
// ---------------------------------------------------------------------------

export interface CommitValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestedType?: ConventionalCommitType;
}

export function validateCommitMessage(message: string): CommitValidation {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Check conventional commit format: type(scope): description
  const conventionalMatch = message.match(/^(\w+)(?:\(([^)]+)\))?!?:\s+(.+)/)
  
  if (!conventionalMatch) {
    errors.push('Commit message does not follow conventional commit format: type(scope): description')
    
    // Try to suggest a type based on the message
    const lowerMsg = message.toLowerCase()
    if (lowerMsg.startsWith('add') || lowerMsg.startsWith('new') || lowerMsg.startsWith('implement')) {
      warnings.push('Suggested type: feat')
    } else if (lowerMsg.startsWith('fix') || lowerMsg.startsWith('bug') || lowerMsg.startsWith('patch')) {
      warnings.push('Suggested type: fix')
    } else if (lowerMsg.startsWith('update') || lowerMsg.startsWith('improve') || lowerMsg.startsWith('enhance')) {
      warnings.push('Suggested type: refactor or feat')
    } else if (lowerMsg.startsWith('doc') || lowerMsg.startsWith('readme')) {
      warnings.push('Suggested type: docs')
    } else if (lowerMsg.startsWith('test') || lowerMsg.startsWith('spec')) {
      warnings.push('Suggested type: test')
    }
  } else {
    const type = typeMatch[1] as ConventionalCommitType
    const description = typeMatch[2]
    
    // Validate type
    if (!CONVENTIONAL_COMMIT_TYPES[type]) {
      errors.push(`Invalid commit type: ${type}. Valid types: ${Object.keys(CONVENTIONAL_COMMIT_TYPES).join(', ')}`)
    }
    
    // Validate description
    if (!description || description.trim().length === 0) {
      errors.push('Commit description cannot be empty')
    } else {
      // Check description starts with lowercase
      if (description[0] !== description[0].toLowerCase()) {
        warnings.push('Commit description should start with lowercase')
      }
      
      // Check for filler words
      const words = description.toLowerCase().split(/\s+/)
      for (const word of words) {
        if (FILLER_WORDS.includes(word)) {
          warnings.push(`Avoid filler word "${word}" in commit description`)
        }
      }
      
      // Check description length
      if (description.length > 72) {
        warnings.push('Commit description should be 72 characters or less')
      }
    }
  }
  
  // Check overall message length
  if (message.length > 200) {
    warnings.push('Commit message is very long. Consider keeping it under 200 characters')
  }
  
  // Check for trailing period
  if (message.endsWith('.')) {
    warnings.push('Commit messages typically do not end with a period')
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Atomic Commit Splits
// ---------------------------------------------------------------------------

export interface FileChange {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface CommitGroup {
  files: FileChange[];
  type: ConventionalCommitType;
  scope?: string;
  description: string;
  priority: number; // Lower = higher priority (source > test > docs > config)
}

export function categorizeFiles(files: FileChange[]): CommitGroup[] {
  const groups: Map<string, FileChange[]> = new Map()
  
  for (const file of files) {
    let category: string
    
    // Categorize based on file path
    if (file.file.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/)) {
      category = 'test'
    } else if (file.file.match(/\.(md|mdx|txt)$/)) {
      category = 'docs'
    } else if (file.file.match(/(package\.json|tsconfig|\.eslintrc|\.prettierrc|jest\.config)/)) {
      category = 'config'
    } else if (file.file.match(/\.(ts|tsx|js|jsx|py|go|rs)$/)) {
      category = 'source'
    } else {
      category = 'other'
    }
    
    if (!groups.has(category)) {
      groups.set(category, [])
    }
    groups.get(category)!.push(file)
  }
  
  // Create commit groups with priority ordering
  const commitGroups: CommitGroup[] = []
  
  // Priority: source > test > config > docs > other
  const priorityMap: Record<string, number> = {
    source: 1,
    test: 2,
    config: 3,
    docs: 4,
    other: 5,
  }
  
  for (const [category, categoryFiles] of groups) {
    const type = category === 'test' ? 'test' : 
                 category === 'docs' ? 'docs' : 
                 category === 'config' ? 'build' : 'feat'
    
    commitGroups.push({
      files: categoryFiles,
      type: type as ConventionalCommitType,
      description: `${category} changes`,
      priority: priorityMap[category] || 5,
    })
  }
  
  // Sort by priority
  commitGroups.sort((a, b) => a.priority - b.priority)
  
  return commitGroups
}

export function generateAtomicCommits(groups: CommitGroup[]): string[] {
  const commits: string[] = []
  
  for (const group of groups) {
    // Generate commit message
    const files = group.files.map(f => f.file).join(', ')
    const commitMsg = `${group.type}: ${group.description} (${files})`
    commits.push(commitMsg)
  }
  
  return commits
}

// ---------------------------------------------------------------------------
// Topological Ordering
// ---------------------------------------------------------------------------

export function topologicalSort(groups: CommitGroup[]): CommitGroup[] {
  // Create dependency graph
  const dependencies: Map<number, number[]> = new Map()
  
  for (let i = 0; i < groups.length; i++) {
    const deps: number[] = []
    
    // Check if this group depends on any other group
    for (let j = 0; j < groups.length; j++) {
      if (i === j) continue
      
      // Check for file conflicts or dependencies
      const group1Files = new Set(groups[i]!.files.map(f => f.file))
      const group2Files = new Set(groups[j]!.files.map(f => f.file))
      
      // If groups share files, there's a dependency
      for (const file of group1Files) {
        if (group2Files.has(file)) {
          deps.push(j)
          break
        }
      }
    }
    
    dependencies.set(i, deps)
  }
  
  // Perform topological sort using Kahn's algorithm
  const inDegree: number[] = new Array(groups.length).fill(0)
  const adjacency: number[][] = new Array(groups.length).fill([])
  
  for (const [node, deps] of dependencies) {
    for (const dep of deps) {
      adjacency[dep]!.push(node)
      inDegree[node]!++
    }
  }
  
  const queue: number[] = []
  for (let i = 0; i < groups.length; i++) {
    if (inDegree[i] === 0) {
      queue.push(i)
    }
  }
  
  const sorted: CommitGroup[] = []
  
  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(groups[node]!)
    
    for (const neighbor of adjacency[node]!) {
      inDegree[neighbor]!--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    }
  }
  
  // If sorted doesn't contain all groups, there's a cycle
  if (sorted.length !== groups.length) {
    // Fallback to priority-based sorting
    return [...groups].sort((a, b) => a.priority - b.priority)
  }
  
  return sorted
}

// ---------------------------------------------------------------------------
// Prompt Generation
// ---------------------------------------------------------------------------

function getPromptContent(): string {
  const { commit: commitAttribution } = getAttributionTexts()

  let prefix = ''
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
  }

  return `${prefix}## Context

- Current git status: !\`git status\`
- Current git diff (staged and unstaged changes): !\`git diff HEAD\`
- Current branch: !\`git branch --show-current\`
- Recent commits: !\`git log --oneline -10\`

## Git Safety Protocol

- NEVER update the git config
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- CRITICAL: ALWAYS create NEW commits. NEVER use git commit --amend, unless the user explicitly requests it
- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Conventional Commits

Follow the Conventional Commits specification:
\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Allowed Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation only changes
- style: Code style changes (formatting, semicolons, etc)
- refactor: Code change that neither fixes a bug nor adds a feature
- perf: Performance improvement
- test: Adding or correcting tests
- build: Changes to build system or dependencies
- ci: Changes to CI configuration
- chore: Other changes that modify src or test files
- revert: Reverts a previous commit
- init: Initial commit or project initialization

### Examples:
- feat(auth): add JWT token refresh mechanism
- fix(parser): handle empty input gracefully
- docs: update API documentation
- style: format code with prettier
- refactor: extract auth logic into separate module
- perf: optimize database queries
- test: add unit tests for user service
- build: update webpack to v5
- ci: add GitHub Actions workflow
- chore: update dependencies
- revert: revert "feat(auth): add JWT token refresh"

## Your task

Based on the above changes, create a single git commit following conventional commits format:

1. Analyze all staged changes and draft a commit message:
   - Choose the appropriate type (feat, fix, docs, etc.)
   - Add a scope if the change is localized to a specific module
   - Write a concise description that:
     * Starts with lowercase
     * Uses imperative mood ("add" not "added")
     * Does NOT end with a period
     * Is 72 characters or less

2. Stage relevant files and create the commit using HEREDOC syntax:
\`\`\`
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>${commitAttribution ? `\n\n${commitAttribution}` : ''}
EOF
)"
\`\`\`

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.`
}

const command = {
  type: 'prompt',
  name: 'commit',
  description: 'Create a git commit (with conventional commits validation)',
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0, // Dynamic content
  progressMessage: 'creating commit',
  source: 'builtin',
  async getPromptForCommand(_args, context) {
    const promptContent = getPromptContent()
    const finalContent = await executeShellCommandsInPrompt(
      promptContent,
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
                command: ALLOWED_TOOLS,
              },
            },
          }
        },
      },
      '/commit',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
