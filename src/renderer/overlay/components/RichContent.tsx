import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { Check, Clipboard, Download, ExternalLink, ImageOff } from 'lucide-react'
import 'highlight.js/styles/vs2015.min.css'
import type { AnswerAttachment } from '@shared/types'
import SourceCard from './SourceCard'

interface RichContentProps {
  content: string
  fontSize?: number
  /** Bubbles use this — disables images, tables, and attachment cards so the
   *  bubble stays a terse one-liner. */
  compact?: boolean
  /** Structured extras (web sources, generated images) rendered below the
   *  prose. Ignored when compact. */
  attachments?: AnswerAttachment[]
  detailCapabilities?: string[]
}

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url)

function MarkdownImage({ src, alt }: { src?: string; alt?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const url = typeof src === 'string' ? src : ''
  if (!url || broken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[12px] text-white/50">
        <ImageOff size={13} />
        image unavailable
        {url && isHttp(url) && (
          <a
            href={url}
            onClick={(e) => { e.preventDefault(); void window.api.openExternal(url) }}
            className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
          >
            {url.length > 60 ? url.slice(0, 57) + '…' : url}
          </a>
        )}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setBroken(true)}
      onClick={() => { if (isHttp(url)) void window.api.openExternal(url) }}
      className="max-w-full rounded-lg my-2 border border-white/10 cursor-zoom-in"
    />
  )
}

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractNodeText).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children)
  }
  return ''
}

function CodeBlock({
  children,
  canCopy,
}: {
  children: React.ReactNode
  canCopy: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const code = extractNodeText(children).trimEnd()

  const handleCopy = (): void => {
    if (!code) return
    void window.api.copyToClipboard(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="group relative my-3">
      {canCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/85 hover:text-white group-hover:opacity-100 focus:opacity-100"
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
      <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/35 p-3 pr-12">
        {children}
      </pre>
    </div>
  )
}

export default function RichContent({
  content,
  fontSize = 15,
  compact = false,
  attachments,
  detailCapabilities = [],
}: RichContentProps): React.JSX.Element {
  const hasCapability = (capability: string): boolean => detailCapabilities.includes(capability)
  const canCopyCode = !compact && hasCapability('copy-code')
  const canDownloadImages = !compact && hasCapability('download-images')
  const imageAttachments = !compact
    ? (attachments ?? []).filter((attachment): attachment is Extract<AnswerAttachment, { type: 'image' }> => attachment.type === 'image')
    : []
  const sourceAttachments = !compact
    ? (attachments ?? []).filter((attachment): attachment is Extract<AnswerAttachment, { type: 'web-source' }> => attachment.type === 'web-source')
    : []

  return (
    <div className="rich-content" style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Sanitize first (drops anything dangerous from the raw input), then
        // let rehype-highlight add its own safe hljs-* span classes on top.
        rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        disallowedElements={compact ? ['img', 'table'] : []}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => {
            const url = typeof href === 'string' ? href : ''
            if (!url || !isHttp(url)) return <span>{children}</span>
            return (
              <a
                href={url}
                onClick={(e) => { e.preventDefault(); void window.api.openExternal(url) }}
                className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/40 hover:decoration-cyan-300 cursor-pointer inline-flex items-baseline gap-0.5"
              >
                {children}
                <ExternalLink size={11} className="opacity-60 translate-y-px" />
              </a>
            )
          },
          img: ({ src, alt }) => <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={typeof alt === 'string' ? alt : undefined} />,
          pre: ({ children }) => <CodeBlock canCopy={canCopyCode}>{children}</CodeBlock>,
        }}
      >
        {content}
      </ReactMarkdown>
      {!compact && (imageAttachments.length > 0 || sourceAttachments.length > 0) && (
        <div className="mt-3 space-y-3">
          {imageAttachments.map((attachment, index) => (
            <figure key={`img-${index}`} className="m-0">
              <div className="group relative inline-block max-w-full">
                <img
                  src={attachment.src}
                  alt={attachment.caption ?? ''}
                  loading="lazy"
                  className="max-w-full rounded-lg border border-white/10"
                />
                {canDownloadImages && (
                  <button
                    type="button"
                    onClick={() => { void window.api.saveImageAttachment({ src: attachment.src, caption: attachment.caption }) }}
                    className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[11px] font-medium text-white/75 opacity-0 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/85 hover:text-white group-hover:opacity-100 focus:opacity-100"
                    title="Download image"
                  >
                    <Download size={12} />
                    Download
                  </button>
                )}
              </div>
              {attachment.caption && (
                <figcaption className="mt-1 text-[11px] text-white/40">
                  {attachment.caption}
                </figcaption>
              )}
            </figure>
          ))}

          {sourceAttachments.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/30">
                Sources
              </div>
              {sourceAttachments.map((source, index) => (
                <SourceCard
                  key={`${source.url}-${index}`}
                  url={source.url}
                  title={source.title}
                  domain={source.domain}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
