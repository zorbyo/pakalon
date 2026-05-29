'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, useUser } from '@/lib/api'

export default function ProfilePage() {
    const router = useRouter()
    const { user, loading, refetch } = useUser()
    const [displayName, setDisplayName] = useState('')
    const [privacyMode, setPrivacyMode] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (user) {
            setDisplayName(user.display_name || user.github_login || '')
            setPrivacyMode(user.privacy_mode)
        }
    }, [user])

    const handleSave = async () => {
        if (!user) return
        setSaving(true)
        setSaveMsg(null)
        try {
            await api.updateProfile({ display_name: displayName, privacy_mode: privacyMode }, user.id)
            setSaveMsg('Changes saved!')
            refetch()
        } catch {
            setSaveMsg('Failed to save.')
        } finally {
            setSaving(false)
            setTimeout(() => setSaveMsg(null), 3000)
        }
    }

    const handleSignOut = () => {
        api.logout()
    }

    const handleDeleteAccount = async () => {
        if (!user) return
        setDeleting(true)
        try {
            await api.deleteAccount(user.id)
            api.clearToken()
            router.push('/')
        } catch {
            alert('Failed to delete account. Please contact support.')
        } finally {
            setDeleting(false)
        }
    }

    const handleCopy = () => {
        if (!user) return
        navigator.clipboard.writeText(`pakalon config --user "${user.id}"`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto p-8 lg:p-12 flex items-center justify-center min-h-64">
                <div className="text-[#b1b4a2]">Loading profile...</div>
            </div>
        )
    }

    const avatarUrl = user?.github_login ? `https://github.com/${user.github_login}.png` : ''

    return (
        <div className="max-w-4xl mx-auto p-8 lg:p-12 space-y-10">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-2">Profile Settings</h2>
                <p className="text-[#b1b4a2]">Manage your personal information and CLI configuration.</p>
            </div>

            <div className="bg-surface-dark border border-border-dark rounded-2xl overflow-hidden p-8 space-y-8">
                <div className="flex flex-col md:flex-row gap-8 items-start">
                    <div className="relative shrink-0 mx-auto md:mx-0">
                        <div className="h-32 w-32 rounded-full overflow-hidden border-4 border-background-dark shadow-xl">
                            {avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-[#4d4f40] flex items-center justify-center">
                                    <span className="material-symbols-outlined text-4xl text-[#b1b4a2]">person</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 w-full space-y-6">
                        <div className="space-y-4">
                            <label className="text-sm font-medium text-gray-300">Display Name</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    className="w-full bg-background-dark border border-border-dark rounded-lg px-4 py-3 text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                />
                                <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-500">
                                    badge
                                </span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-sm font-medium text-gray-300">Email Address</label>
                            <div className="relative">
                                <input
                                    type="email"
                                    value={user?.email || ''}
                                    readOnly
                                    className="w-full bg-surface-hover/50 border border-transparent rounded-lg px-4 py-3 text-gray-400 cursor-not-allowed"
                                />
                                <div className="absolute right-3 top-3.5 flex items-center gap-2">
                                    <span className="text-xs text-gray-500 font-mono">@{user?.github_login}</span>
                                    <span className="material-symbols-outlined text-gray-500">lock</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                CLI Configuration
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-bold uppercase">
                                    Auto-Generated
                                </span>
                            </label>
                            <div
                                onClick={handleCopy}
                                className="bg-black/40 rounded-lg p-3 border border-border-dark font-mono text-sm text-gray-400 flex justify-between items-center group cursor-pointer hover:border-gray-600"
                            >
                                <code>pakalon config --user &quot;{user?.id}&quot;</code>
                                <span className="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors">
                                    {copied ? 'check' : 'content_copy'}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-background-dark rounded-lg border border-border-dark">
                            <div>
                                <p className="text-sm font-medium text-gray-300">Privacy Mode</p>
                                <p className="text-xs text-gray-500 mt-0.5">Prevents telemetry and usage analytics collection</p>
                            </div>
                            <button
                                onClick={() => setPrivacyMode(!privacyMode)}
                                className={`relative w-11 h-6 rounded-full transition-colors ${privacyMode ? 'bg-primary' : 'bg-[#4d4f40]'}`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${privacyMode ? 'left-5' : 'left-0.5'}`} />
                            </button>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="h-12 px-6 rounded-lg bg-primary hover:bg-primary-hover text-background-dark font-bold text-sm flex items-center gap-2 disabled:opacity-70"
                            >
                                <span className="material-symbols-outlined text-[20px]">save</span>
                                {saving ? 'Saving...' : saveMsg ?? 'Save Changes'}
                            </button>
                            <button
                                onClick={handleSignOut}
                                className="h-12 px-6 rounded-lg border border-border-dark hover:border-gray-500 text-gray-300 font-medium text-sm flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined text-[20px]">logout</span>
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border border-red-900/30 bg-red-950/10 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                        <span className="material-symbols-outlined">warning</span>
                        Delete Account
                    </h3>
                    <p className="text-gray-400 text-sm max-w-md">
                        Permanently remove your account and all data. This action cannot be undone.
                    </p>
                </div>
                {deleteConfirm ? (
                    <div className="flex gap-4 items-center">
                        <button
                            onClick={handleDeleteAccount}
                            disabled={deleting}
                            className="shrink-0 h-10 px-5 rounded-lg bg-red-500/20 border border-red-500 text-red-400 hover:bg-red-500/30 transition-colors text-sm font-bold"
                        >
                            {deleting ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                        <button
                            onClick={() => setDeleteConfirm(false)}
                            className="text-sm text-[#b1b4a2] hover:text-white"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setDeleteConfirm(true)}
                        className="shrink-0 h-10 px-5 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors text-sm font-medium"
                    >
                        Delete Account
                    </button>
                )}
            </div>
        </div>
    )
}
