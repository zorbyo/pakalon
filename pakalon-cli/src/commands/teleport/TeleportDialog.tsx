/**
 * Teleport Dialog Component
 * Interactive UI for selecting teleport targets
 */

import React, { useState } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import SelectInput from 'ink-select-input'
import TextInput from 'ink-text-input'
import type { TeleportTarget } from './teleport.js'

interface TeleportDialogProps {
  onSelect: (target: TeleportTarget) => void
  onCancel: () => void
}

type TeleportType = TeleportTarget['type']

interface SelectItem {
  label: string
  value: TeleportType
}

export function TeleportDialog({ onSelect, onCancel }: TeleportDialogProps): React.ReactElement {
  const { exit } = useApp()
  const [step, setStep] = useState<'type' | 'details'>('type')
  const [selectedType, setSelectedType] = useState<TeleportType | null>(null)
  const [inputValue, setInputValue] = useState('')
  
  const typeOptions: SelectItem[] = [
    { label: '[LockKey] SSH (user@host)', value: 'ssh' },
    { label: '[SPOUTINGWHALE] Docker Container', value: 'docker' },
    { label: '[Wheel]  Kubernetes Pod', value: 'kubernetes' },
    { label: '[Globe] Remote Server', value: 'remote-server' },
  ]
  
  useInput((input, key) => {
    if (key.escape) {
      onCancel()
    }
  })
  
  const handleTypeSelect = (item: SelectItem) => {
    setSelectedType(item.value)
    setStep('details')
  }
  
  const handleSubmit = () => {
    if (!selectedType || !inputValue.trim()) {
      return
    }
    
    let target: TeleportTarget
    
    switch (selectedType) {
      case 'ssh': {
        const match = inputValue.match(/^(?:(\w+)@)?([a-zA-Z0-9.-]+)(?::(\d+))?$/)
        if (match) {
          target = {
            type: 'ssh',
            user: match[1] || undefined,
            host: match[2],
            port: match[3] ? parseInt(match[3], 10) : 22,
          }
        } else {
          target = { type: 'ssh', host: inputValue }
        }
        break
      }
      
      case 'docker':
        target = { type: 'docker', container: inputValue }
        break
        
      case 'kubernetes': {
        const match = inputValue.match(/^(?:([^/]+)\/)?(.+)$/)
        if (match && match[1]) {
          target = { type: 'kubernetes', namespace: match[1], pod: match[2] }
        } else {
          target = { type: 'kubernetes', namespace: 'default', pod: inputValue }
        }
        break
      }
      
      case 'remote-server':
        target = { type: 'remote-server', host: inputValue }
        break
        
      default:
        return
    }
    
    onSelect(target)
  }
  
  const getPlaceholder = (): string => {
    switch (selectedType) {
      case 'ssh':
        return 'user@hostname:port (e.g., root@myserver.com:22)'
      case 'docker':
        return 'container name or ID'
      case 'kubernetes':
        return 'namespace/pod-name or pod-name'
      case 'remote-server':
        return 'hostname or IP address'
      default:
        return ''
    }
  }
  
  const getTypeLabel = (): string => {
    switch (selectedType) {
      case 'ssh':
        return 'SSH Target'
      case 'docker':
        return 'Docker Container'
      case 'kubernetes':
        return 'Kubernetes Pod'
      case 'remote-server':
        return 'Remote Server'
      default:
        return ''
    }
  }
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        [Rocket] Teleport to Remote Environment
      </Text>
      <Text dimColor>
        Select a target type and enter connection details
      </Text>
      <Box marginTop={1} />
      
      {step === 'type' ? (
        <Box flexDirection="column">
          <Text>Select teleport target type:</Text>
          <Box marginTop={1}>
            <SelectInput items={typeOptions} onSelect={handleTypeSelect} />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>Enter {getTypeLabel()} details:</Text>
          <Box marginTop={1}>
            <Text dimColor>{getPlaceholder()}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green">{'>'} </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder={getPlaceholder()}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to connect, Escape to cancel</Text>
          </Box>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    </Box>
  )
}
