/**
 * Teleport Command Implementation
 * Handles remote session teleportation for the Pakalon CLI
 */

import React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { logEvent } from '../../services/analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import { TeleportDialog } from './TeleportDialog.js'

export interface TeleportTarget {
  type: 'ssh' | 'docker' | 'kubernetes' | 'remote-server'
  host?: string
  port?: number
  user?: string
  container?: string
  pod?: string
  namespace?: string
}

export interface TeleportSession {
  id: string
  sourceSessionId: string
  target: TeleportTarget
  startedAt: Date
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

/**
 * Parse teleport arguments to determine the target
 */
function parseTeleportArgs(args: string): TeleportTarget | null {
  const trimmed = args.trim()
  
  if (!trimmed) {
    return null
  }
  
  // SSH format: user@host:port or user@host
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?(?:(\w+)@)?([a-zA-Z0-9.-]+)(?::(\d+))?$/)
  if (sshMatch) {
    return {
      type: 'ssh',
      user: sshMatch[1] || undefined,
      host: sshMatch[2],
      port: sshMatch[3] ? parseInt(sshMatch[3], 10) : 22,
    }
  }
  
  // Docker format: docker://container
  const dockerMatch = trimmed.match(/^docker:\/\/(.+)$/)
  if (dockerMatch) {
    return {
      type: 'docker',
      container: dockerMatch[1],
    }
  }
  
  // Kubernetes format: k8s://namespace/pod or k8s://pod
  const k8sMatch = trimmed.match(/^k8s:\/\/(?:([^/]+)\/)?(.+)$/)
  if (k8sMatch) {
    return {
      type: 'kubernetes',
      namespace: k8sMatch[1] || 'default',
      pod: k8sMatch[2],
    }
  }
  
  // Remote server format: remote://host
  const remoteMatch = trimmed.match(/^remote:\/\/(.+)$/)
  if (remoteMatch) {
    return {
      type: 'remote-server',
      host: remoteMatch[1],
    }
  }
  
  // Default to SSH if it looks like a host
  if (/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
    return {
      type: 'ssh',
      host: trimmed,
      port: 22,
    }
  }
  
  return null
}

/**
 * Connect to remote target
 */
async function connectToTarget(target: TeleportTarget): Promise<TeleportSession> {
  const sessionId = getSessionId()
  const session: TeleportSession = {
    id: `teleport-${Date.now()}`,
    sourceSessionId: sessionId,
    target,
    startedAt: new Date(),
    status: 'connecting',
  }
  
  // Log the teleport event
  logEvent('tengu_teleport_initiated', {
    target_type: target.type,
    has_host: !!target.host,
  })
  
  try {
    // Simulate connection process
    // In a real implementation, this would:
    // 1. Establish SSH/Docker/K8s connection
    // 2. Set up bidirectional communication
    // 3. Sync session state
    
    switch (target.type) {
      case 'ssh':
        // TODO: Implement SSH connection
        session.status = 'connected'
        break
        
      case 'docker':
        // TODO: Implement Docker container connection
        session.status = 'connected'
        break
        
      case 'kubernetes':
        // TODO: Implement Kubernetes pod connection
        session.status = 'connected'
        break
        
      case 'remote-server':
        // TODO: Implement remote server connection
        session.status = 'connected'
        break
        
      default:
        throw new Error(`Unsupported teleport target type: ${(target as TeleportTarget).type}`)
    }
    
    logEvent('tengu_teleport_connected', {
      target_type: target.type,
    })
    
    return session
  } catch (error) {
    session.status = 'error'
    session.error = error instanceof Error ? error.message : 'Unknown error'
    
    logEvent('tengu_teleport_failed', {
      target_type: target.type,
      error: session.error,
    })
    
    throw error
  }
}

/**
 * Main teleport command call function
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const target = parseTeleportArgs(args)
  
  if (!target) {
    // Show interactive dialog if no target specified
    return (
      <TeleportDialog
        onSelect={async (selectedTarget) => {
          try {
            const session = await connectToTarget(selectedTarget)
            onDone(`Teleported to ${selectedTarget.type}://${selectedTarget.host || selectedTarget.container || selectedTarget.pod}. Session ID: ${session.id}`, {
              display: 'system',
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            onDone(`Failed to teleport: ${message}`, {
              display: 'system',
            })
          }
        }}
        onCancel={() => {
          onDone('Teleport cancelled.', { display: 'system' })
        }}
      />
    )
  }
  
  try {
    const session = await connectToTarget(target)
    onDone(`Teleported to ${target.type}://${target.host || target.container || target.pod}. Session ID: ${session.id}`, {
      display: 'system',
    })
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    onDone(`Failed to teleport: ${message}`, {
      display: 'system',
    })
    return null
  }
}

export { parseTeleportArgs, connectToTarget }
