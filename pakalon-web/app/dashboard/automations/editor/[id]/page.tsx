'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { WorkflowEditor } from '@/components/automations/editor/WorkflowEditor'
import { type WorkflowNode, type WorkflowEdge } from '@/components/automations/editor/types'

interface WorkflowData {
  id: string
  name: string
  description: string | null
  workflow_json: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
  } | null
  is_visual: boolean
  enabled: boolean
  last_status: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function WorkflowEditorPage() {
  const params = useParams()
  const router = useRouter()
  const automationId = params?.id as string

  const [workflow, setWorkflow] = useState<WorkflowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!automationId) return

    const fetchWorkflow = async () => {
      try {
        const token = localStorage.getItem('pakalon_token')
        const res = await fetch(`${API_BASE}/automations/${automationId}/workflow`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!res.ok) throw new Error(`Failed to load workflow: ${res.status}`)
        const data = await res.json()
        setWorkflow(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }

    fetchWorkflow()
  }, [automationId])

  const handleSave = useCallback(
    async (data: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; name?: string; description?: string }) => {
      const token = localStorage.getItem('pakalon_token')
      const res = await fetch(`${API_BASE}/automations/${automationId}/workflow`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          workflow_json: { nodes: data.nodes, edges: data.edges },
          change_summary: 'Manual save from visual editor',
        }),
      })
      if (!res.ok) throw new Error(`Save failed: ${res.status}`)
      const updated = await res.json()
      setWorkflow(updated)
    },
    [automationId]
  )

  const handleAutoSave = useCallback(
    async (data: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => {
      const token = localStorage.getItem('pakalon_token')
      await fetch(`${API_BASE}/automations/${automationId}/workflow/auto-save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          workflow_json: { nodes: data.nodes, edges: data.edges },
        }),
      })
    },
    [automationId]
  )

  const handleExecute = useCallback(async () => {
    const token = localStorage.getItem('pakalon_token')
    try {
      const res = await fetch(`${API_BASE}/automations/${automationId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const execution = await res.json()
        router.push(`/dashboard/automations/executions/${execution.id}`)
      }
    } catch {
      // silent
    }
  }, [automationId, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background-dark">
        <div className="text-center">
          <span className="material-symbols-outlined animate-spin text-4xl text-primary">progress_activity</span>
          <p className="mt-3 text-[#b1b4a2]">Loading workflow editor...</p>
        </div>
      </div>
    )
  }

  if (error || !workflow) {
    return (
      <div className="flex h-screen items-center justify-center bg-background-dark">
        <div className="text-center">
          <span className="material-symbols-outlined text-4xl text-red-400">error</span>
          <p className="mt-3 text-red-300">{error || 'Workflow not found'}</p>
          <Link
            href="/dashboard/automations"
            className="mt-4 inline-block rounded-lg border border-border-dark px-4 py-2 text-sm text-white hover:bg-white/5"
          >
            Back to Automations
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background-dark">
      {/* Header */}
      <div className="border-b border-border-dark bg-surface-dark px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/automations"
              className="rounded-lg p-1.5 text-[#b1b4a2] hover:bg-white/5 hover:text-white"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-white">{workflow.name}</h1>
              {workflow.description && (
                <p className="text-sm text-[#b1b4a2]">{workflow.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs ${
              workflow.enabled
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
            }`}>
              {workflow.enabled ? 'ENABLED' : 'DISABLED'}
            </span>

            <button
              type="button"
              onClick={handleExecute}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 px-3 py-1.5 text-sm text-primary hover:bg-primary/10"
            >
              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              Run
            </button>

            <Link
              href={`/dashboard/automations/editor/${automationId}/executions`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark px-3 py-1.5 text-sm text-[#b1b4a2] hover:bg-white/5 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">history</span>
              History
            </Link>
          </div>
        </div>
      </div>

      {/* Editor */}
      <WorkflowEditor
        automationId={automationId}
        initialNodes={workflow.workflow_json?.nodes || []}
        initialEdges={workflow.workflow_json?.edges || []}
        automationName={workflow.name}
        automationDescription={workflow.description || ''}
        onSave={handleSave}
        onAutoSave={handleAutoSave}
      />
    </div>
  )
}
