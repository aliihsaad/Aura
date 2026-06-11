export interface WebPageContent {
  /** URL as requested by the caller. */
  url: string
  /** URL after redirects, when the fetch layer reports it. */
  finalUrl: string
  title?: string
  text: string
  truncated: boolean
}

/**
 * Fetches a public web page and reduces it to readable plain text for the
 * agent. Companion to WebSearchService: search_web finds the links,
 * read_webpage reads one. Same dependency posture (no HTML parser library —
 * regex extraction tuned for article-style pages).
 */
export class WebPageReaderService {
  private static readonly REQUEST_TIMEOUT_MS = 12_000
  /** Stop reading the body past this point — pages bigger than this are
   * almost never worth feeding to the model anyway. */
  private static readonly MAX_RESPONSE_BYTES = 2_000_000
  /** Cap on the extracted text handed to the model. */
  private static readonly MAX_TEXT_CHARS = 8_000
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aura/1.0'

  async read(rawUrl: string): Promise<WebPageContent> {
    const url = this.validateUrl(rawUrl)
    const { body, finalUrl, contentType } = await this.fetchPage(url)

    if (contentType.includes('text/plain')) {
      const { text, truncated } = this.clampText(body)
      return { url, finalUrl, text, truncated }
    }

    const title = this.extractTitle(body)
    const { text, truncated } = this.clampText(this.extractReadableText(body))
    if (!text) {
      throw new Error('The page returned no readable text (it may be script-rendered or empty).')
    }
    return { url, finalUrl, ...(title ? { title } : {}), text, truncated }
  }

  private validateUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim()
    if (!trimmed) {
      throw new Error('A URL is required.')
    }
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      throw new Error(`"${trimmed}" is not a valid URL.`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Only http(s) pages can be read (got ${parsed.protocol.replace(':', '')}).`)
    }
    return parsed.toString()
  }

  private async fetchPage(url: string): Promise<{ body: string; finalUrl: string; contentType: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WebPageReaderService.REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'user-agent': WebPageReaderService.USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`The page returned HTTP ${response.status}.`)
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      const readable =
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        contentType.includes('text/plain') ||
        contentType === '' // some servers omit it; attempt extraction anyway
      if (!readable) {
        throw new Error(`This is not a readable web page (content-type: ${contentType}).`)
      }

      const body = await this.readBodyCapped(response)
      return { body, finalUrl: response.url || url, contentType }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Reading the page timed out.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Stream the body and stop at MAX_RESPONSE_BYTES instead of buffering
   * arbitrarily large downloads. */
  private async readBodyCapped(response: Response): Promise<string> {
    if (!response.body) {
      return await response.text()
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let received = 0
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (received >= WebPageReaderService.MAX_RESPONSE_BYTES) {
        void reader.cancel()
        break
      }
    }
    text += decoder.decode()
    return text
  }

  private extractTitle(html: string): string | undefined {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = match ? stripHtml(match[1]) : ''
    return title || undefined
  }

  /** Prefer the article/main region when one exists; otherwise the body.
   * Block-level closers become newlines so paragraph structure survives. */
  private extractReadableText(html: string): string {
    const region =
      this.matchRegion(html, 'article') ??
      this.matchRegion(html, 'main') ??
      this.matchRegion(html, 'body') ??
      html

    const withBreaks = ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form']
      .reduce(
        (html, tag) => html.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), ' '),
        region
      )
      .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')

    return withBreaks
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map((line) => decodeHtml(line).replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
  }

  private matchRegion(html: string, tag: string): string | null {
    const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
    return match ? match[1] : null
  }

  private clampText(text: string): { text: string; truncated: boolean } {
    const trimmed = text.trim()
    if (trimmed.length <= WebPageReaderService.MAX_TEXT_CHARS) {
      return { text: trimmed, truncated: false }
    }
    return { text: trimmed.slice(0, WebPageReaderService.MAX_TEXT_CHARS).trimEnd(), truncated: true }
  }
}

function stripHtml(input: string): string {
  return decodeHtml(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}
