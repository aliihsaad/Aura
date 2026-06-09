export interface WebSearchItem {
  title: string
  url: string
  snippet?: string
}

export interface WebSearchResult {
  query: string
  provider: string
  results: WebSearchItem[]
}

export class WebSearchService {
  private static readonly DEFAULT_LIMIT = 5
  private static readonly MAX_LIMIT = 8
  private static readonly REQUEST_TIMEOUT_MS = 12_000
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Whisphry/1.0'

  async search(query: string, limit = WebSearchService.DEFAULT_LIMIT): Promise<WebSearchResult> {
    const normalized = query.trim()
    if (!normalized) {
      throw new Error('Search query is required.')
    }

    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), WebSearchService.MAX_LIMIT)
    const html = await this.fetchDuckDuckGoHtml(normalized)
    const results = this.parseDuckDuckGoResults(html, clampedLimit)

    if (results.length === 0) {
      throw new Error('No web search results were returned.')
    }

    return {
      query: normalized,
      provider: 'DuckDuckGo',
      results,
    }
  }

  private async fetchDuckDuckGoHtml(query: string): Promise<string> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WebSearchService.REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'user-agent': WebSearchService.USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Search provider returned HTTP ${response.status}.`)
      }

      return await response.text()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Web search timed out.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private parseDuckDuckGoResults(html: string, limit: number): WebSearchItem[] {
    const items: WebSearchItem[] = []
    const resultPattern =
      /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>?/gi

    for (const block of this.extractMatches(html, resultPattern)) {
      const item = this.parseResultBlock(block)
      if (!item) continue
      items.push(item)
      if (items.length >= limit) return items
    }

    if (items.length === 0) {
      const fallback = this.parseAnchorsFallback(html, limit)
      if (fallback.length > 0) return fallback
    }

    return items
  }

  private parseResultBlock(block: string): WebSearchItem | null {
    const anchorMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    )
    if (!anchorMatch) return null

    const rawUrl = decodeHtml(anchorMatch[1])
    const url = this.normalizeDuckDuckGoUrl(rawUrl)
    if (!url) return null

    const title = stripHtml(anchorMatch[2]).trim()
    if (!title) return null

    const snippetMatch =
      block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<div[^>]*class="[^"]*result__extras__url[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : undefined
    return { title, url, ...(snippet ? { snippet } : {}) }
  }

  private parseAnchorsFallback(html: string, limit: number): WebSearchItem[] {
    const items: WebSearchItem[] = []
    const anchorPattern =
      /<a[^>]*class="[^"]*(?:result-link|result__a)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

    for (const match of html.matchAll(anchorPattern)) {
      const rawUrl = decodeHtml(match[1])
      const url = this.normalizeDuckDuckGoUrl(rawUrl)
      const title = stripHtml(match[2]).trim()
      if (!url || !title) continue
      items.push({ title, url })
      if (items.length >= limit) break
    }

    return items
  }

  private normalizeDuckDuckGoUrl(rawUrl: string): string | null {
    try {
      if (rawUrl.startsWith('//')) {
        return `https:${rawUrl}`
      }
      if (rawUrl.startsWith('/l/?')) {
        const parsed = new URL(`https://duckduckgo.com${rawUrl}`)
        const uddg = parsed.searchParams.get('uddg')
        return uddg ? decodeURIComponent(uddg) : null
      }
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return rawUrl
      }
      return null
    } catch {
      return null
    }
  }

  private extractMatches(input: string, pattern: RegExp): string[] {
    const matches: string[] = []
    for (const match of input.matchAll(pattern)) {
      if (match[1]) matches.push(match[1])
    }
    return matches
  }
}

function stripHtml(input: string): string {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim()
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}
