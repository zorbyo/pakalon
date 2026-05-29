'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AutomationsShell, statusPill } from '@/components/automations/AutomationsShell'
import { useAutomations, useAutomationConnectors, useAutomationCronJobs, useAutomationLogs } from '@/lib/api'

interface ExecutionData {
  id: string
  automation_id: string
  status: string
  trigger_type: string
  error_message: string | null
  duration_ms: number | null
  started_at: string
  completed_at: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function WorkflowExecutionsPage() {
  const params = useParams()
  const automationId = params?.id as string

  const { automations } = useAutomations()
  const { catalog } = useAutomationConnectors()
  const { cronJobs } = useAutomationCronJobs()
  const { logs } = useAutomationLogs()

  const [executions, setExecutions] = useState<ExecutionData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!automationId) return

    const fetchExecutions = async () => {
      try {
        const token = localStorage.getItem('pakalon_token')
        const res = await fetch(`${API_BASE}/automations/${automationId}/executions?limit=50`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!res.ok) throw new Error(`Failed to load executions: ${res.status}`)
        const data = await res.json()
        setExecutions(data.executions || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load executions')
      } finally {
        setLoading(false)
      }
    }

    fetchExecutions()
  }, [automationId])

  const automation = automations.find((a) => a.id === automationId)

  return (
    <AutomationsShell
      title="Execution History"
      description={automation ? `All executions for "${automation.name}"` : 'View all execution history for this workflow.'}
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard/automations"
            className="inline-flex items-center gap-1.5 text-sm text-[#b1b4a2] hover:text-white"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to automations
          </Link>
        </div>

        <div className="rounded-2xl border border-border-dark bg-surface-dark p-6">
          <h2 className="text-lg font-semibold text-white">Executions</h2>
          <p className="mt-1 text-sm text-[#b1b4a2]">
            {executions.length} execution{executions.length !== 1 ? 's' : ''} recorded
          </p>

          {loading && (
            <div className="mt-4 flex items-center gap-2 text-[#b1b4a2]">
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              Loading executions...
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300">{error}</div>
          )}

          {!loading && executions.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-border-dark px-4 py-6 text-sm text-[#b1b4a2]">
              No executions yet. Run the workflow to see results here.
            </div>
          )}

          <div className="mt-4 space-y-3">
            {executions.map((exec) => (
              <Link
                key={exec.id}
                href={`/dashboard/automations/editor/${automationId}/executions/${exec.id}`}
                className="block rounded-xl border border-border-dark bg-background-dark p-4 transition-colors hover:border-white/10"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusPill(exec.status)}`}>
                      {exec.status.toUpperCase()}
                    </span>
                    <span className="text-sm text-[#b1b4a2]">{exec.trigger_type}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#8f937c]">
                    {exec.duration_ms !== null && <span>{exec.duration_ms}ms</span>}
                    <span>{new Date(exec.started_at).toLocaleString()}</span>
                    <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                  </div>
                </div>
                {exec.error_message && (
                  <p className="mt-2 text-xs text-red-400">{exec.error_message}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AutomationsShell>
  )
}
