'use client'

import { AutomationsShell, statusPill } from '@/components/automations/AutomationsShell'
import { api, useAutomationConnectors, useAutomationCronJobs, useAutomationLogs, useAutomations } from '@/lib/api'

export default function AutomationCronJobsPage() {
  const { automations } = useAutomations()
  const { catalog } = useAutomationConnectors()
  const { cronJobs, loading, error, refetch: refetchCron } = useAutomationCronJobs()
  const { logs } = useAutomationLogs()

  return (
    <AutomationsShell
      title="Cron jobs"
      description="Every scheduled automation shows up here with its next run and latest status, now as its own page instead of a tab crammed into the main automations screen."
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
    >
      <div className="space-y-4 rounded-2xl border border-border-dark bg-surface-dark p-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Scheduled jobs</h2>
          <p className="text-sm text-[#b1b4a2]">Keep an eye on the automations that are running on a schedule and when they will fire next.</p>
        </div>

        {loading && <p className="text-[#b1b4a2]">Loading cron jobs…</p>}
        {error && <p className="text-red-300">{error}</p>}
        {!loading && !automations.length && (
          <div className="rounded-xl border border-dashed border-border-dark px-4 py-5 text-sm text-[#b1b4a2]">
            No automations created yet.
          </div>
        )}

        {automations.map((automation) => {
          const job = cronJobs.find(j => j.automation_id === automation.id)

          return (
            <div key={automation.id} className="flex flex-col gap-4 rounded-xl border border-border-dark bg-background-dark p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{automation.name}</h3>
                {job && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(job.last_status ?? (job.enabled ? 'enabled' : 'paused'))}`}>
                    {job.enabled ? 'ENABLED' : 'PAUSED'}
                  </span>
                )}
              </div>
              
              {!job ? (
                <div className="text-sm text-[#8f937c]">No cron job associated with this automation.</div>
              ) : (
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-lg bg-[#1a1b16] p-4 border border-white/5">
                  <div>
                    <p className="text-sm text-[#b1b4a2] mb-1">Schedule logic</p>
                    <p className="font-mono text-sm text-white bg-[#25261e] px-2 py-1 rounded inline-block">
                      {job.schedule_cron}
                    </p>
                    <span className="ml-2 text-xs text-[#8f937c]">{job.schedule_timezone}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs mt-2 md:mt-0">
                    {job.next_run_at && (
                      <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-primary font-medium">
                        Next: {new Date(job.next_run_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </AutomationsShell>
  )
}
