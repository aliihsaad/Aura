import React, { useEffect, useState } from 'react'
import { Cpu, Download, Shield, ToggleLeft, ToggleRight } from 'lucide-react'
import type {
  LocalAiConfig,
  LocalAiInstallProgress,
  LocalAiProviderStatus,
  LocalAiStatus,
  SttProviderId,
  TtsProviderId,
} from '@shared/local-ai-types'

type ActionResult = { reason?: string; message?: string }

const sttProviders: Array<{ value: SttProviderId; label: string }> = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'whisper-local', label: 'Whisper local' },
]

const ttsProviders: Array<{ value: TtsProviderId; label: string }> = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'system', label: 'System voice' },
  { value: 'disabled', label: 'Disabled' },
]

function statusTone(availability: LocalAiProviderStatus['availability']): string {
  switch (availability) {
    case 'available':
      return 'border-emerald-400/18 bg-emerald-400/7 text-emerald-300/80'
    case 'installable':
      return 'border-blue-400/18 bg-blue-400/7 text-blue-300/80'
    case 'failed':
      return 'border-red-400/18 bg-red-400/7 text-red-300/80'
    default:
      return 'border-white/8 bg-white/4 text-white/35'
  }
}

function testTone(success: boolean | undefined): string {
  if (success === true) return 'border-emerald-400/18 bg-emerald-400/7 text-emerald-300/80'
  if (success === false) return 'border-red-400/18 bg-red-400/7 text-red-300/80'
  return 'border-white/8 bg-white/4 text-white/35'
}

function formatLastTest(provider: LocalAiProviderStatus): string {
  if (!provider.lastTestAt) return ''
  const time = new Date(provider.lastTestAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Test ${provider.lastTestSuccess ? 'passed' : 'failed'} ${time}`
}

function WhisperRow({
  provider,
  installProgress,
  canInstall,
  canRemove,
  onInstall,
  onRemove,
}: {
  provider: LocalAiProviderStatus
  installProgress: Record<string, LocalAiInstallProgress>
  canInstall: boolean
  canRemove: boolean
  onInstall: (id: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const installed = provider.installState === 'installed'
  const installable = provider.availability === 'installable'
  const repairable = installed && provider.availability === 'failed' && canInstall
  const progress = installProgress[provider.id]
  const installing = progress && progress.phase !== 'installed' && progress.phase !== 'failed'
  const percent = progress?.totalBytes
    ? Math.max(0, Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)))
    : undefined

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/18 px-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[12.5px] font-medium text-white/68">{provider.label}</div>
          <span className={`rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${statusTone(provider.availability)}`}>
            {provider.availability}
          </span>
          {provider.lastTestAt !== undefined && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${testTone(provider.lastTestSuccess)}`}>
              {provider.lastTestSuccess ? 'test ok' : 'test failed'}
            </span>
          )}
        </div>
        <div className="mt-1 text-[10.5px] leading-relaxed text-white/30">
          {progress
            ? `${progress.phase}${percent !== undefined ? ` ${percent}%` : ''}${progress.file ? ` · ${progress.file}` : ''}${progress.error ? ` · ${progress.error}` : ''}`
            : [
                formatLastTest(provider),
                provider.lastError,
                !provider.lastError && !provider.lastTestAt
                  ? (provider.estimatedRequiredGb ? `${provider.estimatedRequiredGb}GB estimated` : provider.installState)
                  : '',
              ].filter(Boolean).join(' · ')}
        </div>
      </div>

      <button
        type="button"
        disabled={Boolean(installing) || (installed ? (!repairable && !canRemove) : (!canInstall || !installable))}
        onClick={() => repairable ? onInstall(provider.id) : installed ? onRemove(provider.id) : onInstall(provider.id)}
        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10.5px] font-medium transition-colors ${
          repairable || (installed && canRemove) || (canInstall && installable)
            ? 'border-blue-400/15 bg-blue-400/6 text-blue-300/75 hover:bg-blue-400/10'
            : 'border-white/5 bg-white/3 text-white/22'
        }`}
      >
        {installing ? 'Installing' : repairable ? 'Repair' : installed ? 'Remove' : 'Install'}
      </button>
    </div>
  )
}

export default function LocalAiSettings(): React.JSX.Element {
  const [status, setStatus] = useState<LocalAiStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [installProgress, setInstallProgress] = useState<Record<string, LocalAiInstallProgress>>({})

  const config = status?.config
  const whisperProvider = status?.providers.find((provider) => provider.id === 'whisper-local')

  const loadStatus = async (): Promise<void> => {
    const next = await window.api.getLocalAiStatus()
    setStatus(next)
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  useEffect(() => {
    return window.api.onLocalAiInstallProgress((progress) => {
      setInstallProgress((current) => ({
        ...current,
        [progress.provider]: progress,
      }))
      if (progress.phase === 'installed' || progress.phase === 'failed') {
        void loadStatus()
      }
    })
  }, [])

  const updateConfig = async (patch: Partial<LocalAiConfig>): Promise<void> => {
    if (!config) return
    setPending(true)
    setNotice('')
    try {
      await window.api.setLocalAiConfig({ ...config, ...patch })
      await loadStatus()
    } catch (error: any) {
      setNotice(error?.message || 'Could not save Local AI settings')
    } finally {
      setPending(false)
    }
  }

  const installModel = async (providerId: string): Promise<void> => {
    setPending(true)
    setNotice('')
    setInstallProgress((current) => {
      const next = { ...current }
      delete next[providerId]
      return next
    })
    try {
      const result: ActionResult = await window.api.installLocalAiModel(providerId)
      setNotice(result.message || result.reason || 'Model action queued')
      await loadStatus()
    } catch (error: any) {
      setNotice(error?.message || 'Model install failed')
    } finally {
      setPending(false)
    }
  }

  const removeModel = async (providerId: string): Promise<void> => {
    setPending(true)
    setNotice('')
    try {
      const result: ActionResult = await window.api.removeLocalAiModel(providerId)
      setNotice(result.message || result.reason || 'Model removed')
      await loadStatus()
    } catch (error: any) {
      setNotice(error?.message || 'Model removal failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Cpu size={14} className="text-white/25" />
        <h3 className="text-[12px] font-semibold text-white/50 uppercase">
          Local AI
        </h3>
      </div>

      <div className="glass-card rounded-2xl p-7 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield size={13} className="text-blue-300/45" />
            <div>
              <div className="text-[12.5px] text-white/66">Machine tier</div>
              <div className="text-[10.5px] text-white/30">
                {status
                  ? `${status.hardware.capabilityTier} · ${status.hardware.totalMemoryGb}GB RAM`
                  : 'Checking'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-lg border border-white/6 bg-white/3 px-2.5 py-1.5 text-[10.5px] text-white/45 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-white/4 pt-5">
          <div>
            <label className="block text-[11px] font-medium text-white/38 mb-2 uppercase">
              Speech Input
            </label>
            <select
              value={config?.sttProvider ?? 'deepgram'}
              disabled={!config || pending}
              onChange={(e) => void updateConfig({ sttProvider: e.target.value as SttProviderId })}
              className="input-premium w-full rounded-xl bg-white/[0.025] border border-white/6 px-3 py-2.5 text-[12.5px] text-white/75 focus:border-blue-500/25 focus:outline-none transition-all disabled:opacity-45"
            >
              {sttProviders.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-white/38 mb-2 uppercase">
              Speech Output
            </label>
            <select
              value={config?.ttsProvider ?? 'deepgram'}
              disabled={!config || pending}
              onChange={(e) => void updateConfig({ ttsProvider: e.target.value as TtsProviderId })}
              className="input-premium w-full rounded-xl bg-white/[0.025] border border-white/6 px-3 py-2.5 text-[12.5px] text-white/75 focus:border-blue-500/25 focus:outline-none transition-all disabled:opacity-45"
            >
              {ttsProviders.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={!config || pending}
            onClick={() => void updateConfig({ allowModelDownloads: !config?.allowModelDownloads })}
            className="flex items-center justify-between self-end rounded-xl border border-white/5 bg-black/18 px-3 py-3 text-left transition-colors hover:bg-white/3 disabled:opacity-45"
          >
            <span className="flex items-center gap-2 text-[12px] text-white/58">
              <Download size={13} className="text-white/24" />
              Model downloads
            </span>
            {config?.allowModelDownloads ? (
              <ToggleRight size={25} className="text-blue-400" />
            ) : (
              <ToggleLeft size={25} className="text-white/28" />
            )}
          </button>
        </div>

        {whisperProvider && (
          <div className="border-t border-white/4 pt-5">
            <WhisperRow
              provider={whisperProvider}
              installProgress={installProgress}
              canInstall={Boolean(config?.allowModelDownloads) && !pending}
              canRemove={!pending}
              onInstall={installModel}
              onRemove={removeModel}
            />
          </div>
        )}

        {notice && (
          <div className="border-t border-white/4 pt-4 text-[10.5px] text-white/35">
            {notice}
          </div>
        )}
      </div>
    </div>
  )
}
