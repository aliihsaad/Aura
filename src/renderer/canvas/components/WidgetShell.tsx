import React, { useRef, useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'

interface WidgetShellProps {
  id: string
  draggable?: boolean
  dismissable?: boolean
  resizable?: boolean
  onDismiss?: (id: string) => void
  onPositionChange?: (id: string, x: number, y: number) => void
  onSizeChange?: (id: string, width: number, height: number) => void
  className?: string
  children: React.ReactNode
  initialPosition?: { x: number; y: number }
}

export default function WidgetShell({
  id,
  draggable = false,
  dismissable = false,
  resizable = false,
  onDismiss,
  onPositionChange,
  onSizeChange,
  className = '',
  children,
  initialPosition,
}: WidgetShellProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(initialPosition ?? { x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!draggable) return
      const target = e.target as HTMLElement
      if (!target.closest('[data-drag-handle]')) return

      e.preventDefault()
      ;(window as any).api?.setCanvasInteractive?.(true)
      setIsDragging(true)
      const rect = shellRef.current?.getBoundingClientRect()
      dragOffset.current = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      }
    },
    [draggable]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      setPosition({ x: newX, y: newY })
      onPositionChange?.(id, newX, newY)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      ;(window as any).api?.setCanvasInteractive?.(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, id, onPositionChange])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return

    const updateRegion = () => {
      const rect = el.getBoundingClientRect()
      ;(window as any).api?.canvasReportRegion?.(id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    updateRegion()
    const observer = new ResizeObserver(updateRegion)
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, position])

  void resizable
  void onSizeChange

  const style: React.CSSProperties = draggable
    ? { position: 'absolute', left: position.x, top: position.y }
    : {}

  return (
    <div
      ref={shellRef}
      className={`${className}`}
      style={style}
      onMouseDown={handleMouseDown}
    >
      {dismissable && (
        <button
          onClick={() => onDismiss?.(id)}
          className="absolute top-1 right-1 p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80 z-10 transition-colors"
        >
          <X size={14} />
        </button>
      )}
      {children}
    </div>
  )
}
