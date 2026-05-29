import type { AssistantMessage, ToolUseContext } from '@/tools/tool-types.js'
import { createUserMessage, withMemoryCorrectionHint } from '@/utils/messages.js'
import { createChildAbortController } from '@/utils/abortController.js'
import { getToolInterruptBehavior, partitionToolCalls, shouldCancelSiblingsOnError } from './concurrency.js'
import { runToolUse, type ToolUseBlock, type ToolExecutionMessage } from './toolExecution.js'

type ToolSetLike = Record<string, any> | readonly any[]

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: 'queued' | 'executing' | 'completed' | 'yielded'
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: ToolExecutionMessage['message'][]
  pendingProgress: ToolExecutionMessage['message'][]
  contextModifiers: Array<(context: ToolUseContext) => ToolUseContext>
}

export type MessageUpdate = {
  message?: ToolExecutionMessage['message']
  newContext?: ToolUseContext
}

export class StreamingToolExecutor {
  private readonly tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private discarded = false
  private siblingAbortController: AbortController
  private hasErrored = false
  private erroredToolDescription = ''
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: ToolSetLike,
    private readonly canUseTool: Parameters<typeof runToolUse>[2],
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(toolUseContext.abortController)
  }

  discard(): void {
    this.discarded = true
  }

  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const isConcurrencySafe = partitionToolCalls([block], this.toolDefinitions)[0]?.isConcurrencySafe ?? false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
      contextModifiers: [],
    })
    void this.processQueue()
  }

  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(tool => tool.status === 'executing')
    return executingTools.length === 0 || (isConcurrencySafe && executingTools.every(tool => tool.isConcurrencySafe))
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): ToolExecutionMessage['message'] {
    const content =
      reason === 'streaming_fallback'
        ? '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>'
        : reason === 'user_interrupted'
          ? withMemoryCorrectionHint('User rejected tool use')
          : '<tool_use_error>Cancelled: parallel tool call errored</tool_use_error>'

    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: String(content),
      sourceToolAssistantUUID: assistantMessage.uuid,
    }) as ToolExecutionMessage['message']
  }

  private getAbortReason(tool: TrackedTool): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | null {
    if (this.discarded) return 'streaming_fallback'
    if (this.hasErrored) return 'sibling_error'
    if (this.toolUseContext.abortController.signal.aborted) {
      return this.getToolInterruptBehavior(tool) === 'cancel' ? 'user_interrupted' : null
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    return getToolInterruptBehavior(this.toolDefinitions, tool.block)
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown>
    const summary = input.command ?? input.file_path ?? input.pattern ?? ''
    return typeof summary === 'string' && summary.length > 0 ? `${tool.block.name}(${summary.slice(0, 40)})` : tool.block.name
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(tool => tool.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 && executing.every(tool => this.getToolInterruptBehavior(tool) === 'cancel'),
    )
  }

  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev => new Set(prev).add(tool.id))
    this.updateInterruptibleState()

    const messages: ToolExecutionMessage['message'][] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> = []

    const collectResults = async (): Promise<void> => {
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(this.createSyntheticErrorMessage(tool.id, initialAbortReason, tool.assistantMessage))
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      const toolAbortController = createChildAbortController(this.siblingAbortController)
      toolAbortController.signal.addEventListener('abort', () => {
        if (
          toolAbortController.signal.reason !== 'sibling_error' &&
          !this.toolUseContext.abortController.signal.aborted &&
          !this.discarded
        ) {
          this.toolUseContext.abortController.abort(toolAbortController.signal.reason)
        }
      }, { once: true })

      let thisToolErrored = false
      const generator = runToolUse(tool.block, tool.assistantMessage, this.canUseTool, {
        ...this.toolUseContext,
        abortController: toolAbortController,
      }, {
        tools: this.toolDefinitions,
        signal: toolAbortController.signal,
        onProgress: message => {
          tool.pendingProgress.push(message)
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        },
      })

      for await (const update of generator) {
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(this.createSyntheticErrorMessage(tool.id, abortReason, tool.assistantMessage))
          break
        }

        const isErrorResult = update.message.type === 'user' && Boolean(update.message.isError)
        if (isErrorResult) {
          thisToolErrored = true
          if (shouldCancelSiblingsOnError(tool.block.name)) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message.type === 'progress') {
          tool.pendingProgress.push(update.message)
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        } else {
          messages.push(update.message)
        }

        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier)
        }
      }

      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue
      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else if (!tool.isConcurrencySafe) {
        break
      }
    }
  }

  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) return

    for (const tool of this.tools) {
      while (tool.pendingProgress.length > 0) {
        yield { message: tool.pendingProgress.shift(), newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') continue

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'
        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }
        this.toolUseContext.setInProgressToolUseIDs(prev => {
          const next = new Set(prev)
          next.delete(tool.id)
          return next
        })
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  private hasPendingProgress(): boolean {
    return this.tools.some(tool => tool.pendingProgress.length > 0)
  }

  private hasExecutingTools(): boolean {
    return this.tools.some(tool => tool.status === 'executing')
  }

  private hasCompletedResults(): boolean {
    return this.tools.some(tool => tool.status === 'completed')
  }

  private hasUnfinishedTools(): boolean {
    return this.tools.some(tool => tool.status !== 'yielded')
  }

  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) return

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      if (this.hasExecutingTools() && !this.hasCompletedResults() && !this.hasPendingProgress()) {
        const executingPromises = this.tools.filter(tool => tool.status === 'executing' && tool.promise).map(tool => tool.promise!)
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })
        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}
