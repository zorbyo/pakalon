'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, useBillingStatus, useUser, useUsage } from '@/lib/api'

export default function BillingPage() {
    const router = useRouter()
    const { user, loading: userLoading } = useUser()
    const { usage, loading: usageLoading } = useUsage()
    const { billingStatus, loading: billingLoading } = useBillingStatus()
    const [portalLoading, setPortalLoading] = useState(false)
    const [cancelConfirm, setCancelConfirm] = useState(false)
    const [cancelling, setCancelling] = useState(false)

    const plan = user?.plan ?? 'free'
    const isPro = plan === 'pro'
    const isActive = (billingStatus?.status ?? usage?.subscription_status) === 'active'
    const periodEnd = billingStatus?.current_period_end
        ? new Date(billingStatus.current_period_end)
        : usage?.current_period_end
            ? new Date(usage.current_period_end)
            : null
    const daysIntoCurrentCycle = billingStatus?.days_into_cycle ?? usage?.days_into_cycle ?? 0
    const daysRemaining = billingStatus?.days_remaining
        ?? (periodEnd
            ? Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / 86_400_000))
            : null)
    const totalCycleDays = daysIntoCurrentCycle + (daysRemaining ?? 0)
    const cycleProgress = totalCycleDays > 0 ? Math.round((daysIntoCurrentCycle / totalCycleDays) * 100) : 0
    const securityDeposit = billingStatus?.security_deposit_usd ?? 2
    const platformFeeRate = Math.round((billingStatus?.platform_fee_rate ?? 0.1) * 100)
    const usageCharges = billingStatus?.usage_charges_usd ?? 0
    const platformFee = billingStatus?.platform_fee_usd ?? 0
    const depositApplied = billingStatus?.deposit_applied_usd ?? 0
    const estimatedDue = billingStatus?.estimated_total_due_usd ?? 0
    const cycleTokenUsage = billingStatus?.cycle_token_usage ?? 0

    const handleOpenPortal = async () => {
        setPortalLoading(true)
        try {
            const url = await api.getPortalUrl()
            window.open(url, '_blank')
        } catch {
            alert('Could not open billing portal. Please try again.')
        } finally {
            setPortalLoading(false)
        }
    }

    const handleCancel = async () => {
        setCancelling(true)
        try {
            await api.cancelSubscription()
            setCancelConfirm(false)
            router.refresh()
        } catch {
            alert('Could not cancel subscription. Please contact support.')
        } finally {
            setCancelling(false)
        }
    }

    if (userLoading || usageLoading || billingLoading) {
        return (
            <div className="max-w-6xl mx-auto p-8 lg:p-12 flex items-center justify-center min-h-64">
                <div className="text-[#b1b4a2]">Loading billing information...</div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto p-8 lg:p-12 space-y-12">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight text-white">Billing &amp; Subscription</h2>
                    <p className="text-[#b1b4a2]">Postpaid Pro billing, usage estimates, and payment settings.</p>
                </div>
                <button
                    onClick={() => router.push('/dashboard/support')}
                    className="px-4 py-2 rounded-lg border border-border-dark text-white hover:bg-surface-dark transition-all text-sm font-bold">
                    Contact Support
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-surface-dark border border-border-dark rounded-xl p-6 relative overflow-hidden group">
                    <div className="flex flex-col h-full justify-between">
                        <div className="space-y-1">
                            <p className="text-[#b1b4a2] text-xs font-bold uppercase tracking-wider">Current Plan</p>
                            <div className="flex items-center gap-2">
                                <h3 className="text-white text-2xl font-bold capitalize">{plan} Plan</h3>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    isPro && isActive
                                        ? 'bg-primary/20 text-primary border-primary/20'
                                        : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/20'
                                }`}>
                                    {isPro && isActive ? 'Active' : isPro ? 'Inactive' : 'Free'}
                                </span>
                            </div>
                            <p className="text-white text-lg font-bold mt-2">
                                {isPro ? `$${securityDeposit.toFixed(2)} deposit + usage` : '$0.00'}{' '}
                                <span className="text-[#b1b4a2] text-sm font-normal">{isPro ? '(postpaid)' : '/ lifetime'}</span>
                            </p>
                        </div>
                        <button
                            onClick={() => router.push('/pricing')}
                            className="w-full mt-6 py-2 px-4 bg-primary text-background-dark font-bold text-sm rounded hover:bg-primary-hover transition-colors">
                            {isPro ? 'Manage Pro Access' : 'Upgrade to Pro'}
                        </button>
                    </div>
                    <span className="material-symbols-outlined text-8xl text-primary absolute -right-6 -top-6 opacity-5 rotate-12">
                        verified
                    </span>
                </div>

                <div className="bg-surface-dark border border-border-dark rounded-xl p-6">
                    <div className="flex flex-col h-full justify-between gap-6">
                        {isPro && periodEnd ? (
                            <>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-[#b1b4a2] text-xs font-bold uppercase tracking-wider">Current Cycle Estimate</p>
                                        <h3 className="text-white text-2xl font-bold">
                                            ${estimatedDue.toFixed(2)} due
                                        </h3>
                                    </div>
                                    <p className="text-primary font-bold text-xl">{cycleTokenUsage.toLocaleString()} tokens</p>
                                </div>
                                <div className="text-xs text-[#b1b4a2] space-y-1">
                                    <p>Usage charges: ${usageCharges.toFixed(4)}</p>
                                    <p>Platform fee ({platformFeeRate}%): ${platformFee.toFixed(4)}</p>
                                    <p>Deposit applied: -${depositApplied.toFixed(4)}</p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-[#b1b4a2]">
                                        <span>Billing cycle</span>
                                        <span>{daysRemaining} days left</span>
                                    </div>
                                    <div className="h-2 w-full bg-background-dark rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all" style={{ width: `${cycleProgress}%` }} />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <p className="text-[#b1b4a2] text-xs font-bold uppercase tracking-wider">Free Tier Policy</p>
                                <div>
                                    <p className="text-white text-2xl font-bold">Lifetime Free</p>
                                    <p className="text-[#b1b4a2] text-sm mt-1">Access OpenRouter models ending with <span className="font-mono">:free</span>.</p>
                                </div>
                                <p className="text-xs text-[#8f937c]">Upgrade to Pro for usage-based access to all models.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-surface-dark border border-border-dark rounded-xl p-6">
                    <div className="flex flex-col h-full justify-between">
                        <div className="space-y-1">
                            <p className="text-[#b1b4a2] text-xs font-bold uppercase tracking-wider">Billing Portal</p>
                            <p className="text-white text-sm mt-3 leading-relaxed">
                                View invoices, update your payment method, and manage your postpaid Pro access in the Polar billing portal.
                            </p>
                        </div>
                        <div className="flex flex-col gap-3 mt-6">
                            {isPro ? (
                                <button
                                    onClick={handleOpenPortal}
                                    disabled={portalLoading}
                                    className="text-sm font-bold text-white hover:text-primary transition-colors flex items-center gap-2 group"
                                >
                                    {portalLoading ? 'Opening...' : 'Open Billing Portal'}
                                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
                                </button>
                            ) : (
                                <p className="text-[#b1b4a2] text-sm">Upgrade to Pro to access the billing portal.</p>
                            )}
                            {isPro && isActive && !cancelConfirm && (
                                <button
                                    onClick={() => setCancelConfirm(true)}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors text-left"
                                >
                                    Cancel subscription
                                </button>
                            )}
                            {cancelConfirm && (
                                <div className="text-xs space-y-2">
                                    <p className="text-red-400">Are you sure? This cannot be undone.</p>
                                    <div className="flex gap-3">
                                        <button onClick={handleCancel} disabled={cancelling} className="text-red-400 font-bold">
                                            {cancelling ? 'Cancelling...' : 'Yes, cancel'}
                                        </button>
                                        <button onClick={() => setCancelConfirm(false)} className="text-[#b1b4a2]">Keep plan</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">Invoice History</h3>
                </div>
                {isPro ? (
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-8 text-center space-y-4">
                        <span className="material-symbols-outlined text-4xl text-[#b1b4a2] block">receipt_long</span>
                        <p className="text-white font-medium">View postpaid invoices in the Polar billing portal</p>
                        <p className="text-[#b1b4a2] text-sm">Includes usage charges, {platformFeeRate}% platform fee, and deposit adjustments.</p>
                        <button
                            onClick={handleOpenPortal}
                            disabled={portalLoading}
                            className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-white transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                            {portalLoading ? 'Opening...' : 'Open Billing Portal'}
                        </button>
                    </div>
                ) : (
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-8 text-center space-y-3">
                        <p className="text-[#b1b4a2] text-sm">No invoices — free tier is lifetime and only uses <span className="font-mono">:free</span> models.</p>
                        <button
                            onClick={() => router.push('/pricing')}
                            className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-white transition-colors"
                        >
                            Upgrade to Pro
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
