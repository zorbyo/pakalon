'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, RefreshCw, Database, PlugZap, Server, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { localApi, type LocalModel, type LocalProviderStatus } from '@/lib/local-api'

function providerLabel(value: LocalModel['provider']) {
  return value === 'ollama' ? 'Ollama' : 'LM Studio'
}

function badgeClass(provider: LocalModel['provider']) {
  return provider === 'ollama' ? 'bg-primary/15 text-primary' : 'bg-[#2c2f50] text-[#b8c2ff]'
}

export default function SelfHostedModelsPage() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [providers, setProviders] = useState<LocalProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async (showToast = false) => {
    try {
      showToast ? setRefreshing(true) : setLoading(true)
      setError(null)

      const [modelsResponse, providersResponse] = await Promise.all([
        localApi.getModels(),
        localApi.getProviders(),
      ])

      setModels(modelsResponse.models)
      setProviders(providersResponse.providers)

      if (showToast) toast.success('Local models refreshed')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach the local model backend.'
      setError(message)
      toast.error('Could not load local models')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadData(false)
  }, [loadData])

  const totalModels = models.length
  const availableProviders = providers.filter((provider) => provider.available).length

  const providerCards = useMemo(
    () =>
      providers.map((provider) => (
        <div key={provider.name} className="rounded-2xl border border-border-dark bg-[#1a1b16] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">{providerLabel(provider.name)}</p>
              <p className="mt-1 text-xs text-[#8f937c] break-all">{provider.base_url}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                provider.available ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {provider.available ? 'Available' : 'Unavailable'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border-dark bg-[#25261e] p-3">
              <p className="text-xs text-[#8f937c]">Enabled</p>
              <p className="mt-1 font-semibold text-white">{provider.enabled ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-xl border border-border-dark bg-[#25261e] p-3">
              <p className="text-xs text-[#8f937c]">Models</p>
              <p className="mt-1 font-semibold text-white">{provider.model_count.toLocaleString()}</p>
            </div>
          </div>
          {provider.error ? (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {provider.error}
            </div>
          ) : null}
        </div>
      )),
    [providers],
  )

  return (
    <div className="space-y-8 p-6 lg:p-8">
      <section className="rounded-[28px] border border-border-dark bg-[#11120d] p-6 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.75)]">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              <Sparkles className="size-3.5" />
              Self-hosted models
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">Discover local providers</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#b1b4a2]">
              Scan Ollama and LM Studio on your machine, inspect provider health, and pick a model for local chat.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[#1d1e14] transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Re-discover models'}
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border-dark bg-[#1a1b16] p-5">
            <div className="flex items-center gap-2 text-[#b1b4a2]">
              <Database className="size-4 text-primary" />
              <span className="text-sm font-medium">Discovered models</span>
            </div>
            <p className="mt-3 text-3xl font-bold">{loading ? '…' : totalModels}</p>
          </div>
          <div className="rounded-2xl border border-border-dark bg-[#1a1b16] p-5">
            <div className="flex items-center gap-2 text-[#b1b4a2]">
              <Server className="size-4 text-primary" />
              <span className="text-sm font-medium">Available providers</span>
            </div>
            <p className="mt-3 text-3xl font-bold">{loading ? '…' : availableProviders}</p>
          </div>
          <div className="rounded-2xl border border-border-dark bg-[#1a1b16] p-5">
            <div className="flex items-center gap-2 text-[#b1b4a2]">
              <PlugZap className="size-4 text-primary" />
              <span className="text-sm font-medium">Backend mode</span>
            </div>
            <p className="mt-3 text-3xl font-bold">Local</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-300">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Unable to reach local backend</p>
            <p className="mt-1 text-sm leading-6">{error}</p>
          </div>
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">{providerCards}</section>

      <section className="rounded-[28px] border border-border-dark bg-[#11120d] p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Model catalog</h2>
            <p className="text-sm text-[#b1b4a2]">Provider, context window, parameters, and quantization metadata.</p>
          </div>
          <span className="text-xs uppercase tracking-[0.22em] text-[#8f937c]">{totalModels.toLocaleString()} total</span>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl border border-border-dark bg-[#1a1b16]" />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border-dark bg-[#1a1b16] p-8 text-center">
            <p className="text-lg font-semibold text-white">No models found</p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[#b1b4a2]">
              Start Ollama or LM Studio locally, then use the refresh button to rediscover models.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border-dark">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#1a1b16] text-[#8f937c]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Context</th>
                    <th className="px-4 py-3 font-medium">Parameters</th>
                    <th className="px-4 py-3 font-medium">Quantization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark bg-[#11120d]">
                  {models.map((model) => (
                    <tr key={`${model.provider}-${model.id}`} className="hover:bg-[#1a1b16]/80">
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-semibold text-white">{model.name}</p>
                          <p className="mt-1 text-xs text-[#8f937c]">{model.id}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(model.provider)}`}>
                          {providerLabel(model.provider)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-[#b1b4a2]">{model.context_window.toLocaleString()}</td>
                      <td className="px-4 py-4 text-[#b1b4a2]">{model.parameters ?? '—'}</td>
                      <td className="px-4 py-4 text-[#b1b4a2]">{model.quantization ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
