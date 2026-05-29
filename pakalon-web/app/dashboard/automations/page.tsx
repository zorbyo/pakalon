'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { api, useAutomationConnectors, useAutomationCronJobs, useAutomationLogs, useAutomations, useModels, type AutomationRecord } from '@/lib/api'
import { AutomationsShell, statusPill } from '@/components/automations/AutomationsShell'
import { SmartPromptEditor } from '@/components/automations/SmartPromptEditor'

function toAutomationBannerError(error: unknown, fallback: string) {
  if (typeof error === 'string') {
    if (error.includes('Could not connect to the Pakalon backend')) {
      return 'Unable to reach automations service right now. Please try again shortly.'
    }
    return error
  }
  if (!(error instanceof Error)) return fallback
  if (error.message.includes('Could not connect to the Pakalon backend')) {
    return 'Unable to reach automations service right now. Please try again shortly.'
  }
  return error.message
}

export default function AutomationsPage() {
  const { automations, loading: automationsLoading, error: automationsError, refetch: refetchAutomations } = useAutomations()
  const { catalog, refetch: refetchConnectors } = useAutomationConnectors()
  const { cronJobs, refetch: refetchCron } = useAutomationCronJobs()
  const { logs, refetch: refetchLogs } = useAutomationLogs()
  const { models, plan, loading: modelsLoading, error: modelsError } = useModels()

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([])
  const [scheduleType, setScheduleType] = useState('*/15 * * * *')
  const [customCron, setCustomCron] = useState('*/15 * * * *')
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const connectedProviders = useMemo(
    () => new Set((catalog?.connected ?? []).filter((item) => item.enabled).map((item) => item.provider)),
    [catalog?.connected],
  )

  const availableModels = useMemo(() => {
    const candidates = plan === 'free' ? models.filter((model) => model.id.endsWith(':free')) : models
    return candidates.sort((a, b) => a.name.localeCompare(b.name))
  }, [models, plan])

  useEffect(() => {
    if (selectedModel) return
    if (!availableModels.length) return
    setSelectedModel(availableModels[0].id)
  }, [availableModels, selectedModel])

  const handleCreateAutomation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setBanner(null)
    try {
      const finalCron = scheduleType === 'custom' ? customCron : scheduleType
      const created = await api.createAutomation({
        name,
        prompt,
        model_id: selectedModel || undefined,
        required_connectors: selectedConnectors,
        schedule_cron: finalCron,
      })

      setName('')
      setPrompt('')
      setSelectedConnectors([])
      setScheduleType('*/15 * * * *')
      setBanner(
        created.missing_connectors.length
          ? `Automation created. Connect ${created.missing_connectors.join(', ')} on the connectors page to fully activate it.`
          : 'Automation created and ready to run.',
      )
      refetchAutomations()
      refetchCron()
      refetchLogs()
      refetchConnectors()
    } catch (error) {
      setBanner(toAutomationBannerError(error, 'Could not create automation'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRunAutomation = async (automation: AutomationRecord) => {
    setActionLoading(automation.id)
    try {
      await api.runAutomation(automation.id)
      setBanner(`Ran ${automation.name}. Logs refreshed with fresh gossip.`)
      refetchAutomations()
      refetchLogs()
    } catch (error) {
      setBanner(toAutomationBannerError(error, 'Could not run automation'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleAutomation = async (automation: AutomationRecord) => {
    setActionLoading(automation.id)
    try {
      await api.updateAutomation(automation.id, { enabled: !automation.enabled })
      setBanner(`${automation.name} is now ${automation.enabled ? 'paused' : 'enabled'}.`)
      refetchAutomations()
      refetchCron()
    } catch (error) {
      setBanner(toAutomationBannerError(error, 'Could not update automation'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteAutomation = async (automation: AutomationRecord) => {
    setActionLoading(automation.id)
    try {
      await api.deleteAutomation(automation.id)
      setBanner(`${automation.name} deleted.`)
      refetchAutomations()
      refetchCron()
      refetchLogs()
    } catch (error) {
      setBanner(toAutomationBannerError(error, 'Could not delete automation'))
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <AutomationsShell
      title="Automations"
      description="Create and manage your automations. Each card shows workflow details, schedule, recent logs, and cron job status at a glance."
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
      banner={banner}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <form onSubmit={handleCreateAutomation} className="space-y-5 rounded-2xl border border-border-dark bg-surface-dark p-6">
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Create automation</h2>
            <p className="text-sm text-[#b1b4a2]">Name it, describe the job, choose connectors, and set the schedule.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-[#d7dac8]">Automation name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Repo monitor"
                className="w-full rounded-xl border border-border-dark bg-background-dark px-4 py-3 text-white outline-none focus:border-primary"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-[#d7dac8]">Schedule / cron</span>
              <select
                value={scheduleType}
                onChange={(event) => setScheduleType(event.target.value)}
                className="w-full rounded-xl border border-border-dark bg-background-dark px-4 py-3 text-white outline-none focus:border-primary appearance-none"
              >
                <option value="*/15 * * * *">Every 15 minutes</option>
                <option value="0 * * * *">Hourly</option>
                <option value="0 0 * * *">Daily at midnight</option>
                <option value="custom">Custom</option>
              </select>
              {scheduleType === 'custom' && (
                <input
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                  placeholder="e.g. */15 * * * *"
                  className="mt-2 w-full rounded-xl border border-border-dark bg-background-dark px-4 py-3 text-white outline-none focus:border-primary font-mono text-sm"
                  required
                />
              )}
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm text-[#d7dac8]">Model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full rounded-xl border border-border-dark bg-background-dark px-4 py-3 text-white outline-none focus:border-primary appearance-none"
                disabled={modelsLoading || !availableModels.length}
                required
              >
                {!availableModels.length && <option value="">No models available</option>}
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.id})
                  </option>
                ))}
              </select>
              <p className="text-xs text-[#8f937c]">
                {plan === 'free'
                  ? 'Free plan can use only models ending with :free.'
                  : 'Pro plan can use all available OpenRouter models.'}
              </p>
              {modelsError && <p className="text-xs text-yellow-300">{modelsError}</p>}
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm text-[#d7dac8]">Automation prompt</span>
            <SmartPromptEditor
              value={prompt}
              onChange={setPrompt}
              connectedProviders={Array.from(connectedProviders)}
              providerDisplayNames={Object.fromEntries(
                (catalog?.connected ?? []).map(c => [c.provider, c.display_name])
              )}
              fetchResources={async (provider) => {
                try {
                  return await api.fetchConnectorResources(provider)
                } catch {
                  return []
                }
              }}
              placeholder="Describe your automation. Use @ to mention connected providers (e.g. @github owner/repo, @slack #channel, @notion database)"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-[#d7dac8]">Needed app connections</span>
            {catalog?.connected && catalog.connected.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {catalog.connected.map((connector) => {
                  const isSelected = selectedConnectors.includes(connector.provider)
                  return (
                    <button
                      key={connector.provider}
                      type="button"
                      onClick={() => {
                        setSelectedConnectors(prev => 
                          isSelected ? prev.filter(p => p !== connector.provider) : [...prev, connector.provider]
                        )
                      }}
                      className={`px-4 py-2 rounded-xl border text-sm transition-colors ${
                        isSelected 
                        ? 'border-primary bg-primary/10 text-primary font-medium' 
                        : 'border-border-dark bg-background-dark text-[#b1b4a2] hover:border-[#8f937c]'
                      }`}
                    >
                      {connector.display_name}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-[#8f937c] bg-background-dark border border-border-dark rounded-xl px-4 py-3">
                No apps connected yet. Go to Connectors to link an app.
              </div>
            )}
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-background-dark transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            {submitting ? 'Creating…' : 'Create automation'}
          </button>
        </form>

        <div className="space-y-4 rounded-2xl border border-border-dark bg-surface-dark p-6">
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Automation list</h2>
            <p className="text-sm text-[#b1b4a2]">Every automation you create appears here with its status, schedule, and quick actions.</p>
          </div>

          {automationsLoading && <p className="text-[#b1b4a2]">Loading automations…</p>}
          {automationsError && <p className="text-red-300">{toAutomationBannerError(automationsError, 'Unable to load automations')}</p>}
          {!automationsLoading && !automations.length && (
            <div className="rounded-xl border border-dashed border-border-dark px-4 py-6 text-sm text-[#b1b4a2]">
              No automations yet. Create one on the left and it will show up here.
            </div>
          )}

          {automations.map((automation) => {
            const job = cronJobs.find(j => j.automation_id === automation.id)
            const automationLogs = logs.filter(l => l.automation_id === automation.id).slice(0, 3)
            const isExpanded = expandedId === automation.id
            const nodeCount = automation.workflow_json?.nodes?.length ?? 0
            const edgeCount = automation.workflow_json?.edges?.length ?? 0

            return (
              <div key={automation.id} className="rounded-xl border border-border-dark bg-background-dark">
                {/* ── Header ─────────────────────────────────── */}
                <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-white">{automation.name}</h3>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusPill(automation.last_status ?? (automation.enabled ? 'enabled' : 'paused'))}`}>
                        {(automation.last_status ?? (automation.enabled ? 'enabled' : 'paused')).toUpperCase()}
                      </span>
                      {automation.is_visual && (
                        <span className="rounded-full border border-violet-500/30 px-2 py-0.5 text-xs text-violet-300">
                          VISUAL
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-[#b1b4a2]">{automation.description || automation.prompt}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#8f937c]">
                      <span className="rounded-full border border-white/10 px-2 py-1">{automation.schedule_cron || 'manual'}</span>
                      {automation.model_id && (
                        <span className="rounded-full border border-primary/30 px-2 py-1 text-primary">{automation.model_id}</span>
                      )}
                      {automation.required_connectors.map((connector) => (
                        <span key={connector} className={`rounded-full border px-2 py-1 ${connectedProviders.has(connector) ? 'border-emerald-500/20 text-emerald-300' : 'border-yellow-500/20 text-yellow-300'}`}>
                          {connector}
                        </span>
                      ))}
                      {automation.is_visual && (
                        <span className="rounded-full border border-violet-500/20 px-2 py-1 text-violet-300">
                          {nodeCount} nodes · {edgeCount} edges · v{automation.workflow_version}
                        </span>
                      )}
                    </div>
                    {!!automation.missing_connectors.length && (
                      <p className="mt-3 text-xs text-yellow-300">Missing connectors: {automation.missing_connectors.join(', ')}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/automations/editor/${automation.id}`}
                      className="rounded-lg border border-primary/30 px-3 py-2 text-sm text-primary hover:bg-primary/10"
                    >
                      Open Editor
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRunAutomation(automation)}
                      disabled={actionLoading === automation.id}
                      className="rounded-lg border border-primary/30 px-3 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleAutomation(automation)}
                      disabled={actionLoading === automation.id}
                      className="rounded-lg border border-border-dark px-3 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-60"
                    >
                      {automation.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : automation.id)}
                      className="rounded-lg border border-border-dark px-3 py-2 text-sm text-[#b1b4a2] hover:bg-white/5"
                    >
                      <span className="material-symbols-outlined text-[16px] align-middle">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAutomation(automation)}
                      disabled={actionLoading === automation.id}
                      className="rounded-lg border border-red-500/20 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* ── Expanded: Workflow + Cron + Logs ──────────── */}
                {isExpanded && (
                  <div className="border-t border-border-dark px-4 pb-4 pt-3">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      {/* Workflow section */}
                      <div className="space-y-2 rounded-lg bg-[#1a1b16] p-3">
                        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#8f937c]">
                          <span className="material-symbols-outlined text-[14px]">account_tree</span>
                          Workflow
                        </h4>
                        {automation.is_visual && automation.workflow_json ? (
                          <div className="space-y-1 text-xs text-[#b1b4a2]">
                            <p>Nodes: <span className="text-white">{nodeCount}</span></p>
                            <p>Edges: <span className="text-white">{edgeCount}</span></p>
                            <p>Version: <span className="text-white">v{automation.workflow_version}</span></p>
                            <p>Type: <span className="text-white">{automation.trigger_type}</span></p>
                          </div>
                        ) : (
                          <p className="text-xs text-[#8f937c]">Classic prompt-based automation. Open Editor to build a visual workflow.</p>
                        )}
                      </div>

                      {/* Cron / Schedule section */}
                      <div className="space-y-2 rounded-lg bg-[#1a1b16] p-3">
                        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#8f937c]">
                          <span className="material-symbols-outlined text-[14px]">schedule</span>
                          Schedule
                        </h4>
                        {job ? (
                          <div className="space-y-1 text-xs text-[#b1b4a2]">
                            <p>Cron: <span className="font-mono text-white">{job.schedule_cron}</span></p>
                            <p>Timezone: <span className="text-white">{job.schedule_timezone}</span></p>
                            {job.next_run_at && (
                              <p>Next run: <span className="text-white">{new Date(job.next_run_at).toLocaleString()}</span></p>
                            )}
                            {automation.last_run_at && (
                              <p>Last run: <span className="text-white">{new Date(automation.last_run_at).toLocaleString()}</span></p>
                            )}
                            <p className="flex items-center gap-1 mt-1">
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${job.enabled ? 'bg-emerald-400' : 'bg-yellow-400'}`} />
                              {job.enabled ? 'Active' : 'Paused'}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-[#8f937c]">No schedule — manual trigger only.</p>
                        )}
                      </div>

                      {/* Recent Logs section */}
                      <div className="space-y-2 rounded-lg bg-[#1a1b16] p-3">
                        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#8f937c]">
                          <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                          Recent executions
                        </h4>
                        {automationLogs.length > 0 ? (
                          <div className="space-y-1.5">
                            {automationLogs.map((log) => (
                              <div key={log.id} className="flex items-center gap-2 rounded bg-[#11120d] px-2 py-1.5">
                                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${log.status === 'success' ? 'bg-emerald-400' : log.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                                <span className="truncate text-xs text-[#b1b4a2] flex-1">{log.summary || log.status}</span>
                                <span className="shrink-0 text-[10px] text-[#8f937c]">{new Date(log.started_at).toLocaleDateString()}</span>
                              </div>
                            ))}
                            {logs.filter(l => l.automation_id === automation.id).length > 3 && (
                              <Link
                                href={`/dashboard/automations/logs`}
                                className="block text-center text-xs text-primary hover:underline"
                              >
                                View all logs →
                              </Link>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-[#8f937c]">No executions yet. Click "Run now" or wait for the next scheduled run.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </AutomationsShell>
  )
}
