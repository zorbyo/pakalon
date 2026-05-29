import type { AssistantMessage, ToolUseContext } from '@/tools/tool-types.js'
import { applyContextModifiers, getMaxToolUseConcurrency, partitionToolCalls } from './concurrency.js'
import { runToolUse, type ToolUseBlock, type ToolExecutionMessage } from './toolExecution.js'

export type MessageUpdate = {
  message?: ToolExecutionMessage['message']
  newContext: ToolUseContext
}

export type ToolSetLike = Record<string, any> | readonly any[]

async function runConcurrentBatch(
  blocks: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: Parameters<typeof runToolUse>[2],
  toolUseContext: ToolUseContext,
  tools: ToolSetLike,
): Promise<{ updates: MessageUpdate[]; modifiers: Array<(context: ToolUseContext) => ToolUseContext> }> {
  const queue: MessageUpdate[] = []
  const modifiers: Array<(context: ToolUseContext) => ToolUseContext> = []
  const abortController = new AbortController()
  const maxConcurrency = getMaxToolUseConcurrency()

  const active: Promise<void>[] = []

  const assistantFor = (toolUseId: string) =>
    assistantMessages.find(msg =>
      Array.isArray(msg.message.content) && msg.message.content.some(block => (block as any)?.id === toolUseId),
    ) ?? assistantMessages[0]!

  const startTool = async (toolUse: ToolUseBlock): Promise<void> => {
    toolUseContext.setInProgressToolUseIDs(prev => new Set(prev).add(toolUse.id))
    const assistantMessage = assistantFor(toolUse.id)
    for await (const update of runToolUse(toolUse, assistantMessage, canUseTool, toolUseContext, {
      tools,
      signal: abortController.signal,
      onProgress: message => {
        queue.push({ message, newContext: toolUseContext })
      },
    })) {
      if (update.contextModifier) {
        modifiers.push(update.contextModifier)
      }
      queue.push({ message: update.message, newContext: toolUseContext })
    }
    toolUseContext.setInProgressToolUseIDs(prev => {
      const next = new Set(prev)
      next.delete(toolUse.id)
      return next
    })
  }

  for (const block of blocks) {
    const task = startTool(block)
    active.push(task)

    if (active.length >= maxConcurrency) {
      await Promise.race(active).catch(() => undefined)
      while (active.length > 0 && active[0]?.then) {
        const doneIndex = await Promise.race(active.map((promise, index) => promise.then(() => index).catch(() => index)))
        active.splice(doneIndex, 1)
        break
      }
    }
  }

  await Promise.allSettled(active)

  return { updates: queue, modifiers }
}

async function runSerialBatch(
  blocks: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: Parameters<typeof runToolUse>[2],
  toolUseContext: ToolUseContext,
  tools: ToolSetLike,
): Promise<{ updates: MessageUpdate[]; modifiers: Array<(context: ToolUseContext) => ToolUseContext> }> {
  const updates: MessageUpdate[] = []
  const modifiers: Array<(context: ToolUseContext) => ToolUseContext> = []

  const assistantFor = (toolUseId: string) =>
    assistantMessages.find(msg =>
      Array.isArray(msg.message.content) && msg.message.content.some(block => (block as any)?.id === toolUseId),
    ) ?? assistantMessages[0]!

  for (const block of blocks) {
    toolUseContext.setInProgressToolUseIDs(prev => new Set(prev).add(block.id))
    const assistantMessage = assistantFor(block.id)
    for await (const update of runToolUse(block, assistantMessage, canUseTool, toolUseContext, { tools })) {
      if (update.contextModifier) {
        modifiers.push(update.contextModifier)
      }
      updates.push({ message: update.message, newContext: toolUseContext })
    }
    toolUseContext.setInProgressToolUseIDs(prev => {
      const next = new Set(prev)
      next.delete(block.id)
      return next
    })
  }

  return { updates, modifiers }
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: Parameters<typeof runToolUse>[2],
  toolUseContext: ToolUseContext,
  tools: ToolSetLike = toolUseContext.options.tools,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const batch of partitionToolCalls(toolUseMessages, tools)) {
    const runner = batch.isConcurrencySafe
      ? runConcurrentBatch(batch.blocks, assistantMessages, canUseTool, currentContext, tools)
      : runSerialBatch(batch.blocks, assistantMessages, canUseTool, currentContext, tools)

    const { updates, modifiers } = await runner

    for (const update of updates) {
      yield { message: update.message, newContext: currentContext }
    }

    if (!batch.isConcurrencySafe) {
      currentContext = applyContextModifiers(currentContext, modifiers)
      yield { newContext: currentContext }
    }
  }
}
