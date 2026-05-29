/**
 * Debug Tool Call Command Implementation
 * Provides debugging capabilities for tool call execution
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { Message } from '../../types/message.js'

interface ToolCallInfo {
  id: string
  name: string
  input: unknown
  output?: unknown
  duration?: number
  status: 'pending' | 'success' | 'error'
  error?: string
  timestamp: Date
}

/**
 * Extract tool calls from message history
 */
function extractToolCalls(messages: Message[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = []
  
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    
    for (const block of content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as { 
          type: 'tool_use'
          id: string
          name: string
          input: unknown 
        }
        
        toolCalls.push({
          id: toolBlock.id,
          name: toolBlock.name,
          input: toolBlock.input,
          status: 'pending',
          timestamp: new Date(),
        })
      }
    }
  }
  
  // Match tool results to tool calls
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    
    for (const block of content) {
      if (block.type === 'tool_result') {
        const resultBlock = block as {
          type: 'tool_result'
          tool_use_id: string
          content: unknown
          is_error?: boolean
        }
        
        const call = toolCalls.find(tc => tc.id === resultBlock.tool_use_id)
        if (call) {
          call.output = resultBlock.content
          call.status = resultBlock.is_error ? 'error' : 'success'
          if (resultBlock.is_error && typeof resultBlock.content === 'string') {
            call.error = resultBlock.content
          }
        }
      }
    }
  }
  
  return toolCalls
}

/**
 * Format tool input/output for display
 */
function formatValue(value: unknown, maxLength = 500): string {
  if (value === undefined) return '<no value>'
  if (value === null) return 'null'
  
  const str = typeof value === 'string' 
    ? value 
    : JSON.stringify(value, null, 2)
  
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + '...'
  }
  
  return str
}

/**
 * Debug Tool Call Component
 */
function DebugToolCallDisplay({ 
  toolCalls, 
  filterName 
}: { 
  toolCalls: ToolCallInfo[]
  filterName?: string 
}): React.ReactElement {
  const filtered = filterName 
    ? toolCalls.filter(tc => tc.name.toLowerCase().includes(filterName.toLowerCase()))
    : toolCalls
  
  if (filtered.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          No tool calls found{filterName ? ` matching "${filterName}"` : ''}.
        </Text>
      </Box>
    )
  }
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        [Wrench] Tool Call Debug Info ({filtered.length} calls)
      </Text>
      <Box marginTop={1} />
      
      {filtered.map((tc, index) => (
        <Box key={tc.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold>
              {index + 1}. {tc.name}
            </Text>
            <Text> </Text>
            <Text 
              color={
                tc.status === 'success' ? 'green' : 
                tc.status === 'error' ? 'red' : 
                'yellow'
              }
            >
              [{tc.status.toUpperCase()}]
            </Text>
          </Box>
          
          <Box marginLeft={2} flexDirection="column">
            <Text dimColor>ID: {tc.id}</Text>
            
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>Input:</Text>
              <Text>{formatValue(tc.input, 200)}</Text>
            </Box>
            
            {tc.output !== undefined && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold dimColor>Output:</Text>
                <Text>{formatValue(tc.output, 200)}</Text>
              </Box>
            )}
            
            {tc.error && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="red">Error:</Text>
                <Text color="red">{tc.error}</Text>
              </Box>
            )}
            
            {tc.duration && (
              <Text dimColor>Duration: {tc.duration}ms</Text>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Main debug-tool-call command call function
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const filterName = args.trim() || undefined
  const toolCalls = extractToolCalls(context.messages)
  
  // Generate summary
  const total = toolCalls.length
  const success = toolCalls.filter(tc => tc.status === 'success').length
  const errors = toolCalls.filter(tc => tc.status === 'error').length
  const pending = toolCalls.filter(tc => tc.status === 'pending').length
  
  const summary = [
    `Tool calls: ${total} total`,
    `Success: ${success}`,
    `Errors: ${errors}`,
    `Pending: ${pending}`,
  ].join(' | ')
  
  // If no tool calls, just show message
  if (toolCalls.length === 0) {
    onDone('No tool calls in current conversation.', { display: 'system' })
    return null
  }
  
  // Show the debug display
  onDone(summary, { display: 'system' })
  return <DebugToolCallDisplay toolCalls={toolCalls} filterName={filterName} />
}

export { extractToolCalls, formatValue }
