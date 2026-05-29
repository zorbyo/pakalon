/**
 * Issue Command Implementation
 * Create and manage GitHub issues from the CLI
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import SelectInput from 'ink-select-input'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { logEvent } from '../../services/analytics/index.js'
import { getCwd } from '../../utils/cwd.js'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export type IssueAction = 'create' | 'list' | 'view' | 'close'

export interface IssueData {
  title: string
  body?: string
  labels?: string[]
  assignees?: string[]
  milestone?: string
}

interface IssueDialogProps {
  action: IssueAction
  onSubmit: (data: IssueData) => void
  onCancel: () => void
}

/**
 * Check if gh CLI is available
 */
async function isGhCliAvailable(): Promise<boolean> {
  try {
    await execAsync('gh --version')
    return true
  } catch {
    return false
  }
}

/**
 * Check if current directory is a git repository
 */
async function isGitRepo(): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: getCwd() })
    return true
  } catch {
    return false
  }
}

/**
 * Create a new GitHub issue
 */
async function createIssue(data: IssueData): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const args: string[] = ['gh', 'issue', 'create']
    
    args.push('--title', `"${data.title.replace(/"/g, '\\"')}"`)
    
    if (data.body) {
      args.push('--body', `"${data.body.replace(/"/g, '\\"')}"`)
    }
    
    if (data.labels && data.labels.length > 0) {
      args.push('--label', data.labels.join(','))
    }
    
    if (data.assignees && data.assignees.length > 0) {
      args.push('--assignee', data.assignees.join(','))
    }
    
    const { stdout } = await execAsync(args.join(' '), { cwd: getCwd() })
    const url = stdout.trim()
    
    logEvent('tengu_issue_created', {
      has_body: !!data.body,
      label_count: data.labels?.length || 0,
    })
    
    return { success: true, url }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * List GitHub issues
 */
async function listIssues(limit = 10): Promise<{ success: boolean; issues?: string; error?: string }> {
  try {
    const { stdout } = await execAsync(`gh issue list --limit ${limit}`, { cwd: getCwd() })
    return { success: true, issues: stdout }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Issue Creation Dialog Component
 */
function IssueDialog({ action, onSubmit, onCancel }: IssueDialogProps): React.ReactElement {
  const [step, setStep] = useState<'title' | 'body' | 'labels' | 'confirm'>('title')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labels, setLabels] = useState('')
  
  useInput((input, key) => {
    if (key.escape) {
      onCancel()
    }
  })
  
  const handleTitleSubmit = () => {
    if (title.trim()) {
      setStep('body')
    }
  }
  
  const handleBodySubmit = () => {
    setStep('labels')
  }
  
  const handleLabelsSubmit = () => {
    setStep('confirm')
  }
  
  const handleConfirm = (item: { value: string }) => {
    if (item.value === 'yes') {
      onSubmit({
        title: title.trim(),
        body: body.trim() || undefined,
        labels: labels.trim() ? labels.split(',').map(l => l.trim()) : undefined,
      })
    } else {
      onCancel()
    }
  }
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        [Memo] Create GitHub Issue
      </Text>
      <Box marginTop={1} />
      
      {step === 'title' && (
        <Box flexDirection="column">
          <Text>Issue Title:</Text>
          <Box marginTop={1}>
            <Text color="green">{'>'} </Text>
            <TextInput
              value={title}
              onChange={setTitle}
              onSubmit={handleTitleSubmit}
              placeholder="Enter issue title..."
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        </Box>
      )}
      
      {step === 'body' && (
        <Box flexDirection="column">
          <Text>Issue Body (optional):</Text>
          <Text dimColor>Leave empty and press Enter to skip</Text>
          <Box marginTop={1}>
            <Text color="green">{'>'} </Text>
            <TextInput
              value={body}
              onChange={setBody}
              onSubmit={handleBodySubmit}
              placeholder="Enter issue description..."
            />
          </Box>
        </Box>
      )}
      
      {step === 'labels' && (
        <Box flexDirection="column">
          <Text>Labels (comma-separated, optional):</Text>
          <Box marginTop={1}>
            <Text color="green">{'>'} </Text>
            <TextInput
              value={labels}
              onChange={setLabels}
              onSubmit={handleLabelsSubmit}
              placeholder="bug, enhancement, help wanted..."
            />
          </Box>
        </Box>
      )}
      
      {step === 'confirm' && (
        <Box flexDirection="column">
          <Text bold>Summary:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>Title: <Text color="green">{title}</Text></Text>
            {body && <Text>Body: <Text dimColor>{body.substring(0, 50)}{body.length > 50 ? '...' : ''}</Text></Text>}
            {labels && <Text>Labels: <Text color="blue">{labels}</Text></Text>}
          </Box>
          <Box marginTop={1}>
            <Text>Create this issue?</Text>
          </Box>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: '[OK] Yes, create issue', value: 'yes' },
                { label: '[X] No, cancel', value: 'no' },
              ]}
              onSelect={handleConfirm}
            />
          </Box>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    </Box>
  )
}

/**
 * Parse issue command arguments
 */
function parseIssueArgs(args: string): { action: IssueAction; rest: string } {
  const parts = args.trim().split(/\s+/)
  const firstArg = parts[0]?.toLowerCase() || ''
  
  if (['create', 'new'].includes(firstArg)) {
    return { action: 'create', rest: parts.slice(1).join(' ') }
  }
  if (['list', 'ls'].includes(firstArg)) {
    return { action: 'list', rest: parts.slice(1).join(' ') }
  }
  if (['view', 'show'].includes(firstArg)) {
    return { action: 'view', rest: parts.slice(1).join(' ') }
  }
  if (['close'].includes(firstArg)) {
    return { action: 'close', rest: parts.slice(1).join(' ') }
  }
  
  // Default to create if args look like a title
  if (args.trim()) {
    return { action: 'create', rest: args.trim() }
  }
  
  return { action: 'list', rest: '' }
}

/**
 * Main issue command call function
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  // Check prerequisites
  const ghAvailable = await isGhCliAvailable()
  if (!ghAvailable) {
    onDone('GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/', { display: 'system' })
    return null
  }
  
  const isRepo = await isGitRepo()
  if (!isRepo) {
    onDone('Not in a git repository. Please navigate to a git repository first.', { display: 'system' })
    return null
  }
  
  const { action, rest } = parseIssueArgs(args)
  
  // Handle list action directly
  if (action === 'list') {
    const result = await listIssues()
    if (result.success) {
      onDone(result.issues || 'No issues found.', { display: 'system' })
    } else {
      onDone(`Failed to list issues: ${result.error}`, { display: 'system' })
    }
    return null
  }
  
  // Handle create with inline title
  if (action === 'create' && rest) {
    const result = await createIssue({ title: rest })
    if (result.success) {
      onDone(`Issue created: ${result.url}`, { display: 'system' })
    } else {
      onDone(`Failed to create issue: ${result.error}`, { display: 'system' })
    }
    return null
  }
  
  // Show interactive dialog for create
  return (
    <IssueDialog
      action="create"
      onSubmit={async (data) => {
        const result = await createIssue(data)
        if (result.success) {
          onDone(`Issue created: ${result.url}`, { display: 'system' })
        } else {
          onDone(`Failed to create issue: ${result.error}`, { display: 'system' })
        }
      }}
      onCancel={() => {
        onDone('Issue creation cancelled.', { display: 'system' })
      }}
    />
  )
}

export { createIssue, listIssues, isGhCliAvailable, isGitRepo }
