import React, { useState } from 'react'
import { Minus, Plus, GripVertical } from 'lucide-react'
import type { PanelSubtype } from '@shared/types'
import { formatAnswer } from '../../overlay/components/markdown-renderer'

interface PanelProps {
  id: string
  title: string
  content: string
  panelType: PanelSubtype
  fontSize?: number
  onDismiss?: (id: string) => void
}

export default function Panel({ id, title, content, panelType, fontSize: initialFontSize, onDismiss }: PanelProps) {
  const [fontSize, setFontSize] = useState(initialFontSize ?? 18)

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => Math.max(14, Math.min(28, prev + delta)))
  }

  void panelType

  return (
    <div className="flex flex-col bg-black/85 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[400px] min-h-[200px] max-w-[900px] max-h-[80vh]">
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5 shrink-0"
        data-drag-handle
      >
        <GripVertical size={14} className="text-white/30 cursor-grab" />
        <span className="text-white/70 text-sm font-medium flex-1 truncate">{title}</span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => adjustFontSize(-2)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-white/30 text-xs w-6 text-center">{fontSize}</span>
          <button
            onClick={() => adjustFontSize(2)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => onDismiss?.(id)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors ml-1"
          >
            &times;
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-3 text-white/90"
        style={{ fontSize }}
      >
        {formatAnswer(content, fontSize)}
      </div>
    </div>
  )
}
