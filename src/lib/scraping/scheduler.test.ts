import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks for the NEWS-21 integration tests.
//
// The pure-function tests further down don't touch these; the integration
// tests need (a) a Supabase client that answers the scheduler's exact call
// chains from memory and (b) an rss-parser that parses recorded feed XML
// instead of hitting the network. `fetch` is stubbed per test — it serves the
// HTML engine's listing page AND the fallback's article pages, so counting
// its calls is exactly counting HTTP requests.
// ---------------------------------------------------------------------------

const { createClient, feedXmlByUrl } = vi.hoisted(() => ({
  createClient: vi.fn(),
  feedXmlByUrl: new Map<string, string>(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

vi.mock('rss-parser', async () => {
  // rss-parser is CJS (`export = Parser`); at runtime vitest hands the class
  // back under `default`, which the module's own type does not know about.
  const actual = await vi.importActual<{ default: typeof import('rss-parser') }>('rss-parser')
  const RealParser = actual.default

  /** Parses the recorded fixture XML registered for a URL — never the live feed. */
  class FixtureParser extends RealParser {
    async parseURL(url: string) {
      const xml = feedXmlByUrl.get(url)
      if (!xml) {
        throw new Error(`Kein Feed-Fixture registriert fuer ${url}`)
      }
      return this.parseString(xml)
    }
  }

  return { default: FixtureParser }
})

import {
  isSourceDue,
  normalizeUrlForComparison,
  resolveScrapeStatus,
  runScheduledScrape,
  scrapeSourceById,
  warnOnFutureDates,
} from '@/lib/scraping/scheduler'
import { scrapeRssFeed } from '@/lib/scraping'
import { createExhaustedBudget, createRunBudget } from '@/lib/scraping/run-budget'
import type { NormalizedArticle } from '@/types/article'
import type { Source } from '@/types/source'
import {
  DT_ARTICLE_HTML,
  DT_ARTICLE_URL,
  DT_EXPECTED_IMAGE,
  DT_FEED_URL,
  DT_FEED_XML,
  HTML_LISTING_ARTICLE_HTML,
  HTML_LISTING_ARTICLE_URL,
  HTML_LISTING_EXPECTED_IMAGE,
  HTML_LISTING_HTML,
  HTML_LISTING_URL,
  MGB_ARTICLE_HTML,
  MGB_ARTICLE_URL,
  MGB_EXPECTED_IMAGE,
  MGB_FEED_URL,
  MGB_FEED_XML,
  MGB_SECOND_ARTICLE_HTML,
  MGB_SECOND_ARTICLE_URL,
  MGB_SECOND_EXPECTED_IMAGE,
  NO_META_ARTICLE_HTML,
  NO_META_ARTICLE_URL,
} from '@/lib/scraping/image-fallback-fixtures'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

describe('isSourceDue', () => {
  it('is due when it has never been scraped', () => {
    expect(isSourceDue({ last_scraped_at: null, interval_minutes: 15 })).toBe(true)
  })

  it('is due when the interval has elapsed', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(20), interval_minutes: 15 })).toBe(true)
  })

  it('is not due when the interval has not elapsed', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(5), interval_minutes: 15 })).toBe(false)
  })

  it('is due exactly at the interval boundary', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(15), interval_minutes: 15 })).toBe(true)
  })

  it('respects a long interval', () => {
    expect(isSourceDue({ last_scraped_at: minutesAgo(60), interval_minutes: 1440 })).toBe(false)
  })
})

describe('normalizeUrlForComparison', () => {
  it('lowercases the whole URL', () => {
    expect(normalizeUrlForComparison('HTTPS://Example.COM/Artikel')).toBe(
      'https://example.com/artikel'
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeUrlForComparison('https://example.com/artikel/')).toBe(
      'https://example.com/artikel'
    )
  })

  it('treats case and trailing-slash variants as the same URL', () => {
    const a = normalizeUrlForComparison('https://Example.com/Artikel/')
    const b = normalizeUrlForComparison('https://example.com/artikel')
    expect(a).toBe(b)
  })

  it('keeps the root slash', () => {
    expect(normalizeUrlForComparison('https://example.com/')).toBe('https://example.com/')
  })

  it('lowercases unparseable input and strips trailing slashes', () => {
    expect(normalizeUrlForComparison('Nicht Eine URL/')).toBe('nicht eine url')
  })
})

describe('resolveScrapeStatus', () => {
  it('reports nothing when there are no errors', () => {
    expect(resolveScrapeStatus({ articles_found: 5, errors: [] })).toEqual({
      last_error: null,
      last_scrape_warning: null,
    })
  })

  it('treats errors as a hard failure when nothing was found', () => {
    expect(
      resolveScrapeStatus({ articles_found: 0, errors: ['Kein Artikel gefunden'] })
    ).toEqual({
      last_error: 'Kein Artikel gefunden',
      last_scrape_warning: null,
    })
  })

  it('downgrades errors to a warning when some articles were still found', () => {
    expect(
      resolveScrapeStatus({
        articles_found: 8,
        errors: ['Artikel ohne Titel uebersprungen', 'Artikel ohne Titel uebersprungen'],
      })
    ).toEqual({
      last_error: null,
      last_scrape_warning: 'Artikel ohne Titel uebersprungen; Artikel ohne Titel uebersprungen',
    })
  })
})

// ---------------------------------------------------------------------------
// NEWS-23: the future-date guard, as a pure function.
// ---------------------------------------------------------------------------

describe('warnOnFutureDates', () => {
  const NOW = new Date('2026-10-06T09:00:00Z')

  function makeArticle(publishedAt: string, url = 'https://quelle.de/artikel/1'): NormalizedArticle {
    return {
      title: 'Testartikel',
      url,
      description: null,
      image_url: null,
      source_category_raw: null,
      published_at: publishedAt,
      source_id: 'src-1',
      language: 'de',
    }
  }

  it('warns for an article more than 24h ahead, naming source, URL and the parsed value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // The production signature: `11.08.2026` read month-first on 6 October
    // became 8 November — weeks ahead, retention-immune, invisible to every
    // date-window query. Exactly the row this guard must make loud.
    const warned = warnOnFutureDates(
      [makeArticle('2026-11-08T12:00:00.000Z')],
      'Beispiel Dental',
      NOW
    )

    expect(warned).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('Beispiel Dental')
    expect(message).toContain('https://quelle.de/artikel/1')
    expect(message).toContain('2026-11-08T12:00:00.000Z')
  })

  it('stays silent inside the 24h window — slightly-ahead publish dates are legitimate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const warned = warnOnFutureDates(
      [
        makeArticle('2026-10-07T08:00:00.000Z'), // 23h ahead
        makeArticle('2026-10-07T09:00:00.000Z'), // exactly 24h ahead — still inside
        makeArticle('2026-10-05T09:00:00.000Z'), // the past is never suspicious
      ],
      'Beispiel Dental',
      NOW
    )

    expect(warned).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns per offending article, not per batch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const warned = warnOnFutureDates(
      [
        makeArticle('2026-11-08T12:00:00.000Z', 'https://quelle.de/artikel/1'),
        makeArticle('2026-10-06T10:00:00.000Z', 'https://quelle.de/artikel/2'),
        makeArticle('2026-12-08T12:00:00.000Z', 'https://quelle.de/artikel/3'),
      ],
      'Beispiel Dental',
      NOW
    )

    expect(warned).toBe(2)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('skips an unparseable published_at without warning or crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(warnOnFutureDates([makeArticle('kein datum')], 'Quelle', NOW)).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// NEWS-21: integration tests for the image fallback in the scheduler pipeline.
// ---------------------------------------------------------------------------

/**
 * Stand-in for the Supabase admin client that answers exactly the call chains
 * `scheduler.ts` performs, from in-memory state:
 *
 *   sources:  select('*').eq(...).eq(...)                      → source list
 *             select('*').eq('id', x).single()                 → one source
 *             update(...).eq('id', x).eq(...).select('id')     → acquireLock
 *             update(...).eq('id', x)                          → release / status
 *   articles: select('url').in('url', [...])                   → deduplication
 *             insert(rows).select('id')                        → batch insert
 *
 * `inserted` records every row handed to insert; `statusUpdates` records every
 * post-run status write, so tests can assert `last_error` stayed null.
 */
function mockSchedulerSupabase(options: { sources: Source[]; existingUrls?: string[] }) {
  const inserted: Record<string, unknown>[] = []
  const statusUpdates: Record<string, unknown>[] = []
  const existing = (options.existingUrls ?? []).map((url) => ({ url }))

  const sourcesTable = {
    select: () => ({
      eq: (_column: string, value: unknown) => ({
        // runScheduledScrape chains a second .eq and awaits it
        eq: async () => ({ data: options.sources, error: null }),
        // scrapeSourceById chains .single()
        single: async () => {
          const found = options.sources.find((source) => source.id === value) ?? null
          return { data: found, error: found ? null : { message: 'nicht gefunden' } }
        },
      }),
    }),
    update: (values: Record<string, unknown>) => ({
      eq: (_column: string, id: unknown) => ({
        // acquireLock chains .eq('scraping_in_progress', false).select('id')
        eq: () => ({
          select: async () => ({ data: [{ id }], error: null }),
        }),
        // releaseLock and updateSourceStatus await the first .eq directly
        then: (
          onFulfilled: (result: { data: null; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          if ('last_scraped_at' in values) statusUpdates.push(values)
          return Promise.resolve({ data: null, error: null } as const).then(onFulfilled, onRejected)
        },
      }),
    }),
  }

  const articlesTable = {
    select: () => ({
      in: async () => ({ data: existing, error: null }),
    }),
    insert: (rows: Record<string, unknown>[]) => ({
      select: async () => {
        inserted.push(...rows)
        return { data: rows.map((_row, index) => ({ id: `row-${index}` })), error: null }
      },
    }),
  }

  const client = {
    from: (table: string) => (table === 'sources' ? sourcesTable : articlesTable),
  }

  return { client, inserted, statusUpdates }
}

/**
 * Stub global fetch with a URL → HTML map. Every call is counted, so
 * "zero fallback fetches" is literally "zero calls" (RSS feeds go through the
 * mocked rss-parser, never through fetch).
 */
function stubPages(pages: Record<string, string> = {}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    const html = pages[url]
    if (html === undefined) {
      return new Response('nicht gefunden', { status: 404, statusText: 'Not Found' })
    }
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    name: 'Testquelle',
    url: MGB_FEED_URL,
    type: 'rss',
    language: 'de',
    interval_minutes: 15,
    is_active: true,
    slug: null,
    default_category_id: null,
    default_category: null,
    retention_days: null,
    selector_container: null,
    selector_title: null,
    selector_link: null,
    selector_description: null,
    selector_date: null,
    selector_category: null,
    selector_image: null,
    scraping_in_progress: false,
    last_scraped_at: null,
    last_error: null,
    last_scrape_warning: null,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

/** A feed WITH a media:content tag — the primary path already delivers the image. */
const MEDIA_FEED_URL = 'https://mit-bild.de/feed/'
const MEDIA_FEED_IMAGE = 'https://cdn.mit-bild.de/artikel-1.jpg'
const MEDIA_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Mit Feed-Bild</title>
  <link>https://mit-bild.de/</link>
  <description>Quelle mit funktionierendem Medienfeld</description>
  <language>de-DE</language>
  <item>
    <title>Artikel mit Feed-Bild</title>
    <link>https://mit-bild.de/news/artikel-1</link>
    <pubDate>Mon, 28 Sep 2026 05:00:00 +0000</pubDate>
    <media:content url="${MEDIA_FEED_IMAGE}" medium="image" />
  </item>
</channel>
</rss>`

/** A feed whose article page carries no og:/twitter: meta tags at all. */
const NO_META_FEED_URL = 'https://www.dentalmarketing-magazin.de/feed.php'
const NO_META_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Dentalmarketing Magazin</title>
  <link>https://www.dentalmarketing-magazin.de/</link>
  <description>Aeltere PHP-Seite ohne Open Graph</description>
  <language>de-DE</language>
  <item>
    <title>Artikel ohne Meta-Bild</title>
    <link>${NO_META_ARTICLE_URL}</link>
    <pubDate>Mon, 28 Sep 2026 06:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`

/** rss-engine strips trailing slashes, so the fallback fetches the stripped URL. */
const DT_ARTICLE_URL_NORMALIZED = DT_ARTICLE_URL.replace(/\/+$/, '')

const savedEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

  feedXmlByUrl.set(MGB_FEED_URL, MGB_FEED_XML)
  feedXmlByUrl.set(DT_FEED_URL, DT_FEED_XML)
  feedXmlByUrl.set(MEDIA_FEED_URL, MEDIA_FEED_XML)
  feedXmlByUrl.set(NO_META_FEED_URL, NO_META_FEED_XML)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  feedXmlByUrl.clear()
  process.env = { ...savedEnv }
})

describe('scrapeRssFeed — recorded feeds of the two affected sources (engine layer)', () => {
  it('mgb-dental: the feed alone yields NO image for any article', async () => {
    const result = await scrapeRssFeed(makeSource({ url: MGB_FEED_URL }))

    expect(result.errors).toEqual([])
    expect(result.articles).toHaveLength(2)
    expect(result.articles.map((article) => article.url)).toEqual([
      MGB_ARTICLE_URL,
      MGB_SECOND_ARTICLE_URL,
    ])
    // The engine is deliberately unchanged: without media:*/enclosure it leaves
    // image_url null — filling the gap is the scheduler's job now.
    expect(result.articles.every((article) => article.image_url === null)).toBe(true)
  })

  it('dental-tribune: the feed alone yields NO image either', async () => {
    const result = await scrapeRssFeed(makeSource({ url: DT_FEED_URL }))

    expect(result.errors).toEqual([])
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].image_url).toBeNull()
  })
})

describe('runScheduledScrape — image fallback (integration)', () => {
  it('fills the mgb-dental articles from their og:image before the insert', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    })

    const results = await runScheduledScrape(createRunBudget())

    expect(results).toHaveLength(1)
    expect(results[0].errors).toEqual([])
    expect(results[0].articles_inserted).toBe(2)
    // Result plumbing for NEWS-22: the count of fallback-filled images.
    expect(results[0].images_from_fallback).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(inserted.map((row) => row.image_url)).toEqual([
      MGB_EXPECTED_IMAGE,
      MGB_SECOND_EXPECTED_IMAGE,
    ])
  })

  it('fills the dental-tribune article, fetching its own page — not the feed URL', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: DT_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [DT_ARTICLE_URL]: DT_ARTICLE_HTML,
      [DT_ARTICLE_URL_NORMALIZED]: DT_ARTICLE_HTML,
    })

    const results = await runScheduledScrape(createRunBudget())

    expect(results[0].errors).toEqual([])
    expect(inserted).toHaveLength(1)
    expect(inserted[0].image_url).toBe(DT_EXPECTED_IMAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(DT_ARTICLE_URL_NORMALIZED)
  })

  it('performs ZERO fallback fetches when deduplication filters every article out', async () => {
    // Regression guard for the ~1 900-requests/day defect (spec correction 2a):
    // articles already in the database must never trigger a page fetch again.
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
      existingUrls: [MGB_ARTICLE_URL, MGB_SECOND_ARTICLE_URL],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    })

    const results = await runScheduledScrape(createRunBudget())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
    expect(results[0].errors).toEqual([])
  })

  it('performs ZERO extra requests when the primary path already delivered the image', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MEDIA_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages()

    const results = await runScheduledScrape(createRunBudget())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].image_url).toBe(MEDIA_FEED_IMAGE)
    expect(results[0].images_from_fallback).toBe(0)
  })

  it('completes a source whose pages have no meta image: image_url null, no error', async () => {
    const { client, inserted, statusUpdates } = mockSchedulerSupabase({
      sources: [makeSource({ url: NO_META_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    stubPages({ [NO_META_ARTICLE_URL]: NO_META_ARTICLE_HTML })

    const results = await runScheduledScrape(createRunBudget())

    // Exactly today's behaviour for a source without a usable image — not a
    // new failure mode: the article is stored, the source stays healthy.
    expect(results[0].errors).toEqual([])
    expect(results[0].images_from_fallback).toBe(0)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].image_url).toBeNull()
    expect(statusUpdates.at(-1)).toMatchObject({ last_error: null, last_scrape_warning: null })
  })

  it('stops fetching when the budget runs out mid-run: rest stays null, no error, nothing dropped', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
    })
    createClient.mockReturnValue(client)

    // Injectable clock: every served page "costs" 60 ms of a 50 ms allowance,
    // advanced synchronously so the outcome is deterministic — the first fetch
    // fits, the second worker already sees the budget spent.
    let now = 0
    const budget = createRunBudget(50, () => now)
    const pages: Record<string, string> = {
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    }
    const fetchMock = vi.fn(async (input: unknown) => {
      now += 60
      return new Response(pages[String(input)] ?? '', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await runScheduledScrape(budget)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Both articles are inserted regardless — the budget clips images, never rows.
    expect(inserted).toHaveLength(2)
    expect(inserted[0].image_url).toBe(MGB_EXPECTED_IMAGE)
    expect(inserted[1].image_url).toBeNull()
    expect(results[0].errors).toEqual([])
    expect(results[0].images_from_fallback).toBe(1)
  })

  it('shares ONE budget across all sources of the run — the second source gets no fetches', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [
        makeSource({ id: 'src-mgb', url: MGB_FEED_URL }),
        makeSource({ id: 'src-dt', name: 'Dental Tribune', url: DT_FEED_URL }),
      ],
    })
    createClient.mockReturnValue(client)

    let now = 0
    const budget = createRunBudget(50, () => now)
    const fetchMock = vi.fn(async () => {
      now += 60
      return new Response(MGB_ARTICLE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await runScheduledScrape(budget)

    // Source 1 got the single fetch the allowance covered; source 2 none —
    // a per-source budget would have granted it a fresh 50 ms.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results[1].images_from_fallback).toBe(0)
    expect(results.flatMap((result) => result.errors)).toEqual([])
    expect(inserted).toHaveLength(3)
  })

  it('starts ZERO fetches with an already-exhausted budget (cron entry point)', async () => {
    // "Before the first fetch", not "one, then stop": a run killed mid-fallback
    // skips the finally that releases the lock, and nothing recovers a stale lock.
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    })

    const results = await runScheduledScrape(createExhaustedBudget())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(2)
    expect(inserted.every((row) => row.image_url === null)).toBe(true)
    expect(results[0].errors).toEqual([])
  })
})

describe('scrapeSourceById — image fallback (manual entry point)', () => {
  it('starts ZERO fetches with an already-exhausted budget', async () => {
    // The manual trigger is the MORE dangerous path: scraping by hand is how a
    // freshly added source — the case with the most image-less articles — is
    // tested. It must be budgeted exactly like the cron path.
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    })

    const result = await scrapeSourceById('src-1', createExhaustedBudget())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(2)
    expect(inserted.every((row) => row.image_url === null)).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fills images with a fresh budget — the budget reaches scrapeSource() here too', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MGB_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [MGB_ARTICLE_URL]: MGB_ARTICLE_HTML,
      [MGB_SECOND_ARTICLE_URL]: MGB_SECOND_ARTICLE_HTML,
    })

    const result = await scrapeSourceById('src-1', createRunBudget())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.images_from_fallback).toBe(2)
    expect(inserted.map((row) => row.image_url)).toEqual([
      MGB_EXPECTED_IMAGE,
      MGB_SECOND_EXPECTED_IMAGE,
    ])
  })
})

describe('runScheduledScrape — HTML source end to end', () => {
  it('fills the image via fallback when selector_image matches nothing', async () => {
    const htmlSource = makeSource({
      id: 'src-html',
      name: 'Beispiel Dental',
      type: 'html',
      url: HTML_LISTING_URL,
      selector_container: 'article.teaser',
      selector_title: '.teaser__title',
      selector_link: '.teaser__link',
      // No selector_image — the listing carries no image element anyway.
    })
    const { client, inserted } = mockSchedulerSupabase({ sources: [htmlSource] })
    createClient.mockReturnValue(client)
    const fetchMock = stubPages({
      [HTML_LISTING_URL]: HTML_LISTING_HTML,
      [HTML_LISTING_ARTICLE_URL]: HTML_LISTING_ARTICLE_HTML,
    })

    const results = await runScheduledScrape(createRunBudget())

    expect(results[0].errors).toEqual([])
    // One fetch for the listing (the engine), ONE for the article (the fallback).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(inserted).toHaveLength(1)
    // The page's og:image is path-relative; resolved against the FULL article
    // URL it lands in /aktuelles/ — resolved against the origin (the
    // html-engine way) it would wrongly land at the root.
    expect(inserted[0].image_url).toBe(HTML_LISTING_EXPECTED_IMAGE)
    expect(results[0].images_from_fallback).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// NEWS-23: the future-date guard in the real insert path.
// ---------------------------------------------------------------------------

describe('runScheduledScrape — future-date guard (NEWS-23)', () => {
  /** A feed whose single item is dated years ahead — the swap's signature, writ large. */
  const FUTURE_FEED_URL = 'https://zukunft.de/feed/'
  const FUTURE_ARTICLE_URL = 'https://zukunft.de/news/artikel-1'
  const FUTURE_PUBLISHED_AT = '2150-01-01T05:00:00.000Z'
  const FUTURE_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Zukunftsquelle</title>
  <link>https://zukunft.de/</link>
  <description>Quelle mit verdaechtig vordatiertem Artikel</description>
  <language>de-DE</language>
  <item>
    <title>Artikel aus der Zukunft</title>
    <link>${FUTURE_ARTICLE_URL}</link>
    <pubDate>Wed, 01 Jan 2150 05:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`

  it('still inserts a far-future article AND logs a warning naming source, URL and value', async () => {
    // Store-and-warn, never reject: a slightly-ahead date is legitimate, and a
    // parser path that silently drops rows is harder to debug than one that
    // logs. The warning is the whole point — the production defect sat
    // unnoticed for months because nothing surfaced it.
    feedXmlByUrl.set(FUTURE_FEED_URL, FUTURE_FEED_XML)
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ name: 'Zukunftsquelle', url: FUTURE_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    stubPages()

    const results = await runScheduledScrape(createRunBudget())

    expect(results[0].errors).toEqual([])
    expect(inserted).toHaveLength(1)
    expect(inserted[0].published_at).toBe(FUTURE_PUBLISHED_AT)

    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]))
      .filter((message) => message.includes('Zukunft'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Zukunftsquelle')
    expect(warnings[0]).toContain(FUTURE_ARTICLE_URL)
    expect(warnings[0]).toContain(FUTURE_PUBLISHED_AT)
  })

  it('logs no future-date warning for a normally dated feed', async () => {
    const { client, inserted } = mockSchedulerSupabase({
      sources: [makeSource({ url: MEDIA_FEED_URL })],
    })
    createClient.mockReturnValue(client)
    stubPages()

    await runScheduledScrape(createRunBudget())

    expect(inserted).toHaveLength(1)
    const futureWarnings = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]))
      .filter((message) => message.includes('Zukunft'))
    expect(futureWarnings).toEqual([])
  })
})
