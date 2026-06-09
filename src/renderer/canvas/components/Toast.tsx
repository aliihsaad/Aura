import React, { useEffect, useState } from 'react'
import { WIDGET_DEFAULTS } from '@shared/constants'

interface ToastProps {
  id: string
  message: string
  ttl?: number
}

export default function Toast({ id, message, ttl }: ToastProps) {
  const [exiting, setExiting] = useState(false)
  const fadeDuration = 300
  const displayDuration = (ttl ?? WIDGET_DEFAULTS.toastTtlMs) - fadeDuration

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), displayDuration)
    return () => clearTimeout(fadeTimer)
  }, [displayDuration])

  void id

  return (
    <div
      className={`px-4 py-2 rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 text-white/90 text-sm shadow-lg ${
        exiting ? 'toast-exit' : 'toast-enter'
      }`}
    >
      {message}
    </div>
  )
}
