import type { ToolUseContext } from '@/tools/tool-types.js'

export type InterruptBehavior = 'cancel' | 'block'

export type ToolLike = {
  name?: string
  definition?: { description?: string }
  inputSchema?: { safeParse?: (input: unknown) => { success: boolean; data?: unknown } }
  isConcurrencySafe?: (input: any) => boolean
  interruptBehavior?: () => InterruptBehavior
}

export type ToolUseBlockLike = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolBatch = {
  isConcurrencySafe: boolean
  blocks: ToolUseBlockLike[]
}

const MAX_CONCURRENCY_DEFAULT = 10

const SAFE_TOOL_NAMES = new Set([
  'readFile',
  'listDir',
  'globFind',
  'grepSearch',
  'rg',
  'view',
  'webFetch',
  'webSearch',
  'lspDefinition',
  'lspReferences',
  'lspHover',
  'lspCompletion',
  'lspDiagnostics',
  'lspSymbols',
  'memorySearch',
  'browserSnapshot',
  'browserWait',
])

const EXCLUSIVE_TOOL_NAMES = new Set([
  'bash',
  'justbash',
  'just-bash',
  'secureExec',
  'secure-exec',
  'secure_exec',
  'powershell',
  'writeFile',
  'editFile',
  'multiEditFiles',
  'deleteFile',
  'uploadFile',
  'downloadFile',
  'listFiles',
  'askUser',
  'repl',
  'orchestrate',
  'codeExecution',
  'teamCreate',
  'teamDelete',
  'sendMessage',
  'mcpAuth',
  'directoryTrust',
  'browserNavigate',
  'browserClick',
  'browserFillForm',
  'browserScreenshot',
  'browserSelectOption',
  'browserClose',
  'lspRename',
  'todoWrite',
  'generateImage',
  'generateVideo',
])

export function getMaxToolUseConcurrency(): number {
  const raw = process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_CONCURRENCY_DEFAULT)
    : MAX_CONCURRENCY_DEFAULT
}

function resolveTool(toolSet: unknown, toolName: string): ToolLike | undefined {
  if (!toolSet) return undefined

  if (Array.isArray(toolSet)) {
    return toolSet.find((tool: any) => tool?.name === toolName) as ToolLike | undefined
  }

  if (typeof toolSet === 'object') {
    const byName = (toolSet as Record<string, unknown>)[toolName]
    if (byName && typeof byName === 'object') {
      return byName as ToolLike
    }
  }

  return undefined
}

export function isToolConcurrencySafe(
  toolSet: unknown,
  toolUse: ToolUseBlockLike,
): boolean {
  const tool = resolveTool(toolSet, toolUse.name)
  const parsed = tool?.inputSchema?.safeParse?.(toolUse.input)

  if (parsed?.success) {
    try {
      if (tool?.isConcurrencySafe) {
        return Boolean(tool.isConcurrencySafe(parsed.data))
      }
    } catch {
      return false
    }
  }

  if (SAFE_TOOL_NAMES.has(toolUse.name)) {
    return true
  }

  if (EXCLUSIVE_TOOL_NAMES.has(toolUse.name)) {
    return false
  }

  if (/read|search|fetch|diag|symbol|hover|completion/i.test(toolUse.name)) {
    return true
  }

  if (/write|edit|delete|patch|bash|shell|exec|run|create|close|click|fill|select|screenshot/i.test(toolUse.name)) {
    return false
  }

  return false
}

export function getToolInterruptBehavior(
  toolSet: unknown,
  toolUse: ToolUseBlockLike,
): InterruptBehavior {
  const tool = resolveTool(toolSet, toolUse.name)
  try {
    const custom = tool?.interruptBehavior?.()
    if (custom === 'cancel' || custom === 'block') {
      return custom
    }
  } catch {
    // fall back to heuristic below
  }

  return isToolConcurrencySafe(toolSet, toolUse) ? 'cancel' : 'block'
}

export function shouldCancelSiblingsOnError(toolName: string): boolean {
  return /bash|justbash|just-bash|secureExec|secure-exec|secure_exec|powershell/i.test(toolName)
}

export function partitionToolCalls(
  toolUses: ToolUseBlockLike[],
  toolSet: unknown,
): ToolBatch[] {
  const batches: ToolBatch[] = []

  for (const toolUse of toolUses) {
    const safe = isToolConcurrencySafe(toolSet, toolUse)
    const last = batches[batches.length - 1]

    if (safe && last?.isConcurrencySafe) {
      last.blocks.push(toolUse)
      continue
    }

    batches.push({ isConcurrencySafe: safe, blocks: [toolUse] })
  }

  return batches
}

export function applyContextModifiers<T extends ToolUseContext>(
  context: T,
  modifiers: Array<(context: T) => T>,
): T {
  let next = context
  for (const modifier of modifiers) {
    next = modifier(next)
  }
  return next
}
