import type { ToolUseContext, CanUseToolFn, AssistantMessage } from '@/tools/tool-types.js'
import { runPostToolUseHook, runPreToolUseHook } from './hooks.js'
import { getToolInterruptBehavior, shouldCancelSiblingsOnError } from './concurrency.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ToolUseBlock = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolExecutionMessage = {
  type: 'progress' | 'message'
  message: {
    type: 'progress' | 'user'
    toolUseId?: string
    toolName?: string
    content?: unknown
    isError?: boolean
    assistantUUID?: string
  }
  contextModifier?: (context: ToolUseContext) => ToolUseContext
}

type ToolSetLike = Record<string, any> | readonly any[]
const DEFAULT_MAX_RESULT_SIZE_CHARS = 100_000
const RESULT_PREVIEW_CHARS = 4_000

function resolveTool(toolSet: ToolSetLike | undefined, toolName: string): any | undefined {
  if (!toolSet) return undefined
  if (Array.isArray(toolSet)) {
    return toolSet.find(tool => tool?.name === toolName)
  }
  return toolSet[toolName]
}

function createResultMessage(
  toolUseId: string,
  toolName: string,
  assistantMessage: AssistantMessage,
  content: unknown,
  isError = false,
): ToolExecutionMessage {
  return {
    type: 'message',
    message: {
      type: 'user',
      toolUseId,
      toolName,
      content,
      isError,
      assistantUUID: assistantMessage.uuid,
    },
  }
}

function serializeResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function getMaxResultSizeChars(tool: any): number {
  const value = tool?.maxResultSizeChars
  return typeof value === 'number' ? value : DEFAULT_MAX_RESULT_SIZE_CHARS
}

function persistLargeToolResult(toolUseId: string, toolName: string, serialized: string): string {
  const dir = path.join(os.tmpdir(), 'pakalon-tool-results')
  fs.mkdirSync(dir, { recursive: true })
  const safeToolName = toolName.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60)
  const filePath = path.join(dir, `${Date.now()}-${safeToolName}-${toolUseId}.txt`)
  fs.writeFileSync(filePath, serialized, 'utf8')
  return filePath
}

function applyResultBudget(result: unknown, toolUseId: string, toolName: string, tool: any): unknown {
  const maxChars = getMaxResultSizeChars(tool)
  if (!Number.isFinite(maxChars) || maxChars <= 0) return result

  const serialized = serializeResult(result)
  if (serialized.length <= maxChars) return result

  const filePath = persistLargeToolResult(toolUseId, toolName, serialized)
  const preview = serialized.slice(0, Math.min(RESULT_PREVIEW_CHARS, maxChars))
  return {
    truncated: true,
    toolName,
    originalChars: serialized.length,
    preview,
    fullResultPath: filePath,
    message: `Tool result exceeded ${maxChars} characters. Full output was written to ${filePath}.`,
  }
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  options?: {
    tools?: ToolSetLike
    signal?: AbortSignal
    onProgress?: (message: ToolExecutionMessage['message']) => void
  },
): AsyncGenerator<ToolExecutionMessage, void> {
  const tool = resolveTool(options?.tools ?? toolUseContext.options?.tools, toolUse.name)
  const toolInterruptBehavior = getToolInterruptBehavior(options?.tools ?? toolUseContext.options?.tools, toolUse)

  yield {
    type: 'progress',
    message: {
      type: 'progress',
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      content: `Starting ${toolUse.name}`,
    },
  }

  if (!tool) {
    yield createResultMessage(
      toolUse.id,
      toolUse.name,
      assistantMessage,
      `Error: No such tool available: ${toolUse.name}`,
      true,
    )
    return
  }

  const permission = await canUseTool(toolUse.name, toolUse.input, toolUseContext)
  if (permission.behavior !== 'allow') {
    yield createResultMessage(
      toolUse.id,
      toolUse.name,
      assistantMessage,
      permission.reason ?? 'Tool use denied',
      true,
    )
    return
  }

  const hookResult = await runPreToolUseHook(toolUse.name, toolUse.input, undefined, undefined)
  if (hookResult.blocked) {
    yield createResultMessage(
      toolUse.id,
      toolUse.name,
      assistantMessage,
      hookResult.reason ?? 'Tool use blocked by hook',
      true,
    )
    return
  }

  const effectiveInput = hookResult.decision?.updatedInput
    ? { ...toolUse.input, ...hookResult.decision.updatedInput }
    : toolUse.input

  const signal = options?.signal
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error(String(signal.reason ?? 'aborted')))
          return
        }
        signal.addEventListener('abort', () => reject(new Error(String(signal.reason ?? 'aborted'))), { once: true })
      })
    : null

  const onProgress = (content: unknown) => {
    const message = {
      type: 'progress' as const,
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      content,
    }
    options?.onProgress?.(message)
  }

  let result: unknown
  try {
    const runner = Promise.resolve(tool.execute?.(effectiveInput, { signal, toolUseContext, onProgress }))
    result = abortPromise ? await Promise.race([runner, abortPromise]) : await runner
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    yield createResultMessage(toolUse.id, toolUse.name, assistantMessage, message, true)
    await runPostToolUseHook(toolUse.name, effectiveInput, undefined, undefined)
    return
  }

  if (signal?.aborted) {
    yield createResultMessage(toolUse.id, toolUse.name, assistantMessage, String(signal.reason ?? 'aborted'), true)
    return
  }

  if (result && typeof result === 'object') {
    const typed = result as Record<string, unknown>

    if (Array.isArray(typed.progressMessages)) {
      for (const progress of typed.progressMessages) {
        onProgress(progress)
      }
    }

    if (typeof typed.contextModifier === 'function') {
      yield {
        type: 'message',
        message: {
          type: 'user',
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          content: typed,
          assistantUUID: assistantMessage.uuid,
        },
        contextModifier: typed.contextModifier as (context: ToolUseContext) => ToolUseContext,
      }
      await runPostToolUseHook(toolUse.name, effectiveInput, undefined, undefined)
      return
    }
  }

  const budgetedResult = applyResultBudget(result, toolUse.id, toolUse.name, tool)
  yield createResultMessage(toolUse.id, toolUse.name, assistantMessage, budgetedResult, false)
  await runPostToolUseHook(toolUse.name, effectiveInput, undefined, undefined)

  if (shouldCancelSiblingsOnError(toolUse.name) && budgetedResult && typeof budgetedResult === 'object' && (budgetedResult as Record<string, unknown>).error) {
    return
  }

  void toolInterruptBehavior
}
