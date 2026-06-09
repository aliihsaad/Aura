import React from 'react'
import { Globe } from 'lucide-react'

export default function SourceCard({
  url,
  title,
  domain,
}: {
  url: string
  title: string
  domain: string
}): React.JSX.Element {
  const favicon = domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
    : ''

  return (
    <button
      type="button"
      onClick={() => { void window.api.openExternal(url) }}
      className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
    >
      {favicon ? (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          className="shrink-0 rounded-sm"
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
      ) : (
        <Globe size={14} className="shrink-0 text-white/40" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-white/85">{title}</span>
        <span className="block truncate text-[10.5px] text-white/40">{domain || url}</span>
      </span>
    </button>
  )
}
