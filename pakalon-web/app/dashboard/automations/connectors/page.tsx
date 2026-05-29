'use client'

import { useEffect, useMemo, useState } from 'react'

import { api, useAutomationConnectors, useAutomationCronJobs, useAutomationLogs, useAutomations } from '@/lib/api'
import { AutomationsShell, ConnectorLogo, statusPill } from '@/components/automations/AutomationsShell'

export default function AutomationConnectorsPage() {
  const { automations } = useAutomations()
  const { catalog, loading, error, refetch } = useAutomationConnectors()
  const { cronJobs } = useAutomationCronJobs()
  const { logs } = useAutomationLogs()

  const [banner, setBanner] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('oauth')
    const provider = params.get('provider')
    if (oauth === 'success' && provider) {
      setBanner(`Successfully connected ${provider}. Your automation bridge is ready to mingle.`)
      window.history.replaceState({}, '', '/dashboard/automations/connectors')
      refetch()
    }
  }, [refetch])

  const connectors = useMemo(() => {
    return [...(catalog?.available ?? [])].sort((left, right) => {
      if (left.connected !== right.connected) return left.connected ? -1 : 1
      if (left.oauth_supported !== right.oauth_supported) return left.oauth_supported ? -1 : 1
      return left.display_name.localeCompare(right.display_name)
    })
  }, [catalog?.available])

  const handleConnectProvider = async (provider: string) => {
    setActionLoading(provider)
    try {
      const response = await api.startAutomationOAuth(provider)
      window.location.href = response.auth_url
    } catch (cause) {
      setBanner(cause instanceof Error ? cause.message : `Could not connect ${provider}`)
      setActionLoading(null)
    }
  }

  const handleToggleConnector = async (provider: string, enabled: boolean) => {
    setActionLoading(provider)
    try {
      await api.toggleAutomationConnector(provider, enabled)
      setBanner(`${provider} is now ${enabled ? 'enabled' : 'disabled'}.`)
      refetch()
    } catch (cause) {
      setBanner(cause instanceof Error ? cause.message : `Could not update ${provider}`)
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <AutomationsShell
      title="Connectors"
      description="Manage the apps your automations can talk to. Each application lives in its own card with logo, connection status, and a quick toggle or connect action."
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
      banner={banner}
    >
      <div className="space-y-4 rounded-2xl border border-border-dark bg-surface-dark p-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Applications</h2>
          <p className="text-sm text-[#b1b4a2]">Connect GitHub, Slack, and the rest from here. Connected apps stay at the top so you can spot them instantly.</p>
        </div>

        {loading && <p className="text-[#b1b4a2]">Loading connectors…</p>}
        {error && <p className="text-red-300">{error}</p>}

        {!loading && !connectors.length && (
          <div className="rounded-xl border border-dashed border-border-dark px-4 py-6 text-sm text-[#b1b4a2]">
            No connectors are available yet.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connectors.map((connector) => {
            const badgeStatus = connector.connected
              ? connector.connection_status
              : connector.coming_soon
                ? 'disabled'
                : 'available'

            return (
              <div key={connector.provider} className="space-y-4 rounded-2xl border border-border-dark bg-background-dark p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ConnectorLogo provider={connector.provider} displayName={connector.display_name} logoUrl={connector.logo_url} />
                    <div>
                      <p className="font-semibold text-white">{connector.display_name}</p>
                      <p className="text-sm text-[#b1b4a2]">{connector.category}</p>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(badgeStatus)}`}>
                    {connector.connected ? 'Connected' : connector.coming_soon ? 'Coming soon' : 'Available'}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-[#b1b4a2]">
                  <p>
                    {connector.connected
                      ? connector.account_label || 'Connected via OAuth'
                      : connector.oauth_supported
                        ? 'Ready for OAuth connection'
                        : 'OAuth support will land in a future update'}
                  </p>
                  {connector.scopes.length > 0 && (
                    <p className="text-xs text-[#8f937c]">Scopes: {connector.scopes.join(', ')}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                  <span className="text-xs uppercase tracking-[0.2em] text-[#8f937c]">{connector.provider}</span>

                  {connector.connected ? (
                    <button
                      type="button"
                      onClick={() => handleToggleConnector(connector.provider, !connector.enabled)}
                      disabled={actionLoading === connector.provider}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${connector.enabled ? 'border-emerald-500/20 text-emerald-300' : 'border-yellow-500/20 text-yellow-300'}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{connector.enabled ? 'toggle_on' : 'toggle_off'}</span>
                      {connector.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  ) : connector.oauth_supported ? (
                    <button
                      type="button"
                      onClick={() => handleConnectProvider(connector.provider)}
                      disabled={actionLoading === connector.provider}
                      className="rounded-full border border-primary/30 px-4 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      Connect
                    </button>
                  ) : (
                    <span className="rounded-full border border-white/10 px-3 py-2 text-xs text-[#8f937c]">Soon</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AutomationsShell>
  )
}
