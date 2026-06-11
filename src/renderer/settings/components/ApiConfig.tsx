import React, { useState, useEffect } from 'react'
import { AGENT_TOOL_CATALOG } from '@shared/agent-tool-catalog'
import { DEFAULT_FREELLMAPI_BASE_URL } from '@shared/constants'
import { Eye, EyeOff, Check, SlidersHorizontal, Cpu, Shield, ToggleLeft, ToggleRight, Code, ExternalLink, Brain, Radio, Wrench } from 'lucide-react'
import type { AgentToolInfo } from '@shared/types'
import LocalAiSettings from './LocalAiSettings'
import VaultSyncSettings from './VaultSyncSettings'

const inputClass =
  'input-premium w-full rounded-xl bg-white/[0.025] border border-white/6 px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/15 focus:border-blue-500/25 focus:outline-none transition-all font-mono tracking-wide'

export default function ApiConfig() {
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [deepgramKey, setDeepgramKey] = useState('')
  const [freeLlmApiKey, setFreeLlmApiKey] = useState('')
  const [freeLlmApiBaseUrl, setFreeLlmApiBaseUrl] = useState(DEFAULT_FREELLMAPI_BASE_URL)
  const [freeLlmRoutingEnabled, setFreeLlmRoutingEnabled] = useState(true)
  const [relayModels, setRelayModels] = useState<Array<{ id: string; name?: string; ownedBy?: string }>>([])
  const [companionVoiceModel, setCompanionVoiceModel] = useState('aura-2-thalia-en')
  const [companionEngine, setCompanionEngine] = useState<'classic' | 'realtime-beta'>('classic')
  const [companionRealtimeModel, setCompanionRealtimeModel] = useState('auto')
  const [companionRealtimeVoiceName, setCompanionRealtimeVoiceName] = useState('alloy')
  const [companionRealtimeInputTranscription, setCompanionRealtimeInputTranscription] = useState(true)
  const [companionRealtimeOutputTranscription, setCompanionRealtimeOutputTranscription] = useState(true)
  const [liveAgentModel, setLiveAgentModel] = useState('')
  const [liveAgentDisabledTools, setLiveAgentDisabledTools] = useState<string[]>([])
  const [model, setModel] = useState('google/gemini-3-flash-preview')
  const [codingModel, setCodingModel] = useState('')
  const [imageGenerationModel, setImageGenerationModel] = useState('google/gemini-2.5-flash-image')
  const [autoModelSelection, setAutoModelSelection] = useState(false)
  const [overlayOpacity, setOverlayOpacity] = useState(0.92)
  const [fontSize, setFontSize] = useState(14)
  const [bubbleFontSize, setBubbleFontSize] = useState(13)
  const [bubbleWidth, setBubbleWidth] = useState(320)
  const [personality, setPersonality] = useState<'focused' | 'balanced' | 'curious' | 'auto'>('auto')
  const [interruptionPolicy, setInterruptionPolicy] = useState<'silent' | 'ask-first' | 'proactive' | 'auto'>('ask-first')
  const [heartbeatIntervalMs, setHeartbeatIntervalMs] = useState(15000)
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true)
  const [brainEnabled, setBrainEnabled] = useState(true)
  const [brainModel, setBrainModel] = useState('google/gemini-3-flash-preview')
  const [brainVisionModel, setBrainVisionModel] = useState('google/gemini-3-flash-preview')
  const [brainScreenshotIntervalSec, setBrainScreenshotIntervalSec] = useState(45)
  const [agentTools, setAgentTools] = useState<AgentToolInfo[]>([])
  const [saved, setSaved] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  useEffect(() => {
    void loadConfig()
    void loadAgentTools()
  }, [])

  useEffect(() => {
    setAgentTools((prev) =>
      prev.map((tool) => ({
        ...tool,
        enabled: tool.scope === 'live-only' ? !liveAgentDisabledTools.includes(tool.name) : true,
      }))
    )
  }, [liveAgentDisabledTools])

  const loadAgentTools = async () => {
    try {
      const tools = await window.api.getAgentTools()
      if (Array.isArray(tools) && tools.length > 0) {
        setAgentTools(tools)
        return
      }
    } catch {
      // Fall through to shared catalog fallback.
    }
    setAgentTools(
      AGENT_TOOL_CATALOG.map((tool) => ({
        ...tool,
        enabled: tool.scope === 'live-only' ? !liveAgentDisabledTools.includes(tool.name) : true,
      }))
    )
  }

  const loadConfig = async () => {
    const config = await window.api.getConfig()
    if (config) {
      setOpenrouterKey(config.openrouterApiKey || '')
      setDeepgramKey(config.deepgramApiKey || '')
      setFreeLlmApiKey(config.freeLlmApiKey || '')
      setFreeLlmApiBaseUrl(config.freeLlmApiBaseUrl || DEFAULT_FREELLMAPI_BASE_URL)
      setFreeLlmRoutingEnabled(config.freeLlmRoutingEnabled ?? true)
      try {
        const models = await (window.api as any).getRelayModels?.()
        if (Array.isArray(models)) setRelayModels(models)
      } catch {
        // relay offline — the routing falls back to OpenRouter anyway
      }
      setCompanionVoiceModel(config.companionVoiceModel ?? 'aura-2-thalia-en')
      setCompanionEngine((config.companionEngine || 'classic') as 'classic' | 'realtime-beta')
      setCompanionRealtimeModel(config.companionRealtimeModel || 'auto')
      setCompanionRealtimeVoiceName(config.companionRealtimeVoiceName || 'alloy')
      setCompanionRealtimeInputTranscription(config.companionRealtimeInputTranscription ?? true)
      setCompanionRealtimeOutputTranscription(config.companionRealtimeOutputTranscription ?? true)
      setLiveAgentModel(config.liveAgentModel ?? '')
      setLiveAgentDisabledTools(config.liveAgentDisabledTools ?? [])
      setModel(config.defaultModel || 'google/gemini-2.5-flash-preview')
      setCodingModel(config.codingModel || '')
      setImageGenerationModel(config.imageGenerationModel || 'google/gemini-2.5-flash-image')
      setAutoModelSelection(config.autoModelSelection ?? false)
      setOverlayOpacity(config.overlayOpacity ?? 0.92)
      setFontSize(config.fontSize ?? 14)
      setBubbleFontSize(config.bubbleFontSize ?? 13)
      setBubbleWidth(config.bubbleWidth ?? 320)
      setPersonality((config.personality ?? 'auto') as typeof personality)
      setInterruptionPolicy((config.interruptionPolicy ?? 'ask-first') as typeof interruptionPolicy)
      setHeartbeatIntervalMs(config.heartbeatIntervalMs ?? 15000)
      setHeartbeatEnabled(config.heartbeatEnabled ?? true)
      setBrainEnabled(config.brainEnabled ?? true)
      setBrainModel(config.brainModel || 'google/gemini-3-flash-preview')
      setBrainVisionModel(config.brainVisionModel || 'google/gemini-3-flash-preview')
      setBrainScreenshotIntervalSec(Math.round((config.brainScreenshotIntervalMs ?? 45000) / 1000))
    }
  }

  const handleSave = async () => {
    await window.api.setConfig({
      openrouterApiKey: openrouterKey,
      deepgramApiKey: deepgramKey,
      freeLlmApiKey,
      freeLlmApiBaseUrl,
      freeLlmRoutingEnabled,
      defaultModel: model,
      codingModel,
      imageGenerationModel,
      autoModelSelection,
      overlayOpacity,
      fontSize,
      bubbleFontSize,
      bubbleWidth,
      personality,
      interruptionPolicy,
      heartbeatIntervalMs,
      heartbeatEnabled,
      agentMode: 'companion',
      // Keep legacy flags in sync so existing code paths see consistent state:
      liveAgentEnabled: true,
      companionVoiceModel,
      companionEngine,
      companionRealtimeModel,
      companionRealtimeVoiceName,
      companionRealtimeInputTranscription,
      companionRealtimeOutputTranscription,
      liveAgentModel,
      liveAgentDisabledTools,
      brainEnabled,
      brainModel,
      brainVisionModel,
      brainScreenshotIntervalMs: Math.max(10, Math.min(120, brainScreenshotIntervalSec)) * 1000,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Verified against the live OpenRouter catalog 2026-06-11 — also served by
  // the LLM-Hub relay where ids overlap (e.g. the :free OpenRouter models).
  const models = [
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B', cost: 'Free', tier: 'free', codingRec: false, vision: true },
    { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder', cost: 'Free', tier: 'free', codingRec: 'Free coding', vision: false },
    { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', cost: 'Cheap & fast', tier: 'budget', codingRec: false, vision: true },
    { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', cost: 'Newest flash', tier: 'budget', codingRec: false, vision: true },
    { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', cost: 'Cheapest', tier: 'budget', codingRec: false, vision: true },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', cost: 'Budget', tier: 'budget', codingRec: 'Best value', vision: false },
    { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', cost: 'Mid-tier', tier: 'mid', codingRec: 'Strong', vision: true },
    { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: 'Mid-tier', tier: 'mid', codingRec: false, vision: true },
    { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', cost: 'Premium', tier: 'premium', codingRec: 'Top tier', vision: true },
  ]

  const imageModels = [
    { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', note: 'Default, low cost' },
    { id: 'google/gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image Preview', note: 'Newer preview' },
    { id: 'google/gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image', note: 'Higher quality' },
    { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini', note: 'OpenAI, mid cost' },
  ]

  const tierColors: Record<string, string> = {
    free: 'text-violet-400/70',
    budget: 'text-emerald-400/50',
    mid: 'text-amber-400/50',
    premium: 'text-blue-400/50',
  }
  const coreTools = agentTools.filter((tool) => tool.scope === 'core')
  const liveOnlyTools = agentTools.filter((tool) => tool.scope === 'live-only')
  const toggleLiveTool = (toolName: string) => {
    setLiveAgentDisabledTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((name) => name !== toolName)
        : [...prev, toolName]
    )
    setAgentTools((prev) =>
      prev.map((tool) =>
        tool.name === toolName
          ? { ...tool, enabled: !(tool.enabled ?? true) }
          : tool
      )
    )
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-[30px] font-light text-white/95 tracking-[-0.02em]">Settings</h2>
        <p className="text-[13px] text-white/35 mt-1">
          API keys, model selection, and overlay preferences.
        </p>
      </div>

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-white/25" />
            <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
              API Keys
            </h3>
          </div>
          <button
            onClick={() => setShowKeys(!showKeys)}
            className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/55 transition-colors rounded-lg px-2 py-1 hover:bg-white/3"
          >
            {showKeys ? <EyeOff size={12} /> : <Eye size={12} />}
            {showKeys ? 'Hide' : 'Reveal'}
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              OpenRouter
            </label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              placeholder="sk-or-..."
              className={inputClass}
            />
            <button
              onClick={() => window.api.openExternal('https://openrouter.ai/keys')}
              className="flex items-center gap-1 mt-1.5 text-[10.5px] text-white/25 hover:text-blue-400/60 transition-colors"
            >
              <ExternalLink size={10} />
              Get your free API key at openrouter.ai/keys
            </button>
          </div>

          <div>
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              Deepgram
            </label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={deepgramKey}
              onChange={(e) => setDeepgramKey(e.target.value)}
              placeholder="your-deepgram-key..."
              className={inputClass}
            />
            <button
              onClick={() => window.api.openExternal('https://console.deepgram.com')}
              className="flex items-center gap-1 mt-1.5 text-[10.5px] text-white/25 hover:text-blue-400/60 transition-colors"
            >
              <ExternalLink size={10} />
              Get your free API key at console.deepgram.com
            </button>
          </div>

          <div className="border-t border-white/4 pt-5">
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              FreeLLMAPI Realtime Beta base URL
            </label>
            <input
              type="text"
              value={freeLlmApiBaseUrl}
              onChange={(e) => setFreeLlmApiBaseUrl(e.target.value)}
              placeholder={DEFAULT_FREELLMAPI_BASE_URL}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              FreeLLMAPI Realtime Beta key
            </label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={freeLlmApiKey}
              onChange={(e) => setFreeLlmApiKey(e.target.value)}
              placeholder="freellmapi-..."
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12.5px] text-white/60">Prefer LLM-Hub for reasoning &amp; vision</div>
              <div className="text-[11px] text-white/30 mt-0.5">
                Screen analysis and background reasoning go to the hub first, which auto-routes to
                the best available free model; OpenRouter is the automatic fallback. Tool-driven
                answers and image generation always use OpenRouter with your selected models.
                {relayModels.length > 0 && (
                  <span className="text-emerald-400/50"> {relayModels.length} model(s) routable now.</span>
                )}
              </div>
            </div>
            <button
              onClick={() => setFreeLlmRoutingEnabled(!freeLlmRoutingEnabled)}
              className="shrink-0 text-white/60 hover:text-white/80 transition-colors"
            >
              {freeLlmRoutingEnabled ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} />}
            </button>
          </div>

          {freeLlmRoutingEnabled && relayModels.length > 0 && (
            <div className="rounded-xl bg-white/[0.015] border border-white/[0.045] px-3 py-2.5 max-h-36 overflow-y-auto">
              <div className="text-[10.5px] font-semibold text-white/35 uppercase tracking-wider mb-1.5">
                Relay models available now
              </div>
              {relayModels.map((m) => (
                <div key={m.id} className="flex items-baseline gap-2 py-0.5">
                  <span className="text-[11px] font-mono text-white/50 truncate">{m.id}</span>
                  {m.ownedBy && <span className="text-[10px] text-white/25 shrink-0">{m.ownedBy}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-blue-400/10 bg-blue-400/2.5 px-3 py-3 text-[11px] leading-relaxed text-blue-100/35">
            Deepgram handles speech-to-text and Classic Companion voice. LLM-Hub (FreeLLMAPI) powers
            the Realtime Beta engine and, when the toggle above is on, serves reasoning and vision
            calls first — OpenRouter is the always-on fallback.
          </div>
        </div>
      </div>

      <LocalAiSettings />

      {/* Model Selection */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            LLM Model
          </h3>
        </div>
        <div className="rounded-2xl border border-white/4.5 overflow-hidden">
          {models.map((m, i) => {
            const isSelected = model === m.id
            return (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`w-full flex items-center justify-between px-4 py-3 cursor-pointer transition-all duration-150 text-left ${
                  i < models.length - 1 ? 'border-b border-white/[0.035]' : ''
                } ${
                  isSelected
                    ? 'bg-blue-500/6'
                    : 'bg-transparent hover:bg-white/2.5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      isSelected
                        ? 'border-blue-400 bg-blue-400/10'
                        : 'border-white/15'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    )}
                  </div>
                  <span className={`text-[13px] font-medium ${isSelected ? 'text-white/90' : 'text-white/60'}`}>
                    {m.name}
                  </span>
                  {m.tier === 'free' && (
                    <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400/80 uppercase tracking-wider">
                      Free
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {m.vision && (
                    <span title="Supports screen analysis"><Eye size={11} className="text-white/20" /></span>
                  )}
                  <span className={`text-[10.5px] font-medium ${tierColors[m.tier]}`}>
                    {m.cost}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-white/25 mt-2">
          <span className="flex items-center gap-1">
            <Eye size={10} /> = supports screen analysis
          </span>
          <span className="flex items-center gap-1">
            <span className="rounded-md bg-violet-500/10 px-1 py-0.5 text-[8px] font-semibold text-violet-400/80">FREE</span>
            = rate-limited, best for testing
          </span>
        </div>
      </div>

      {/* Image Model Selection */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Eye size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Image Generation
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-4">
          <div>
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              OpenRouter Image Model
            </label>
            <select
              value={imageGenerationModel}
              onChange={(e) => setImageGenerationModel(e.target.value)}
              className={inputClass}
            >
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} - {m.note}
                </option>
              ))}
            </select>
            <button
              onClick={() => window.api.openExternal('https://openrouter.ai/models?output_modalities=image')}
              className="flex items-center gap-1 mt-1.5 text-[10.5px] text-white/25 hover:text-blue-400/60 transition-colors"
            >
              <ExternalLink size={10} />
              Browse image-capable models on OpenRouter
            </button>
          </div>
          <div className="text-[11px] leading-relaxed text-white/30">
            The image tool requests image output through OpenRouter chat completions and stores the
            returned image as a Aura artifact.
          </div>
        </div>
      </div>

      {/* Auto Model Selection */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Code size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Smart Model Routing
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12.5px] text-white/60">Auto Model Selection</div>
              <div className="text-[11px] text-white/30 mt-0.5">
                Route coding questions to a specialized model
              </div>
            </div>
            <button
              onClick={() => setAutoModelSelection(!autoModelSelection)}
              className="text-white/60 hover:text-white/80 transition-colors"
            >
              {autoModelSelection ? (
                <ToggleRight size={28} className="text-blue-400" />
              ) : (
                <ToggleLeft size={28} />
              )}
            </button>
          </div>

          {/* Coding Model Picker */}
          {autoModelSelection && (
            <div className="border-t border-white/4 pt-5">
              <label className="block text-[11.5px] font-medium text-white/40 mb-3 uppercase tracking-wider">
                Coding Model
              </label>
              <div className="rounded-xl border border-white/4.5 overflow-hidden">
                {models.map((m, i) => {
                  const isSelected = codingModel === m.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => setCodingModel(m.id)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 cursor-pointer transition-all duration-150 text-left ${
                        i < models.length - 1 ? 'border-b border-white/[0.035]' : ''
                      } ${
                        isSelected
                          ? 'bg-emerald-500/6'
                          : 'bg-transparent hover:bg-white/2.5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-400/10'
                              : 'border-white/15'
                          }`}
                        >
                          {isSelected && (
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          )}
                        </div>
                        <span className={`text-[12.5px] font-medium ${isSelected ? 'text-white/90' : 'text-white/55'}`}>
                          {m.name}
                        </span>
                        {m.codingRec && (
                          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400/70 uppercase tracking-wider">
                            {m.codingRec}
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] font-medium ${tierColors[m.tier]}`}>
                        {m.cost}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10.5px] text-white/25 mt-2.5">
                Used for: screen analysis and coding-related questions
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Session Brain */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Brain size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Session Brain
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12.5px] text-white/60">Enable session brain</div>
              <div className="text-[11px] text-white/30 mt-0.5">
                Background loop that maintains a structured summary and rates screenshots for relevance
                during a live session. Surfaces grounded subject + summary tail in every answer.
              </div>
            </div>
            <button
              onClick={() => setBrainEnabled(!brainEnabled)}
              className="text-white/60 hover:text-white/80 transition-colors"
            >
              {brainEnabled ? (
                <ToggleRight size={28} className="text-blue-400" />
              ) : (
                <ToggleLeft size={28} />
              )}
            </button>
          </div>

          {brainEnabled && (
            <div className="border-t border-white/4 pt-5 space-y-4">
              <div>
                <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
                  Brain Text Model
                </label>
                <select
                  value={brainModel}
                  onChange={(e) => setBrainModel(e.target.value)}
                  className={inputClass}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.cost}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-white/25 mt-1.5">
                  Used for the periodic summary delta. Pick a cheap, fast model.
                </p>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
                  Brain Vision Model
                </label>
                <select
                  value={brainVisionModel}
                  onChange={(e) => setBrainVisionModel(e.target.value)}
                  className={inputClass}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.cost}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-white/25 mt-1.5">
                  Used to rate background screenshots. Must be multimodal.
                </p>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
                  Screenshot Interval (seconds)
                </label>
                <input
                  type="number"
                  min={10}
                  max={120}
                  value={brainScreenshotIntervalSec}
                  onChange={(e) => setBrainScreenshotIntervalSec(Number(e.target.value) || 45)}
                  className={inputClass}
                />
                <p className="text-[10.5px] text-white/25 mt-1.5">
                  How often the brain checks the screen. 10–120 seconds.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Memory & Sync — Vault MCP connections */}
      <VaultSyncSettings />

      {/* Agent Behavior */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Brain size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Agent Behavior
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-5">
          {/* Personality */}
          <div className="border-t border-white/4 pt-5">
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              Personality
            </label>
            <select
              value={personality}
              onChange={(e) => setPersonality(e.target.value as typeof personality)}
              className="w-full rounded-xl bg-[#0a0a0f] border border-white/6 px-4 py-2.5 pr-10 text-[13px] text-white/80 focus:border-blue-500/25 focus:outline-none transition-all appearance-none cursor-pointer bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22rgba(255,255,255,0.4)%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-position-[right_0.9rem_center] bg-no-repeat"
            >
              <option value="auto" className="bg-[#0a0a0f] text-white/85">Auto — adapt to context</option>
              <option value="focused" className="bg-[#0a0a0f] text-white/85">Focused — minimal interruptions</option>
              <option value="balanced" className="bg-[#0a0a0f] text-white/85">Balanced — default</option>
              <option value="curious" className="bg-[#0a0a0f] text-white/85">Curious — more proactive</option>
            </select>
          </div>

          {/* Interruption Policy */}
          <div className="border-t border-white/4 pt-5">
            <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
              Interruption Policy
            </label>
            <select
              value={interruptionPolicy}
              onChange={(e) => setInterruptionPolicy(e.target.value as typeof interruptionPolicy)}
              className="w-full rounded-xl bg-[#0a0a0f] border border-white/6 px-4 py-2.5 pr-10 text-[13px] text-white/80 focus:border-blue-500/25 focus:outline-none transition-all appearance-none cursor-pointer bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22rgba(255,255,255,0.4)%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-position-[right_0.9rem_center] bg-no-repeat"
            >
              <option value="auto" className="bg-[#0a0a0f] text-white/85">Auto — follow personality</option>
              <option value="silent" className="bg-[#0a0a0f] text-white/85">Silent — never interrupt</option>
              <option value="ask-first" className="bg-[#0a0a0f] text-white/85">Ask first — confirm before acting</option>
              <option value="proactive" className="bg-[#0a0a0f] text-white/85">Proactive — act when confident</option>
            </select>
          </div>

          {/* Heartbeat Interval */}
          <div className="border-t border-white/4 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12.5px] text-white/50">Heartbeat Interval</label>
              <span className="text-[12px] font-mono text-blue-400/70 bg-blue-400/6 rounded-md px-2 py-0.5">
                {(heartbeatIntervalMs / 1000).toFixed(0)}s
              </span>
            </div>
            <input
              type="range"
              min="10000"
              max="30000"
              step="1000"
              value={heartbeatIntervalMs}
              onChange={(e) => setHeartbeatIntervalMs(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-[10.5px] text-white/25 mt-2">
              How often the agent reviews context during a session
            </p>
          </div>

          {/* Bubble Font Size */}
          <div className="border-t border-white/4 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12.5px] text-white/50">Bubble Font Size</label>
              <span className="text-[12px] font-mono text-blue-400/70 bg-blue-400/6 rounded-md px-2 py-0.5">
                {bubbleFontSize}px
              </span>
            </div>
            <input
              type="range"
              min="11"
              max="22"
              step="1"
              value={bubbleFontSize}
              onChange={(e) => setBubbleFontSize(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Bubble Width */}
          <div className="border-t border-white/4 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12.5px] text-white/50">Bubble Width</label>
              <span className="text-[12px] font-mono text-blue-400/70 bg-blue-400/6 rounded-md px-2 py-0.5">
                {bubbleWidth}px
              </span>
            </div>
            <input
              type="range"
              min="240"
              max="560"
              step="20"
              value={bubbleWidth}
              onChange={(e) => setBubbleWidth(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-[10.5px] text-white/25 mt-2">
              Applies live to existing and new bubbles
            </p>
          </div>
        </div>
      </div>

      {/* Mode */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Radio size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Mode
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-4">
          {!openrouterKey && (
            <div className="text-[11.5px] text-amber-300/80 px-1">
              Set an OpenRouter API key above to use Companion mode.
            </div>
          )}

          {(
            <div className="space-y-4">
              <div>
                <label className="text-[12.5px] text-white/50 block mb-2">Companion engine</label>
                <select
                  value={companionEngine}
                  onChange={(e) => setCompanionEngine(e.target.value as 'classic' | 'realtime-beta')}
                  className={inputClass}
                >
                  <option value="classic">Classic</option>
                  <option value="realtime-beta">Realtime Beta</option>
                </select>
              </div>

              {companionEngine === 'realtime-beta' && (
                <div>
                  <label className="text-[12.5px] text-white/50 block mb-2">Realtime model</label>
                  <select
                    value={companionRealtimeModel}
                    onChange={(e) => setCompanionRealtimeModel(e.target.value)}
                    className={inputClass}
                  >
                    <option value="auto">Auto — hub picks (2.5 native audio)</option>
                    <option value="gemini-2.5-flash-native-audio-preview-12-2025">
                      Gemini 2.5 Flash Native Audio — verified stable
                    </option>
                    <option value="gemini-3.1-flash-live-preview">
                      Gemini 3.1 Flash Live — newest, preview
                    </option>
                  </select>
                  <p className="text-[10px] text-white/25 mt-1.5">
                    Served through LLM-Hub. 3.1 Flash Live uses a newer audio protocol — Aura switches
                    the mic format automatically.
                  </p>
                </div>
              )}

              <div>
                <label className="text-[12.5px] text-white/50 block mb-2">Voice model</label>
                <select
                  value={companionVoiceModel}
                  onChange={(e) => setCompanionVoiceModel(e.target.value)}
                  className={inputClass}
                >
                  <option value="aura-2-thalia-en">Aura Thalia (warm, clear)</option>
                  <option value="aura-2-asteria-en">Aura Asteria (natural, bright)</option>
                  <option value="aura-2-arcas-en">Aura Arcas (steady, direct)</option>
                  <option value="aura-2-orpheus-en">Aura Orpheus (deep, grounded)</option>
                  <option value="aura-2-athena-en">Aura Athena (calm, professional)</option>
                </select>
                <p className="text-[10px] text-white/25 mt-1.5">
                  Used only when Companion voice is enabled and Local AI voice output is set to Deepgram.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Agent Tools */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wrench size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Agent Tools
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-5">
          <div className="text-[11px] text-white/30 leading-relaxed">
            These are the functions the agent can call internally. Core tools run in the main
            answer pipeline; companion and proactive modes delegate tool-heavy requests there.
            Companion tools are available when Companion mode is active.
          </div>

          {[
            { label: 'Core', tools: coreTools, accent: 'text-blue-300/80', badge: 'Answer pipeline' },
            { label: 'Companion', tools: liveOnlyTools, accent: 'text-emerald-300/80', badge: 'Companion mode' },
          ].map((group) => (
            <div key={group.label} className="border-t border-white/4 pt-5 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between mb-3">
                <div className={`text-[12.5px] font-medium ${group.accent}`}>{group.label}</div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-white/4 px-2 py-0.5 text-[10px] font-mono text-white/45">
                    {group.tools.length} tools
                  </span>
                  <span className="text-[10.5px] text-white/25">{group.badge}</span>
                </div>
              </div>

              <div className="space-y-2">
                {group.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-xl border border-white/5 bg-black/20 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-[11.5px] font-mono text-white/78">{tool.name}</div>
                          {tool.locked && (
                            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-white/34">
                          {tool.description}
                        </div>
                      </div>
                      {tool.scope === 'live-only' ? (
                        <button
                          onClick={() => toggleLiveTool(tool.name)}
                          className="shrink-0 text-white/60 hover:text-white/80 transition-colors"
                          title={tool.enabled === false ? 'Enable tool' : 'Disable tool'}
                        >
                          {tool.enabled === false ? (
                            <ToggleLeft size={26} className="text-white/28" />
                          ) : (
                            <ToggleRight size={26} className="text-blue-400" />
                          )}
                        </button>
                      ) : (
                        <div className="shrink-0 rounded-md bg-white/4 px-2 py-1 text-[10px] font-medium text-white/28">
                          Required
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {group.tools.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/6 px-3 py-4 text-[11px] text-white/25">
                    No tools registered in this group.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Overlay Settings */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal size={14} className="text-white/25" />
          <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
            Overlay
          </h3>
        </div>

        <div className="glass-card rounded-2xl p-7 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12.5px] text-white/50">Opacity</label>
              <span className="text-[12px] font-mono text-blue-400/70 bg-blue-400/6 rounded-md px-2 py-0.5">
                {Math.round(overlayOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.01"
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="border-t border-white/4 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12.5px] text-white/50">Font Size</label>
              <span className="text-[12px] font-mono text-blue-400/70 bg-blue-400/6 rounded-md px-2 py-0.5">
                {fontSize}px
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="20"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className={`w-full rounded-xl py-3.5 text-[13px] font-semibold transition-all duration-250 flex items-center justify-center gap-2 btn-press ${
          saved
            ? 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.08)]'
            : 'bg-blue-500/10 text-blue-400 border border-blue-500/15 hover:bg-blue-500/15 hover:border-blue-500/25 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)]'
        }`}
      >
        {saved ? (
          <>
            <Check size={14} />
            Saved
          </>
        ) : (
          'Save Settings'
        )}
      </button>
    </div>
  )
}
