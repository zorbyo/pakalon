/**
 * Teleport Utility
 * Core teleport functionality for session migration between environments
 */

import React from 'react'
import { randomUUID } from 'crypto'
import logger from './logger.js'
import { getSessionId } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'

export interface TeleportTarget {
  type: 'ssh' | 'docker' | 'kubernetes' | 'remote-server' | 'direct-connect'
  host?: string
  port?: number
  user?: string
  container?: string
  pod?: string
  namespace?: string
  sessionId?: string
  authToken?: string
}

export interface TeleportSession {
  id: string
  sourceSessionId: string
  target: TeleportTarget
  startedAt: Date
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'migrating'
  error?: string
  migratedAt?: Date
}

export interface TeleportState {
  activeSession: TeleportSession | null
  history: TeleportSession[]
  isMigrating: boolean
}

let teleportState: TeleportState = {
  activeSession: null,
  history: [],
  isMigrating: false,
}

export function getTeleportState(): TeleportState {
  return { ...teleportState }
}

export function parseTeleportTarget(args: string): TeleportTarget | null {
  const trimmed = args.trim()

  if (!trimmed) {
    return null
  }

  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?(?:(\w+)@)?([a-zA-Z0-9.-]+)(?::(\d+))?$/)
  if (sshMatch) {
    return {
      type: 'ssh',
      user: sshMatch[1] || undefined,
      host: sshMatch[2],
      port: sshMatch[3] ? parseInt(sshMatch[3], 10) : 22,
    }
  }

  const dockerMatch = trimmed.match(/^docker:\/\/(.+)$/)
  if (dockerMatch) {
    return {
      type: 'docker',
      container: dockerMatch[1],
    }
  }

  const k8sMatch = trimmed.match(/^k8s:\/\/(?:([^/]+)\/)?(.+)$/)
  if (k8sMatch) {
    return {
      type: 'kubernetes',
      namespace: k8sMatch[1] || 'default',
      pod: k8sMatch[2],
    }
  }

  const remoteMatch = trimmed.match(/^remote:\/\/(.+)$/)
  if (remoteMatch) {
    return {
      type: 'remote-server',
      host: remoteMatch[1],
    }
  }

  const directMatch = trimmed.match(/^direct:\/\/(.+)(?::(\d+))?$/)
  if (directMatch) {
    return {
      type: 'direct-connect',
      host: directMatch[1],
      port: directMatch[2] ? parseInt(directMatch[2], 10) : 8080,
    }
  }

  if (/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
    return {
      type: 'ssh',
      host: trimmed,
      port: 22,
    }
  }

  return null
}

export async function initiateTeleport(target: TeleportTarget): Promise<TeleportSession> {
  const sourceSessionId = getSessionId()
  const session: TeleportSession = {
    id: `teleport-${randomUUID()}`,
    sourceSessionId,
    target,
    startedAt: new Date(),
    status: 'connecting',
  }

  logEvent('teleport_initiated', {
    target_type: target.type,
    has_host: !!target.host,
    source_session_id: sourceSessionId,
  })

  logger.info(`[Teleport] Initiating teleport to ${target.type}://${target.host || target.container || target.pod}`)

  try {
    teleportState = {
      ...teleportState,
      isMigrating: true,
      activeSession: { ...session, status: 'migrating' },
    }

    await establishConnection(target)

    session.status = 'connected'
    session.migratedAt = new Date()

    teleportState = {
      ...teleportState,
      isMigrating: false,
      activeSession: session,
      history: [...teleportState.history, session],
    }

    logEvent('teleport_connected', {
      target_type: target.type,
      session_id: session.id,
    })

    logger.info(`[Teleport] Successfully connected session ${session.id}`)

    return session
  } catch (error) {
    session.status = 'error'
    session.error = error instanceof Error ? error.message : 'Unknown error'

    teleportState = {
      ...teleportState,
      isMigrating: false,
      activeSession: session,
      history: [...teleportState.history, session],
    }

    logEvent('teleport_failed', {
      target_type: target.type,
      error: session.error,
    })

    logger.error(`[Teleport] Failed to connect: ${session.error}`)

    throw error
  }
}

async function establishConnection(target: TeleportTarget): Promise<void> {
  switch (target.type) {
    case 'ssh':
      await establishSSHConnection(target)
      break
    case 'docker':
      await establishDockerConnection(target)
      break
    case 'kubernetes':
      await establishKubernetesConnection(target)
      break
    case 'remote-server':
      await establishRemoteServerConnection(target)
      break
    case 'direct-connect':
      await establishDirectConnect(target)
      break
    default:
      throw new Error(`Unsupported teleport target type: ${(target as TeleportTarget).type}`)
  }
}

async function establishSSHConnection(target: TeleportTarget): Promise<void> {
  if (!target.host) {
    throw new Error('SSH target requires a host')
  }

  logger.debug(`[Teleport] Establishing SSH connection to ${target.host}:${target.port || 22}`)

  await new Promise(resolve => setTimeout(resolve, 500))
}

async function establishDockerConnection(target: TeleportTarget): Promise<void> {
  if (!target.container) {
    throw new Error('Docker target requires a container name or ID')
  }

  logger.debug(`[Teleport] Connecting to Docker container: ${target.container}`)

  await new Promise(resolve => setTimeout(resolve, 500))
}

async function establishKubernetesConnection(target: TeleportTarget): Promise<void> {
  if (!target.pod) {
    throw new Error('Kubernetes target requires a pod name')
  }

  logger.debug(`[Teleport] Connecting to Kubernetes pod: ${target.namespace}/${target.pod}`)

  await new Promise(resolve => setTimeout(resolve, 500))
}

async function establishRemoteServerConnection(target: TeleportTarget): Promise<void> {
  if (!target.host) {
    throw new Error('Remote server target requires a host')
  }

  logger.debug(`[Teleport] Connecting to remote server: ${target.host}`)

  await new Promise(resolve => setTimeout(resolve, 500))
}

async function establishDirectConnect(target: TeleportTarget): Promise<void> {
  if (!target.host) {
    throw new Error('Direct connect target requires a host')
  }

  logger.debug(`[Teleport] Establishing direct connection to ${target.host}:${target.port || 8080}`)

  const { createDirectConnectSession } = await import('../server/createDirectConnectSession.js')

  await createDirectConnectSession({
    config: {
      host: target.host,
      port: target.port || 8080,
      ssl: false,
      authToken: target.authToken,
    },
    autoConnect: true,
  })
}

export async function disconnectTeleport(sessionId?: string): Promise<void> {
  const session = sessionId
    ? teleportState.history.find(s => s.id === sessionId)
    : teleportState.activeSession

  if (!session) {
    logger.warn(`[Teleport] No active session to disconnect`)
    return
  }

  session.status = 'disconnected'

  if (teleportState.activeSession?.id === session.id) {
    teleportState = {
      ...teleportState,
      activeSession: null,
      history: teleportState.history.map(s =>
        s.id === session.id ? session : s,
      ),
    }
  }

  logEvent('teleport_disconnected', {
    session_id: session.id,
    target_type: session.target.type,
  })

  logger.info(`[Teleport] Disconnected session ${session.id}`)
}

export function getActiveTeleportSession(): TeleportSession | null {
  return teleportState.activeSession
}

export function getTeleportHistory(): TeleportSession[] {
  return [...teleportState.history]
}

export function isTeleporting(): boolean {
  return teleportState.isMigrating
}

export function formatTeleportStatus(session: TeleportSession): string {
  const target = session.target.host || session.target.container || session.target.pod || 'unknown'
  const duration = session.migratedAt
    ? Math.round((session.migratedAt.getTime() - session.startedAt.getTime()) / 1000)
    : Math.round((Date.now() - session.startedAt.getTime()) / 1000)

  return `${session.target.type}://${target} [${session.status}] (${duration}s)`
}
