import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentPresenceState, Widget } from '@shared/types'
import WidgetShell from './components/WidgetShell'
import Toast from './components/Toast'
import GlassReplyPanel from './components/GlassReplyPanel'
import Panel from './components/Panel'
import OrbPresence from './components/OrbPresence'
import { VoiceAudioPlayer } from './voice-audio-player'

export default function App() {
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [presenceState, setPresenceState] = useState<AgentPresenceState>('sleeping')
  const [bubbleStyle, setBubbleStyle] = useState<{ fontSize: number; width: number }>({
    fontSize: 13,
    width: 320,
  })
  const mouseOverWidgetRef = useRef(false)

  useEffect(() => {
    const cleanup = window.api?.onWidgetState?.((newWidgets: Widget[]) => {
      setWidgets(newWidgets)
    })
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    const cleanup = window.api?.onPresenceState?.((state: AgentPresenceState) => {
      setPresenceState(state)
    })
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    void window.api?.getConfig?.().then((config: any) => {
      if (!config) return
      setBubbleStyle({
        fontSize: config.bubbleFontSize ?? 13,
        width: config.bubbleWidth ?? 320,
      })
    })
    const cleanup = window.api?.onBubbleStyle?.((style) => setBubbleStyle(style))
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    const player = new VoiceAudioPlayer((active) => {
      window.api?.setVoicePlaybackState?.(active)
    })
    const offChunk = window.api?.onVoiceAudioChunk?.(({ pcmBase64, mimeType }) => {
      try {
        player.enqueue(pcmBase64, mimeType)
      } catch (err) {
        console.error('[Canvas] audio enqueue failed:', err)
      }
    })
    const offEnd = window.api?.onVoiceAudioEnd?.(() => player.endTurn())
    const offInterrupt = window.api?.onVoiceInterrupt?.(() => player.interrupt())
    return () => {
      offChunk?.()
      offEnd?.()
      offInterrupt?.()
      player.stop()
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const elements = document.elementsFromPoint(e.clientX, e.clientY)
      const overWidget = elements.some(
        (el) => (el as HTMLElement).closest?.('[data-widget]') !== null
      )

      if (overWidget && !mouseOverWidgetRef.current) {
        mouseOverWidgetRef.current = true
        window.api?.setCanvasInteractive?.(true)
      } else if (!overWidget && mouseOverWidgetRef.current) {
        mouseOverWidgetRef.current = false
        window.api?.setCanvasInteractive?.(false)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleDismiss = useCallback((id: string) => {
    window.api?.dismissWidget?.(id)
  }, [])

  const handleBubbleExpand = useCallback((id: string) => {
    window.api?.expandBubble?.(id)
  }, [])

  const handleBubbleFeedback = useCallback(
    (id: string, sentiment: 'up' | 'down', text: string) => {
      void window.api?.bubbleFeedback?.({ bubbleId: id, sentiment, text })
    },
    []
  )

  const handleWidgetPositionChange = useCallback((id: string, x: number, y: number) => {
    window.api?.canvasUpdateWidgetPosition?.(id, { x, y })
  }, [])

  const toasts = widgets.filter((w) => w.type === 'toast')
  const bubbles = widgets.filter((w) => w.type === 'bubble')
  const panels = widgets.filter((w) => w.type === 'panel')

  return (
    <div className="relative w-full h-full pointer-events-none">
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 flex flex-col gap-2 z-50 pointer-events-auto"
          data-widget
        >
          {toasts.map((w) => (
            <Toast
              key={w.id}
              id={w.id}
              message={String(w.props.message ?? '')}
              ttl={w.ttl ?? undefined}
            />
          ))}
        </div>
      )}

      {bubbles.map((w, idx) => {
        const hasStoredPos = w.position.x !== 0 || w.position.y !== 0
        const initialPosition = hasStoredPos
          ? w.position
          : { x: 20, y: 112 + idx * 72 }
        return (
          <WidgetShell
            key={w.id}
            id={w.id}
            draggable
            initialPosition={initialPosition}
            onPositionChange={handleWidgetPositionChange}
            className="pointer-events-auto z-40"
          >
            <div data-widget>
              <GlassReplyPanel
                id={w.id}
                message={String(w.props.message ?? '')}
                urgency={(w.props.urgency as any) ?? 'low'}
                expandable={Boolean(w.props.expandable)}
                fontSize={bubbleStyle.fontSize}
                width={bubbleStyle.width}
                streaming={Boolean(w.props.streaming)}
                onExpand={handleBubbleExpand}
                onDismiss={handleDismiss}
                onFeedback={handleBubbleFeedback}
              />
            </div>
          </WidgetShell>
        )
      })}

      {panels.map((w) => (
        <WidgetShell
          key={w.id}
          id={w.id}
          draggable
          dismissable={w.dismissable}
          onDismiss={handleDismiss}
          onPositionChange={handleWidgetPositionChange}
          initialPosition={w.position.x === 0 && w.position.y === 0
            ? { x: Math.round(window.innerWidth * 0.25), y: Math.round(window.innerHeight * 0.1) }
            : w.position
          }
          className="pointer-events-auto z-30"
        >
          <div data-widget>
            <Panel
              id={w.id}
              title={String(w.props.title ?? 'Panel')}
              content={String(w.props.content ?? '')}
              panelType={(w.props.panelType as any) ?? 'context'}
              fontSize={w.props.fontSize as number | undefined}
              onDismiss={handleDismiss}
            />
          </div>
        </WidgetShell>
      ))}

      {/* Aura's ambient orb presence — always on the canvas, draggable. */}
      <WidgetShell
        id="aura-orb"
        draggable
        initialPosition={{
          x: Math.max(24, window.innerWidth - 190),
          y: Math.max(24, window.innerHeight - 220),
        }}
        className="pointer-events-auto z-20"
      >
        <div data-widget data-drag-handle className="cursor-grab active:cursor-grabbing">
          <OrbPresence state={presenceState} />
        </div>
      </WidgetShell>
    </div>
  )
}
