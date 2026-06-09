/**
 * Extracts technical keyterms from session text blobs (file context, profile,
 * session subject/notes) so Deepgram can boost their recognition. Pure function.
 *
 * Heuristics target the failure modes seen in real sessions: capitalized
 * proper nouns ("React", "Vite"), camelCase identifiers ("useState",
 * "useEffect"), kebab-case package names ("react-router"), and dot-paths
 * ("package.json"). All-caps acronyms ("JSX", "API") are also kept.
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','to','of','in','on','at','by','with','as',
  'is','are','was','were','be','been','being','have','has','had','do','does','did','will','would',
  'should','could','may','might','must','can','this','that','these','those','it','its','they','them',
  'their','there','here','what','which','who','whom','whose','when','where','why','how','i','you',
  'we','he','she','my','your','our','his','her','from','into','about','over','under','out','up',
  'down','very','just','so','no','not','than','also','more','most','some','any','all','each','only',
])

const TECH_TERM_RE = [
  /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g,        // CamelCase / PascalCase
  /\b[a-z]+(?:[A-Z][a-z]+)+\b/g,             // camelCase like useState
  /\b[A-Z]{2,5}\b/g,                          // ACRONYM (2-5 chars)
  /\b[a-z]+(?:-[a-z]+)+\b/g,                  // kebab-case e.g. react-router
  /\b[a-zA-Z]+\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g,// dotted e.g. package.json, .ts files
]

const PROPER_NOUN_RE = /(?<=\s)[A-Z][a-zA-Z]{2,}\b/g

export interface ExtractKeytermsOptions {
  max?: number
  minOccurrences?: number
  minLength?: number
  maxLength?: number
}

export function extractKeyterms(blobs: Array<string | null | undefined>, opts: ExtractKeytermsOptions = {}): string[] {
  const max = opts.max ?? 40
  const minOccurrences = opts.minOccurrences ?? 1
  const minLength = opts.minLength ?? 2
  const maxLength = opts.maxLength ?? 30

  const counts = new Map<string, number>()
  const text = blobs.filter((b): b is string => typeof b === 'string' && b.length > 0).join('\n')
  if (!text.trim()) return []

  const bump = (raw: string) => {
    const term = raw.trim()
    if (term.length < minLength || term.length > maxLength) return
    if (STOPWORDS.has(term.toLowerCase())) return
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  for (const re of TECH_TERM_RE) {
    for (const m of text.matchAll(re)) bump(m[0])
  }
  for (const m of text.matchAll(PROPER_NOUN_RE)) bump(m[0])

  return [...counts.entries()]
    .filter(([, n]) => n >= minOccurrences)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([term]) => term)
}
