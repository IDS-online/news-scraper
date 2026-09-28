/**
 * NEWS-21: the generic, engine-agnostic last-resort image lookup.
 *
 * Problem: ~50 articles from 2 of 6 sources (mgb-dental, dental-tribune — both
 * RSS) arrive without an `image_url`, because their feeds carry no
 * `media:content`, `media:thumbnail` or `enclosure`. The article PAGES of 5 of 6
 * sources do carry `og:image`. So instead of teaching either engine about
 * per-source quirks, the scheduler fetches the article's own page once and reads
 * the standard meta tags off it.
 *
 * Two hard design constraints, both learned the expensive way (see the spec's
 * review corrections):
 *
 *  1. **This is a last resort, not a step.** It runs only for articles whose
 *     `image_url` is still null after the engine did its job. A source with a
 *     working `selector_image` or RSS media field causes zero extra requests.
 *
 *  2. **It runs post-deduplication, in the scheduler.** Hanging it inside the
 *     engines would fire it for every image-less item in the feed window on
 *     every run — ≈ 2 × 10 items × 96 runs/day ≈ 1 900 requests/day against two
 *     third-party servers, for data already stored. Applied to `newArticles`
 *     only, the real figure is ~10–20 per DAY.
 *
 * Deliberately NOT implemented (spec, "out of scope"):
 *  - JSON-LD `image` (schema.org). The next logical rung, but both affected
 *    sources expose `og:image`; the `image` property being string | string[] |
 *    ImageObject is real parsing surface for no current value. Add it if a real
 *    source ever needs it.
 *  - "Largest `<img>` in the article container". Rejected outright: it needs a
 *    per-source article-body heuristic — exactly the per-source special-casing
 *    this feature exists to avoid — and cannot tell a hero image from an ad.
 *    Sources that need that already have `selector_image`.
 *  - A redirect cap. `MAX_REDIRECTS` in html-engine.ts is declared but NOT
 *    enforced (see its comment at the fetch call): native fetch follows up to 20
 *    redirects. This module copies that fetch path and therefore inherits the
 *    same behaviour. Documented honestly rather than promised falsely.
 *  - Pixel-dimension checks (tracking pixels / 1×1 placeholders). This validates
 *    the URL's scheme, not the image's size.
 *  - Caching. At ~10–20 fetches/day the volume is negligible and a cache would
 *    add staleness questions worth more than it saves.
 */

import * as cheerio from 'cheerio'
import { isUsableImageUrl, normalizeImageUrl } from '@/lib/image-url'
import { detectCharset } from '@/lib/scraping/html-engine'
import type { RunBudget } from '@/lib/scraping/run-budget'

// ---- Configuration ----

/**
 * Per-page timeout. Short on purpose: the fallback is a nice-to-have running
 * inside a shared 60 s function window.
 *
 * Because the fallback runs in the scheduler AFTER the engine call, it sits
 * outside the per-source `JOB_TIMEOUT_MS = 30_000` and can no longer abort a
 * source's own scrape — which the rejected per-engine placement would have done.
 */
export const FALLBACK_FETCH_TIMEOUT_MS = 5_000

/** Same 5 MB cap as the HTML engine. We only need `<head>`, but capping the
 * read is simpler and safer than trying to short-circuit after `</head>`. */
export const FALLBACK_MAX_RESPONSE_SIZE = 5 * 1024 * 1024

/**
 * Fetches in flight. Small enough not to stampede a host we already scrape every
 * 15 minutes, large enough that a burst of image-less articles does not
 * serialise itself into the run budget.
 */
export const FALLBACK_CONCURRENCY = 3

/** Same identity as the primary fetch — no extra allowlisting on the source side. */
const USER_AGENT = 'Newsgrap3r/1.0 (+https://github.com/newsgrap3r)'

/**
 * The meta tags to try, in order of precedence.
 *
 * `og:image` wins over `twitter:image` when both are present. Both are read from
 * the SAME single fetch and the same parsed document, so trying the second costs
 * a selector lookup and ~0 ms — some sites publish only a Twitter Card.
 *
 * Each tag is looked up under both `property=` and `name=`: Open Graph specifies
 * `property` and Twitter Cards specify `name`, but real CMSes routinely emit the
 * other one, and honouring both is two strings rather than a per-source fix.
 */
const META_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'meta[name="twitter:image"]',
  'meta[property="twitter:image"]',
] as const

// ---- Single-page extraction ----

/**
 * Fetch one article page and return the first usable `og:image` /
 * `twitter:image` value, or null.
 *
 * **Never throws.** Timeout, non-200, network error, oversized body, unparsable
 * HTML, missing meta tags and unusable values all resolve to null plus one
 * `console.warn`. Failures are deliberately NOT pushed into the scheduler's
 * `result.errors`, so they cannot surface as `last_error` /
 * `last_scrape_warning`: the spec classes a failed image lookup with today's
 * silent "no image found", not with a scrape failure. An article without a
 * picture is a valid outcome; a source marked broken over one is not.
 */
export async function fetchFallbackImageUrl(articleUrl: string): Promise<string | null> {
  let pageUrl: URL
  try {
    pageUrl = new URL(articleUrl)
  } catch {
    console.warn(`[ImageFallback] Keine gueltige Artikel-URL, uebersprungen: ${articleUrl}`)
    return null
  }

  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    console.warn(`[ImageFallback] Nicht-HTTP-URL, uebersprungen: ${articleUrl}`)
    return null
  }

  let html: string
  let baseUrl = pageUrl
  try {
    const fetched = await fetchPage(pageUrl)
    html = fetched.html
    // Review B-1: native fetch follows redirects, so the document may live at
    // a different address than the one requested. Relative meta values must
    // resolve against the FINAL URL — a 301 from /artikel to /artikel/ would
    // otherwise shift a path-relative og:image into the parent directory.
    baseUrl = fetched.finalUrl
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[ImageFallback] Seite nicht abrufbar (${articleUrl}): ${message}`)
    return null
  }

  try {
    return extractMetaImageUrl(html, baseUrl)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[ImageFallback] Seite nicht auswertbar (${articleUrl}): ${message}`)
    return null
  }
}

/**
 * Pull the image address out of already-fetched HTML.
 *
 * Exported separately from the fetch so it can be unit-tested against recorded
 * fixtures, and so NEWS-22's wizard preview can reuse it on HTML it already has.
 *
 * Validation and resolution, in this order:
 *  1. `normalizeImageUrl()` — strips the whitespace and C0 controls the URL
 *     parser would strip, so a rejected scheme cannot be smuggled past step 2
 *     (NEWS-20 BUG-6/BUG-7).
 *  2. `isUsableImageUrl()` — scheme allowlist. A `data:` or `javascript:` meta
 *     value is rejected exactly like a bad `src` attribute is today.
 *  3. Resolution against **the full article URL**, not its origin. This is a
 *     deliberate deviation from `html-engine.ts`, which resolves against
 *     `baseUrl.origin` and therefore resolves a path-relative value wrongly
 *     (`bild.jpg` on `/news/artikel-1` must become `/news/bild.jpg`, not
 *     `/bild.jpg`). For a meta tag read off one specific article page, that
 *     page's own URL is the only correct base.
 *  4. `isUsableImageUrl()` again on the resolved value — resolution can only
 *     inherit the page's http(s) scheme, but re-checking costs nothing and keeps
 *     the guarantee local.
 */
export function extractMetaImageUrl(html: string, pageUrl: URL): string | null {
  const $ = cheerio.load(html)

  for (const selector of META_SELECTORS) {
    // All matches of a selector, in document order: a page with an empty
    // `og:image` followed by a filled one should use the filled one.
    const matches = $(selector).toArray()

    for (const element of matches) {
      const raw = $(element).attr('content')
      if (!isUsableImageUrl(raw)) continue

      const normalized = normalizeImageUrl(raw)

      let resolved: string
      try {
        resolved = new URL(normalized, pageUrl).toString()
      } catch {
        continue
      }

      if (!isUsableImageUrl(resolved)) continue

      return resolved
    }
  }

  return null
}

// ---- Batch orchestration ----

/** The shape the orchestrator needs — `NormalizedArticle` satisfies it. */
export interface ImageFallbackCandidate {
  url: string
  image_url: string | null
}

export interface ImageFallbackOutcome {
  /** Articles that arrived without an image, i.e. fallback candidates. */
  candidates: number
  /** Candidates a page fetch was actually started for. */
  attempted: number
  /** Candidates that gained a usable `image_url`. */
  filled: number
  /** Candidates left untouched because the run budget was spent. */
  skipped_no_budget: number
}

/**
 * Apply the fallback to a batch of articles, in place, under a run budget.
 *
 * Contract:
 *  - Only articles with a null/empty `image_url` are considered. An article that
 *    already has one is never touched and causes zero requests — that is the
 *    "purely a last resort" guarantee.
 *  - The budget is checked **before starting every fetch, including the very
 *    first**. An already-exhausted budget performs zero fetches, not "one, then
 *    stop". This is what keeps a run from being killed mid-fallback, which would
 *    skip the `finally` that releases the source's scraping lock.
 *  - Exhausting the budget mid-batch is not an error: the remaining articles
 *    keep `image_url: null`, are inserted normally, and are recovered by
 *    `scripts/backfill-missing-images.ts`. Once inserted they are excluded by
 *    deduplication on every later run, so the scheduler never revisits them —
 *    the script is the only path that fills them afterwards.
 *
 * @param extract injection point for tests (spy on "was a fetch even started?")
 *   and for reuse with a pre-fetched page.
 */
export async function applyImageFallback(
  articles: ImageFallbackCandidate[],
  budget: RunBudget,
  extract: (url: string) => Promise<string | null> = fetchFallbackImageUrl
): Promise<ImageFallbackOutcome> {
  const pending = articles.filter((article) => !isUsableImageUrl(article.image_url))

  const outcome: ImageFallbackOutcome = {
    candidates: pending.length,
    attempted: 0,
    filled: 0,
    skipped_no_budget: 0,
  }

  if (pending.length === 0) return outcome

  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= pending.length) return

      const article = pending[index]

      // Before EVERY fetch, the first one included.
      if (!budget.hasTimeLeft()) {
        outcome.skipped_no_budget++
        continue
      }

      outcome.attempted++

      // `extract` is contractually non-throwing, but a custom implementation
      // (or a future change to it) must not be able to fail a whole scrape run
      // over a missing picture.
      let found: string | null = null
      try {
        found = await extract(article.url)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[ImageFallback] Unerwarteter Fehler fuer ${article.url}: ${message}`)
      }

      if (found) {
        article.image_url = found
        outcome.filled++
      }
    }
  }

  const workerCount = Math.min(FALLBACK_CONCURRENCY, pending.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  if (outcome.skipped_no_budget > 0) {
    console.warn(
      `[ImageFallback] Zeitbudget aufgebraucht: ${outcome.skipped_no_budget} Artikel ohne Bild eingefuegt ` +
        `(Nachholen mit "npm run backfill:images")`
    )
  }

  return outcome
}

// ---- HTTP ----

/**
 * Fetch a page with the same limits as the HTML engine's `fetchHtml`: abortable
 * timeout, content-length early abort, streamed-read cap, shared charset
 * detection, same User-Agent.
 *
 * Returns the decoded HTML together with the FINAL URL the document was served
 * from (`response.url` after fetch's automatic redirects; the request URL when
 * that is missing or unparsable) — the only correct base for relative meta
 * values (review B-1).
 *
 * Throws on any failure — the single caller turns that into a null result.
 */
async function fetchPage(pageUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FALLBACK_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(pageUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, application/xhtml+xml',
      },
      // Native fetch follows redirects itself (up to 20). No cap is promised
      // here — see the module comment.
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > FALLBACK_MAX_RESPONSE_SIZE) {
      throw new Error(
        `Antwort zu gross: ${contentLength} Bytes (Limit: ${FALLBACK_MAX_RESPONSE_SIZE} Bytes)`
      )
    }

    // The address the document was actually served from. `response.url` is
    // empty on some mocked/synthetic responses and not guaranteed parsable;
    // in both cases the request URL stays the base.
    let finalUrl = pageUrl
    if (response.url) {
      try {
        finalUrl = new URL(response.url)
      } catch {
        // keep the request URL
      }
    }

    const rawBytes = await readCapped(response)

    const decoder = new TextDecoder(detectCharset(response.headers.get('content-type') ?? '', rawBytes), {
      fatal: false,
      ignoreBOM: false,
    })
    return { html: decoder.decode(rawBytes), finalUrl }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Read the body, aborting as soon as it exceeds the cap. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response body is not readable')

  const chunks: Uint8Array[] = []
  let totalSize = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    totalSize += value.byteLength
    if (totalSize > FALLBACK_MAX_RESPONSE_SIZE) {
      await reader.cancel().catch(() => {})
      throw new Error(
        `Antwort zu gross: > ${FALLBACK_MAX_RESPONSE_SIZE} Bytes waehrend des Lesens abgebrochen`
      )
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
