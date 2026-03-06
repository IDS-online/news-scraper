import Parser from 'rss-parser'
import { franc } from 'franc'
import type { NormalizedArticle, ScrapeResult, ScrapeError } from '@/types/article'
import type { Source } from '@/types/source'

// ---- Configuration ----

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const MAX_ARTICLES = 100

// ---- RSS Parser instance (reusable) ----

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  maxRedirects: MAX_REDIRECTS,
  headers: {
    'User-Agent': 'Newsgrap3r/1.0 (+https://github.com/newsgrap3r)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure', { keepArray: false }],
      ['category', 'category'],
    ],
  },
})

// ---- Public API ----

/**
 * Fetch and parse an RSS/Atom feed for a given source.
 * Returns a ScrapeResult with normalized articles and any errors.
 *
 * This function never throws — all errors are captured in the result.
 */
export async function scrapeRssFeed(source: Source): Promise<ScrapeResult> {
  const errors: ScrapeError[] = []
  const now = new Date().toISOString()

  try {
    const feed = await parser.parseURL(source.url)
    const items = feed.items ?? []

    // Limit to MAX_ARTICLES most recent items
    const limitedItems = items.slice(0, MAX_ARTICLES)

    const articles: NormalizedArticle[] = []
    const seenUrls = new Set<string>()

    for (const item of limitedItems) {
      // Discard items without a link — log and skip
      const rawUrl = item.link ?? item.guid
      if (!rawUrl) {
        errors.push({
          source_id: source.id,
          message: `Artikel ohne Link uebersprungen: "${item.title ?? '(kein Titel)'}"`,
          code: 'PARSE_ERROR',
          timestamp: now,
        })
        continue
      }

      const normalizedUrl = normalizeUrl(rawUrl)

      // Deduplicate within this run
      if (seenUrls.has(normalizedUrl)) {
        continue
      }
      seenUrls.add(normalizedUrl)

      const publishedAt = parseDate(item.pubDate ?? item.isoDate) ?? now
      const description = item.contentSnippet ?? item.summary ?? item.content ?? null
      // Cast to Record for helper functions that access dynamic custom fields
      const itemRecord = item as unknown as Record<string, unknown>
      const imageUrl = extractImageUrl(itemRecord)
      const categoryRaw = extractCategory(itemRecord)
      const language = detectLanguage(source, itemRecord, feed as unknown as Record<string, unknown>)

      articles.push({
        title: item.title ?? '',
        url: normalizedUrl,
        description,
        image_url: imageUrl,
        source_category_raw: categoryRaw,
        published_at: publishedAt,
        source_id: source.id,
        language,
      })
    }

    return { source_id: source.id, articles, errors, fetched_at: now }
  } catch (err: unknown) {
    const scrapeError = classifyError(err, source.id, now)
    errors.push(scrapeError)

    return { source_id: source.id, articles: [], errors, fetched_at: now }
  }
}

// ---- Helpers ----

/**
 * Normalize a URL: remove trailing slashes from path, keep query params.
 */
function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    // Remove trailing slashes from pathname (but keep "/" for root)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    // If URL parsing fails, return as-is (better than dropping the article)
    return raw.replace(/\/+$/, '')
  }
}

/**
 * Parse a date string into ISO 8601 format. Returns null if unparseable.
 */
function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null
  const date = new Date(raw)
  if (isNaN(date.getTime())) return null
  return date.toISOString()
}

/**
 * Extract image URL from various RSS feed formats.
 */
function extractImageUrl(item: Record<string, unknown>): string | null {
  // media:content
  const mediaContent = item.mediaContent as Record<string, unknown> | undefined
  if (mediaContent?.$ && typeof (mediaContent.$ as Record<string, unknown>).url === 'string') {
    return (mediaContent.$ as Record<string, unknown>).url as string
  }

  // media:thumbnail
  const mediaThumbnail = item.mediaThumbnail as Record<string, unknown> | undefined
  if (mediaThumbnail?.$ && typeof (mediaThumbnail.$ as Record<string, unknown>).url === 'string') {
    return (mediaThumbnail.$ as Record<string, unknown>).url as string
  }

  // enclosure (often used for podcast images / article images)
  const enclosure = item.enclosure as Record<string, unknown> | undefined
  if (enclosure?.url && typeof enclosure.url === 'string') {
    const type = (enclosure.type as string) ?? ''
    if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(enclosure.url)) {
      return enclosure.url
    }
  }

  return null
}

/**
 * Extract raw category string from feed item.
 */
function extractCategory(item: Record<string, unknown>): string | null {
  const category = item.category
  if (typeof category === 'string') return category
  if (Array.isArray(category) && category.length > 0) {
    return typeof category[0] === 'string' ? category[0] : null
  }
  return null
}

/**
 * Detect language for an article.
 * Priority:
 *   1. Source has a fixed language (not 'auto') -> use it
 *   2. Feed-level language metadata
 *   3. Auto-detect from title + description using franc
 *   4. Fallback to 'und' (undetermined)
 */
function detectLanguage(
  source: Source,
  item: Record<string, unknown>,
  feed: Record<string, unknown>
): string {
  // 1. Fixed language on source
  if (source.language && source.language !== 'auto') {
    return source.language
  }

  // 2. Feed-level language (RSS 2.0 <language> tag)
  const feedLang = feed.language as string | undefined
  if (feedLang) {
    // RSS feeds may use 'en-us' format — take the primary subtag
    return feedLang.split('-')[0].toLowerCase()
  }

  // 3. Auto-detect from content
  const text = [item.title, item.contentSnippet, item.summary, item.content]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .trim()

  if (text.length >= 20) {
    const detected = franc(text)
    if (detected !== 'und') {
      // franc returns ISO 639-3; map common codes to ISO 639-1
      return iso639_3to1(detected)
    }
  }

  // 4. Fallback
  return 'und'
}

/**
 * Map common ISO 639-3 codes (from franc) to ISO 639-1 codes.
 * Returns the 3-letter code if no mapping exists.
 */
function iso639_3to1(code3: string): string {
  const map: Record<string, string> = {
    deu: 'de', eng: 'en', fra: 'fr', spa: 'es', ita: 'it',
    por: 'pt', nld: 'nl', pol: 'pl', rus: 'ru', jpn: 'ja',
    zho: 'zh', kor: 'ko', ara: 'ar', tur: 'tr', swe: 'sv',
    nor: 'no', dan: 'da', fin: 'fi', hun: 'hu', ces: 'cs',
    ron: 'ro', bul: 'bg', hrv: 'hr', srp: 'sr', slk: 'sk',
    slv: 'sl', ukr: 'uk', ell: 'el', heb: 'he', hin: 'hi',
    ben: 'bn', tam: 'ta', tha: 'th', vie: 'vi', ind: 'id',
    msa: 'ms', cat: 'ca', eus: 'eu', glg: 'gl',
  }
  return map[code3] ?? code3
}

/**
 * Classify a caught error into a structured ScrapeError.
 */
function classifyError(err: unknown, sourceId: string, timestamp: string): ScrapeError {
  const message = err instanceof Error ? err.message : String(err)

  // Timeout errors
  if (message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('ESOCKETTIMEDOUT')) {
    return { source_id: sourceId, message: `Timeout beim Abrufen des Feeds: ${message}`, code: 'TIMEOUT', timestamp }
  }

  // Network errors
  if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('ECONNRESET')) {
    return { source_id: sourceId, message: `Netzwerkfehler: ${message}`, code: 'NETWORK_ERROR', timestamp }
  }

  // HTTP status errors (rss-parser includes status in error messages)
  const httpMatch = message.match(/status code (\d{3})/)
  if (httpMatch) {
    const status = parseInt(httpMatch[1], 10)
    return {
      source_id: sourceId,
      message: `HTTP ${status} beim Abrufen des Feeds`,
      code: 'HTTP_ERROR',
      http_status: status,
      timestamp,
    }
  }

  // XML parse errors
  if (message.includes('XML') || message.includes('Non-whitespace') || message.includes('not valid')) {
    return { source_id: sourceId, message: `Ungueltiges Feed-Format: ${message}`, code: 'INVALID_FEED', timestamp }
  }

  return { source_id: sourceId, message: `Unbekannter Fehler: ${message}`, code: 'UNKNOWN', timestamp }
}
