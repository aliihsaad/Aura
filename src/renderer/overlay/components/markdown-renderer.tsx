import React from 'react'
import RichContent from './RichContent'

interface MarkdownRendererProps {
  content?: string
  text?: string
  fontSize?: number
}

// Back-compat shim for older call sites that imported the hand-rolled
// markdown renderer. Compact mode keeps small surfaces from growing images,
// tables, or future attachment cards.
export default function MarkdownRenderer(props: MarkdownRendererProps): React.JSX.Element {
  return (
    <RichContent
      compact
      content={props.content ?? props.text ?? ''}
      fontSize={props.fontSize}
    />
  )
}

export function formatAnswer(
  text: string,
  baseFontSize: number,
  emptyMessage = 'Waiting for an answer...',
  compact = false
): React.JSX.Element {
  if (!text.trim()) {
    return <p className="text-white/25 leading-relaxed">{emptyMessage}</p>
  }

  return <RichContent compact={compact} content={text} fontSize={baseFontSize} />
}
