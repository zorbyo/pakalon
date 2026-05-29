/**
 * Share Dialog Component
 * Interactive UI for sharing conversations
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import type { Message } from '../../types/message.js'
import type { ShareOptions, ShareFormat } from './share.js'

interface ShareDialogProps {
  messages: Message[]
  onShare: (options: ShareOptions) => void
  onCancel: () => void
}

interface FormatItem {
  label: string
  value: ShareFormat
}

interface ExpiryItem {
  label: string
  value: ShareOptions['expiresIn']
}

export function ShareDialog({ messages, onShare, onCancel }: ShareDialogProps): React.ReactElement {
  const [step, setStep] = useState<'format' | 'expiry' | 'options'>('format')
  const [selectedFormat, setSelectedFormat] = useState<ShareFormat | null>(null)
  const [includeTools, setIncludeTools] = useState(false)
  const [includeSystem, setIncludeSystem] = useState(false)
  const [expiresIn, setExpiresIn] = useState<ShareOptions['expiresIn']>('7d')
  
  const formatOptions: FormatItem[] = [
    { label: '[Link] Shareable Link', value: 'link' },
    { label: '[Memo] Markdown', value: 'markdown' },
    { label: '[Clipboard] JSON', value: 'json' },
    { label: '[Globe] HTML', value: 'html' },
    { label: '[Paperclip] Copy to Clipboard', value: 'clipboard' },
  ]
  
  const expiryOptions: ExpiryItem[] = [
    { label: '1 hour', value: '1h' },
    { label: '24 hours', value: '24h' },
    { label: '7 days (default)', value: '7d' },
    { label: '30 days', value: '30d' },
    { label: 'Never expires', value: 'never' },
  ]
  
  useInput((input, key) => {
    if (key.escape) {
      onCancel()
    }
    
    if (step === 'options') {
      if (input === 't') {
        setIncludeTools(!includeTools)
      } else if (input === 's') {
        setIncludeSystem(!includeSystem)
      } else if (key.return) {
        onShare({
          format: selectedFormat!,
          expiresIn,
          includeToolResults: includeTools,
          includeSystemMessages: includeSystem,
        })
      }
    }
  })
  
  const handleFormatSelect = (item: FormatItem) => {
    setSelectedFormat(item.value)
    if (item.value === 'link') {
      setStep('expiry')
    } else {
      setStep('options')
    }
  }
  
  const handleExpirySelect = (item: ExpiryItem) => {
    setExpiresIn(item.value)
    setStep('options')
  }
  
  const messageCount = messages.length
  const userMessages = messages.filter(m => m.type === 'user').length
  const assistantMessages = messages.filter(m => m.type === 'assistant').length
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        [Outbox] Share Conversation
      </Text>
      <Text dimColor>
        {messageCount} messages ({userMessages} user, {assistantMessages} assistant)
      </Text>
      <Box marginTop={1} />
      
      {step === 'format' && (
        <Box flexDirection="column">
          <Text>Select share format:</Text>
          <Box marginTop={1}>
            <SelectInput items={formatOptions} onSelect={handleFormatSelect} />
          </Box>
        </Box>
      )}
      
      {step === 'expiry' && (
        <Box flexDirection="column">
          <Text>Link expiration:</Text>
          <Box marginTop={1}>
            <SelectInput items={expiryOptions} onSelect={handleExpirySelect} />
          </Box>
        </Box>
      )}
      
      {step === 'options' && (
        <Box flexDirection="column">
          <Text>Additional options:</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color={includeTools ? 'green' : 'gray'}>
                [{includeTools ? '[OK]' : ' '}]
              </Text>
              {' '}Include tool results <Text dimColor>(press 't')</Text>
            </Text>
            <Text>
              <Text color={includeSystem ? 'green' : 'gray'}>
                [{includeSystem ? '[OK]' : ' '}]
              </Text>
              {' '}Include system messages <Text dimColor>(press 's')</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to share, Escape to cancel</Text>
          </Box>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    </Box>
  )
}
