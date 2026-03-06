import * as cheerio from 'cheerio'
import * as chrono from 'chrono-node'
import { franc } from 'franc'
import type { NormalizedArticle, ScrapeResult, ScrapeError } from '@/types/article'
import type { Source } from '@/types/source'

// ---- Configuration ----

const FETCH_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5 MB
const USER_AGENT = 'Newsgrap3r/1.0 (+https://github.com/newsgrap3r)'

// ---- Public API ----

/**
 * Fetch an HTML page and extract articles using CSS selectors from the source config.
 * Returns a ScrapeResult with normalized articles and any errors.
 *
 * This function never throws — all errors are captured in the result.
 */
export async function scrapeHtmlPage(source: Source): Promise<ScrapeResult> {
  const errors: ScrapeError[] = []
  const now = new Date().toISOString()

  // Validate that required selectors are configured
  if (!source.selector_container || !source.selector_title || !source.selector_link) {
    errors.push({
      source_id: source.id,
      message: `Fehlende CSS-Selektoren: selector_container, selector_title und selector_link sind erforderlich`,
      code: 'PARSE_ERROR',
      timestamp: now,
    })
    return { source_id: source.id, articles: [], errors, fetched_at: now }
  }

  try {
    // Fetch the HTML page
    const html = await fetchHtml(source.url, source.id, now)

    const $ = cheerio.load(html)

    // Extract base URL for resolving relative links
    const baseUrl = new URL(source.url)

    const containers = $(source.selector_container)

    if (containers.length === 0) {
      errors.push({
        source_id: source.id,
        message: `Kein Artikel gefunden fuer Quelle "${source.name}" — Selektor "${source.selector_container}" liefert 0 Treffer`,
        code: 'PARSE_ERROR',
        timestamp: now,
      })
      return { source_id: source.id, articles: [], errors, fetched_at: now }
    }

    const articles: NormalizedArticle[] = []
    const seenUrls = new Set<string>()

    containers.each((_index, container) => {
      const $container = $(container)

      // Extract title — required
      const titleEl = $container.find(source.selector_title!)
      if (titleEl.length === 0) {
        errors.push({
          source_id: source.id,
          message: `Artikel ohne Titel uebersprungen — selector_title "${source.selector_title}" nicht gefunden`,
          code: 'PARSE_ERROR',
          timestamp: now,
        })
        return // skip this container
      }
      const title = titleEl.text().trim()

      // Extract link — required
      const linkEl = $container.find(source.selector_link!)
      if (linkEl.length === 0) {
        errors.push({
          source_id: source.id,
          message: `Artikel ohne Link uebersprungen: "${title}" — selector_link "${source.selector_link}" nicht gefunden`,
          code: 'PARSE_ERROR',
          timestamp: now,
        })
        return // skip this container
      }

      const rawHref = linkEl.attr('href')
      if (!rawHref) {
        errors.push({
          source_id: source.id,
          message: `Artikel ohne href uebersprungen: "${title}" — Element gefunden, aber kein href-Attribut`,
          code: 'PARSE_ERROR',
          timestamp: now,
        })
        return
      }

      // Resolve relative URLs to absolute
      const absoluteUrl = resolveUrl(rawHref, baseUrl)
      const normalizedUrl = normalizeUrl(absoluteUrl)

      // Deduplicate within this run
      if (seenUrls.has(normalizedUrl)) {
        return
      }
      seenUrls.add(normalizedUrl)

      // Extract description — optional
      let description: string | null = null
      if (source.selector_description) {
        const descEl = $container.find(source.selector_description)
        if (descEl.length > 0) {
          description = descEl.text().trim() || null
        }
      }

      // Extract date — optional
      let publishedAt = now
      if (source.selector_date) {
        const dateEl = $container.find(source.selector_date)
        if (dateEl.length > 0) {
          const dateText = dateEl.text().trim()
          const parsed = parseDate(dateText)
          if (parsed) {
            publishedAt = parsed
          }
        }
      }

      // Extract raw category — optional
      let categoryRaw: string | null = null
      if (source.selector_category) {
        const catEl = $container.find(source.selector_category)
        if (catEl.length > 0) {
          categoryRaw = catEl.text().trim() || null
        }
      }

      // Detect language
      const language = detectLanguage(source, $)

      articles.push({
        title,
        url: normalizedUrl,
        description,
        image_url: null, // HTML scraping does not extract images in v1
        source_category_raw: categoryRaw,
        published_at: publishedAt,
        source_id: source.id,
        language,
      })
    })

    return { source_id: source.id, articles, errors, fetched_at: now }
  } catch (err: unknown) {
    const scrapeError = classifyError(err, source.id, now)
    errors.push(scrapeError)
    return { source_id: source.id, articles: [], errors, fetched_at: now }
  }
}

// ---- HTTP Fetch ----

/**
 * Fetch HTML from a URL with timeout and size limit.
 * Throws on network errors, HTTP errors, size limit exceeded, or timeout.
 */
async function fetchHtml(url: string, sourceId: string, timestamp: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, application/xhtml+xml',
      },
      redirect: 'follow',
      // Note: native fetch follows redirects automatically; MAX_REDIRECTS
      // would require a manual redirect loop which is out of scope for v1.
      // We rely on the default behavior (up to 20 redirects).
    })

    if (!response.ok) {
      const error = new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`)
      throw error
    }

    // Check content-length header for early abort on large responses
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new SizeLimitError(
        `Antwort zu gross: ${contentLength} Bytes (Limit: ${MAX_RESPONSE_SIZE} Bytes)`,
        sourceId,
        timestamp,
      )
    }

    // Read body with size limit
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const chunks: Uint8Array[] = []
    let totalSize = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalSize += value.byteLength
      if (totalSize > MAX_RESPONSE_SIZE) {
        reader.cancel()
        throw new SizeLimitError(
          `Antwort zu gross: > ${MAX_RESPONSE_SIZE} Bytes waehrend des Lesens abgebrochen`,
          sourceId,
          timestamp,
        )
      }
      chunks.push(value)
    }

    const decoder = new TextDecoder('utf-8')
    return decoder.decode(concatUint8Arrays(chunks, totalSize))
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Concatenate Uint8Arrays into a single buffer.
 */
function concatUint8Arrays(arrays: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result
}

// ---- Custom Error Classes ----

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

class SizeLimitError extends Error {
  sourceId: string
  timestamp: string
  constructor(message: string, sourceId: string, timestamp: string) {
    super(message)
    this.name = 'SizeLimitError'
    this.sourceId = sourceId
    this.timestamp = timestamp
  }
}

// ---- URL Helpers ----

/**
 * Resolve a relative URL against a base URL.
 * If the raw href is already absolute, return it as-is.
 */
function resolveUrl(rawHref: string, baseUrl: URL): string {
  try {
    // new URL will succeed for absolute URLs; for relative ones it will throw
    return new URL(rawHref, baseUrl.origin).toString()
  } catch {
    // Fallback: prepend origin
    return `${baseUrl.origin}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`
  }
}

/**
 * Normalize a URL: remove trailing slashes from path, keep query params.
 */
function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

// ---- Date Parsing ----

/**
 * Parse a date string using chrono-node, which supports:
 * - ISO 8601 (2024-01-15T10:30:00Z)
 * - European formats (15.01.2024, 15/01/2024)
 * - Relative expressions ("vor 2 Stunden", "2 hours ago")
 * - Common natural language dates
 *
 * Returns ISO 8601 string or null if unparseable.
 */
function parseDate(raw: string): string | null {
  if (!raw) return null

  // First try native Date parse for well-formatted ISO strings
  const nativeDate = new Date(raw)
  if (!isNaN(nativeDate.getTime())) {
    return nativeDate.toISOString()
  }

  // Use chrono-node for more complex/localized date formats
  const parsed = chrono.parseDate(raw)
  if (parsed) {
    return parsed.toISOString()
  }

  return null
}

// ---- Language Detection ----

/**
 * Detect language for HTML-scraped articles.
 * Priority:
 *   1. Source has a fixed language (not 'auto') -> use it
 *   2. <html lang="xx"> attribute
 *   3. <meta http-equiv="Content-Language" content="xx">
 *   4. Auto-detect from page title/text using franc
 *   5. Fallback to 'und' (undetermined)
 */
function detectLanguage(source: Source, $: cheerio.CheerioAPI): string {
  // 1. Fixed language on source
  if (source.language && source.language !== 'auto') {
    return source.language
  }

  // 2. <html lang="...">
  const htmlLang = $('html').attr('lang')
  if (htmlLang) {
    return htmlLang.split('-')[0].toLowerCase()
  }

  // 3. <meta http-equiv="Content-Language">
  const metaLang = $('meta[http-equiv="Content-Language"]').attr('content')
  if (metaLang) {
    return metaLang.split('-')[0].toLowerCase()
  }

  // 4. Auto-detect from page text
  const pageTitle = $('title').text()
  const bodyText = $('body').text().slice(0, 500)
  const text = `${pageTitle} ${bodyText}`.trim()

  if (text.length >= 20) {
    const detected = franc(text)
    if (detected !== 'und') {
      return iso639_3to1(detected)
    }
  }

  // 5. Fallback
  return 'und'
}

/**
 * Map common ISO 639-3 codes (from franc) to ISO 639-1 codes.
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

// ---- Error Classification ----

/**
 * Classify a caught error into a structured ScrapeError.
 */
function classifyError(err: unknown, sourceId: string, timestamp: string): ScrapeError {
  // Size limit errors
  if (err instanceof SizeLimitError) {
    return { source_id: sourceId, message: err.message, code: 'SIZE_LIMIT', timestamp }
  }

  // HTTP errors
  if (err instanceof HttpError) {
    return {
      source_id: sourceId,
      message: `HTTP ${err.status} beim Abrufen der Seite`,
      code: 'HTTP_ERROR',
      http_status: err.status,
      timestamp,
    }
  }

  const message = err instanceof Error ? err.message : String(err)

  // AbortController timeout
  if (message.includes('aborted') || message.includes('abort') || message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return { source_id: sourceId, message: `Timeout beim Abrufen der Seite (${FETCH_TIMEOUT_MS}ms)`, code: 'TIMEOUT', timestamp }
  }

  // Network errors
  if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('ECONNRESET') || message.includes('fetch failed')) {
    return { source_id: sourceId, message: `Netzwerkfehler: ${message}`, code: 'NETWORK_ERROR', timestamp }
  }

  return { source_id: sourceId, message: `Unbekannter Fehler: ${message}`, code: 'UNKNOWN', timestamp }
}
