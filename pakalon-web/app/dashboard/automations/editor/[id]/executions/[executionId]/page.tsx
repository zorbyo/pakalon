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
  trigger_data: Record<string, unknown>
  execution_data: Record<string, unknown>
  error_message: string | null
  duration_ms: number | null
  started_at: string
  completed_at: string | null
}

interface NodeLogData {
  id: string
  node_id: string
  node_name: string | null
  node_type: string
  status: string
  level: string
  message: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  error_message: string | null
  retry_count: number
  duration_ms: number | null
  sort_order: number
  started_at: string
  completed_at: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ExecutionDetailPage() {
  const params = useParams()
  const automationId = params?.id as string
  const executionId = params?.executionId as string

  const { automations } = useAutomations()
  const { catalog } = useAutomationConnectors()
  const { cronJobs } = useAutomationCronJobs()
  const { logs } = useAutomationLogs()

  const [execution, setExecution] = useState<ExecutionData | null>(null)
  const [nodeLogs, setNodeLogs] = useState<NodeLogData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedNode, setExpandedNode] = useState<string | null>(null)

  useEffect(() => {
    if (!automationId || !executionId) return

    const fetchData = async () => {
      try {
        const token = localStorage.getItem('pakalon_token')
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

        const [execRes, logsRes] = await Promise.all([
          fetch(`${API_BASE}/automations/${automationId}/executions/${executionId}`, { headers }),
          fetch(`${API_BASE}/automations/executions/${executionId}/node-logs`, { headers }),
        ])

        if (!execRes.ok) throw new Error(`Execution not found: ${execRes.status}`)
        const execData = await execRes.json()
        setExecution(execData)

        if (logsRes.ok) {
          const logsData = await logsRes.json()
          setNodeLogs(logsData.node_logs || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [automationId, executionId])

  const automation = automations.find((a) => a.id === automationId)

  return (
    <AutomationsShell
      title="Execution Detail"
      description={automation ? `Execution log for "${automation.name}"` : 'View execution details and node-level logs.'}
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
    >
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href="/dashboard/automations"
          className="inline-flex items-center gap-1.5 text-sm text-[#b1b4a2] hover:text-white"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to automations
        </Link>

        {loading && (
          <div className="flex items-center gap-2 text-[#b1b4a2]">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Loading execution...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300">{error}</div>
        )}

        {execution && (
          <>
            {/* Execution summary */}
            <div className="rounded-2xl border border-border-dark bg-surface-dark p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusPill(execution.status)}`}>
                      {execution.status.toUpperCase()}
                    </span>
                    <span className="text-sm text-[#b1b4a2]">{execution.trigger_type}</span>
                  </div>
                  <p className="mt-2 text-xs text-[#8f937c]">
                    Started: {new Date(execution.started_at).toLocaleString()}
                    {execution.completed_at && (
                      <> / Completed: {new Date(execution.completed_at).toLocaleString()}</>
                    )}
                    {execution.duration_ms !== null && <> / Duration: {execution.duration_ms}ms</>}
                  </p>
                </div>

                {execution.error_message && (
                  <div className="max-w-md rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    {execution.error_message}
                  </div>
                )}
              </div>

              {/* Execution data summary */}
              {execution.execution_data && Object.keys(execution.execution_data).length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-[#b1b4a2] hover:text-white">
                    Execution data
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-background-dark p-3 text-xs text-[#b1b4a2]">
                    {JSON.stringify(execution.execution_data, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            {/* Node logs */}
            <div className="rounded-2xl border border-border-dark bg-surface-dark p-6">
              <h2 className="text-lg font-semibold text-white">Node Execution Log</h2>
              <p className="mt-1 text-sm text-[#b1b4a2]">
                Step-by-step execution of each node in the workflow.
              </p>

              <div className="mt-4 space-y-3">
                {nodeLogs.length === 0 ? (
                  <p className="text-sm text-[#8f937c]">No node-level logs available for this execution.</p>
                ) : (
                  nodeLogs.map((log, index) => (
                    <div
                      key={log.id}
                      className="rounded-xl border border-border-dark bg-background-dark overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedNode(expandedNode === log.id ? null : log.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs text-[#8f937c]">
                          {index + 1}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPill(log.status)}`}>
                          {log.status.toUpperCase()}
                        </span>
                        <span className="text-sm font-medium text-white">
                          {log.node_name || log.node_id}
                        </span>
                        <span className="text-xs text-[#8f937c]">{log.node_type}</span>
                        {log.duration_ms !== null && (
                          <span className="ml-auto text-xs text-[#8f937c]">{log.duration_ms}ms</span>
                        )}
                        <span className="material-symbols-outlined text-[16px] text-[#8f937c]">
                          {expandedNode === log.id ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>

                      {expandedNode === log.id && (
                        <div className="border-t border-border-dark px-4 py-3 space-y-3">
                          {log.message && (
                            <div>
                              <p className="text-xs font-medium text-[#d7dac8]">Message</p>
                              <p className="text-sm text-white">{log.message}</p>
                            </div>
                          )}
                          {log.error_message && (
                            <div>
                              <p className="text-xs font-medium text-red-400">Error</p>
                              <p className="text-sm text-red-300">{log.error_message}</p>
                            </div>
                          )}
                          {log.input_data && Object.keys(log.input_data).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-[#d7dac8]">Input</p>
                              <pre className="overflow-x-auto rounded-lg bg-[#11120d] p-2 text-xs text-[#b1b4a2]">
                                {JSON.stringify(log.input_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.output_data && Object.keys(log.output_data).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-[#d7dac8]">Output</p>
                              <pre className="overflow-x-auto rounded-lg bg-[#11120d] p-2 text-xs text-[#b1b4a2]">
                                {JSON.stringify(log.output_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          <p className="text-xs text-[#8f937c]">
                            Started: {new Date(log.started_at).toLocaleString()}
                            {log.completed_at && <> / Completed: {new Date(log.completed_at).toLocaleString()}</>}
                            {log.retry_count > 0 && <> / Retries: {log.retry_count}</>}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AutomationsShell>
  )
}
