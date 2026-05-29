/**
 * Backfill Sessions Command Implementation
 * Repairs and backfills session metadata for historical sessions
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { logEvent } from '../../services/analytics/index.js'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

interface SessionInfo {
  sessionId: string
  path: string
  hasMetadata: boolean
  messageCount: number
  created?: Date
  modified?: Date
  issues?: string[]
}

interface BackfillResult {
  processed: number
  repaired: number
  skipped: number
  errors: number
  sessions: SessionInfo[]
}

/**
 * Get the sessions directory
 */
function getSessionsDir(): string {
  return join(homedir(), '.pakalon', 'sessions')
}

/**
 * Scan sessions directory and identify sessions needing repair
 */
async function scanSessions(): Promise<SessionInfo[]> {
  const sessionsDir = getSessionsDir()
  const sessions: SessionInfo[] = []
  
  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue
      }
      
      const sessionId = basename(entry.name, '.jsonl')
      const sessionPath = join(sessionsDir, entry.name)
      
      try {
        const stat = await fs.stat(sessionPath)
        const content = await fs.readFile(sessionPath, 'utf-8')
        const lines = content.split('\n').filter(line => line.trim())
        
        const issues: string[] = []
        let hasMetadata = false
        let messageCount = 0
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (entry.type === 'user' || entry.type === 'assistant') {
              messageCount++
            }
            if (entry.type === 'metadata') {
              hasMetadata = true
            }
          } catch {
            issues.push('Invalid JSON line detected')
          }
        }
        
        if (!hasMetadata) {
          issues.push('Missing metadata entry')
        }
        
        if (messageCount === 0) {
          issues.push('No messages found')
        }
        
        sessions.push({
          sessionId,
          path: sessionPath,
          hasMetadata,
          messageCount,
          created: stat.birthtime,
          modified: stat.mtime,
          issues: issues.length > 0 ? issues : undefined,
        })
      } catch (error) {
        sessions.push({
          sessionId,
          path: sessionPath,
          hasMetadata: false,
          messageCount: 0,
          issues: [`Error reading session: ${error instanceof Error ? error.message : 'Unknown error'}`],
        })
      }
    }
  } catch {
    // Sessions directory doesn't exist or is inaccessible
  }
  
  return sessions
}

/**
 * Repair a session by adding missing metadata
 */
async function repairSession(session: SessionInfo, dryRun: boolean): Promise<boolean> {
  if (!session.issues || session.issues.length === 0) {
    return false
  }
  
  if (dryRun) {
    return true // Would have repaired
  }
  
  try {
    // Read current content
    const content = await fs.readFile(session.path, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())
    
    // Check if metadata exists
    let hasMetadata = false
    const parsedLines: unknown[] = []
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'metadata') {
          hasMetadata = true
        }
        parsedLines.push(entry)
      } catch {
        // Skip invalid lines
      }
    }
    
    // Add metadata if missing
    if (!hasMetadata && session.messageCount > 0) {
      const metadata = {
        type: 'metadata',
        sessionId: session.sessionId,
        created: session.created?.toISOString() || new Date().toISOString(),
        repairedAt: new Date().toISOString(),
        messageCount: session.messageCount,
      }
      
      // Prepend metadata to file
      const newContent = JSON.stringify(metadata) + '\n' + content
      await fs.writeFile(session.path, newContent, 'utf-8')
      
      return true
    }
    
    return false
  } catch {
    return false
  }
}

/**
 * Backfill Display Component
 */
function BackfillDisplay({ result, dryRun }: { result: BackfillResult; dryRun: boolean }): React.ReactElement {
  const sessionsWithIssues = result.sessions.filter(s => s.issues && s.issues.length > 0)
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        [Wrench] Session Backfill {dryRun ? '(Dry Run)' : 'Complete'}
      </Text>
      <Box marginTop={1} />
      
      <Box flexDirection="column">
        <Text>Total sessions scanned: <Text color="blue">{result.processed}</Text></Text>
        <Text>Sessions repaired: <Text color="green">{result.repaired}</Text></Text>
        <Text>Sessions skipped: <Text color="yellow">{result.skipped}</Text></Text>
        <Text>Errors: <Text color="red">{result.errors}</Text></Text>
      </Box>
      
      {sessionsWithIssues.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Sessions with issues:</Text>
          {sessionsWithIssues.slice(0, 10).map(session => (
            <Box key={session.sessionId} marginLeft={2} flexDirection="column">
              <Text color="yellow">{session.sessionId}</Text>
              {session.issues?.map((issue, idx) => (
                <Text key={idx} dimColor marginLeft={2}>• {issue}</Text>
              ))}
            </Box>
          ))}
          {sessionsWithIssues.length > 10 && (
            <Text dimColor>... and {sessionsWithIssues.length - 10} more</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

/**
 * Main backfill-sessions command call function
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const dryRun = args.includes('--dry-run')
  
  logEvent('tengu_backfill_sessions_started', {
    dry_run: dryRun,
  })
  
  const sessions = await scanSessions()
  
  const result: BackfillResult = {
    processed: sessions.length,
    repaired: 0,
    skipped: 0,
    errors: 0,
    sessions,
  }
  
  for (const session of sessions) {
    if (!session.issues || session.issues.length === 0) {
      result.skipped++
      continue
    }
    
    try {
      const repaired = await repairSession(session, dryRun)
      if (repaired) {
        result.repaired++
      } else {
        result.skipped++
      }
    } catch {
      result.errors++
    }
  }
  
  logEvent('tengu_backfill_sessions_completed', {
    dry_run: dryRun,
    processed: result.processed,
    repaired: result.repaired,
    errors: result.errors,
  })
  
  if (sessions.length === 0) {
    onDone('No sessions found to backfill.', { display: 'system' })
    return null
  }
  
  const summary = dryRun 
    ? `Dry run: ${result.repaired} sessions would be repaired`
    : `Backfill complete: ${result.repaired} sessions repaired`
  
  onDone(summary, { display: 'system' })
  return <BackfillDisplay result={result} dryRun={dryRun} />
}

export { scanSessions, repairSession, getSessionsDir }
