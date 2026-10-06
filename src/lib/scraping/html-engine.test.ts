import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveUrl, normalizeUrl, parseDate, scrapeHtmlPreview } from '@/lib/scraping/html-engine'

describe('resolveUrl', () => {
  const base = new URL('https://example.com/news/index.html')

  it('resolves a root-relative href against the origin', () => {
    expect(resolveUrl('/artikel/1', base)).toBe('https://example.com/artikel/1')
  })

  it('resolves a bare relative href against the origin', () => {
    expect(resolveUrl('artikel/1', base)).toBe('https://example.com/artikel/1')
  })

  it('leaves an absolute href on another host untouched', () => {
    expect(resolveUrl('https://andere.de/x', base)).toBe('https://andere.de/x')
  })

  it('preserves the query string', () => {
    expect(resolveUrl('/artikel?id=7', base)).toBe('https://example.com/artikel?id=7')
  })
})

describe('normalizeUrl', () => {
  it('strips a trailing slash from the path', () => {
    expect(normalizeUrl('https://example.com/artikel/')).toBe('https://example.com/artikel')
  })

  it('keeps the root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/artikel/?id=7')).toBe(
      'https://example.com/artikel?id=7'
    )
  })
})

/**
 * `parseDate` is a thin delegate since NEWS-23 — the pipeline and its
 * exhaustive cases live in `parse-date.test.ts`. What is still asserted here
 * is the engine's own contract: the export survives, and the inputs these
 * tests pinned before NEWS-23 still produce the same results.
 */
describe('parseDate', () => {
  it('passes an ISO 8601 date through', () => {
    expect(parseDate('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('parses a natural-language English date', () => {
    // Was handled by the native Date parse before NEWS-23, now by the guarded
    // English stage (the string carries an alphabetic month token). Same result.
    const result = parseDate('January 15, 2024')
    expect(result).not.toBeNull()
    expect(result!.startsWith('2024-01-15')).toBe(true)
  })

  it('parses an English date the native parser rejects', () => {
    // new Date('Jan 15th, 2024') is Invalid Date — the ordinal suffix defeats
    // it — so this input is only parseable via chrono.
    const result = parseDate('Jan 15th, 2024')
    expect(result).not.toBeNull()
    expect(result!.startsWith('2024-01-15')).toBe(true)
  })

  it('reads a German day-first date day-first (NEWS-23)', () => {
    expect(parseDate('11.08.2026')!.startsWith('2026-08-11')).toBe(true)
  })

  it('resolves relative expressions against the injected reference date', () => {
    expect(parseDate('vor 2 Stunden', new Date('2026-10-06T09:00:00Z'))).toBe(
      '2026-10-06T07:00:00.000Z'
    )
  })

  it('returns null for an empty string', () => {
    expect(parseDate('')).toBeNull()
  })

  it('returns null for text containing no date', () => {
    expect(parseDate('weder Datum noch Uhrzeit')).toBeNull()
  })
})

/**
 * NEWS-23: the production defect, reproduced end to end.
 *
 * On 2026-10-05 the "newest" articles in the feed carried `published_at`
 * values of 2026-11-08 and 2026-12-08 — months in the future — because the
 * date cell said `11.08.2026` and the parser read it US-style. This goes
 * through the real engine (selector extraction included), not just the parse
 * function, so the whole path from HTML cell to `published_at` is pinned.
 */
describe('scrapeHtmlPage date extraction (NEWS-23)', () => {
  const config = {
    url: 'https://example.com/news',
    selector_container: 'article',
    selector_title: 'h2',
    selector_link: 'a',
    selector_date: '.datum',
  }

  function mockPage(dateCell: string) {
    const html =
      `<html lang="de"><body><article><h2>Schlagzeile</h2>` +
      `<a href="/artikel/1">x</a><span class="datum">${dateCell}</span>` +
      `</article></body></html>`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    )
  }

  async function publishedAtFor(dateCell: string) {
    mockPage(dateCell)
    const result = await scrapeHtmlPreview(config)
    expect(result.articles).toHaveLength(1)
    return result.articles[0].published_at
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores 11.08.2026 as 11 August — the exact production swap', async () => {
    expect((await publishedAtFor('11.08.2026')).slice(0, 10)).toBe('2026-08-11')
  })

  it('stores a date cell with a weekday prefix and time correctly', async () => {
    expect((await publishedAtFor('Mo., 11.08.2026, 14:30 Uhr')).slice(0, 10)).toBe('2026-08-11')
  })

  it('stores a written-out German month correctly', async () => {
    expect((await publishedAtFor('8. März 2026')).slice(0, 10)).toBe('2026-03-08')
  })

  it('falls back to the scrape timestamp for an unparseable cell', async () => {
    // Unchanged behaviour: no date means "now", never an invented date.
    const before = Date.now()
    const publishedAt = await publishedAtFor('kein Datum hier')
    expect(new Date(publishedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })
})

/**
 * NEWS-20: image extraction end-to-end through scrapeHtmlPreview().
 *
 * ZM-online ships `<img src="data:," data-src="https://real-url...">`. The old
 * `??` chain stored the placeholder because the attribute was present, and
 * Bubble then rejected the whole article. These cases lock the new behaviour in.
 */
describe('scrapeHtmlPage image extraction', () => {
  const config = {
    url: 'https://example.com/news',
    selector_container: 'article',
    selector_title: 'h2',
    selector_link: 'a',
    selector_image: 'img',
  }

  function mockPage(imgTag: string) {
    const html = `<html><body><article><h2>Schlagzeile</h2><a href="/artikel/1">x</a>${imgTag}</article></body></html>`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    )
  }

  async function imageUrlFor(imgTag: string) {
    mockPage(imgTag)
    const result = await scrapeHtmlPreview(config)
    expect(result.articles).toHaveLength(1)
    return result.articles[0].image_url
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses data-src when src holds the data: placeholder', async () => {
    expect(await imageUrlFor('<img src="data:," data-src="https://cdn.example.com/real.jpg">')).toBe(
      'https://cdn.example.com/real.jpg'
    )
  })

  it('uses data-lazy-src when src is a placeholder and data-src is missing', async () => {
    expect(
      await imageUrlFor('<img src="data:," data-lazy-src="https://cdn.example.com/lazy.jpg">')
    ).toBe('https://cdn.example.com/lazy.jpg')
  })

  it('uses the first srcset candidate as the last resort', async () => {
    expect(
      await imageUrlFor('<img src="data:," srcset="/media/small.jpg 480w, /media/large.jpg 1200w">')
    ).toBe('https://example.com/media/small.jpg')
  })

  it('yields null when no attribute holds a usable address', async () => {
    expect(await imageUrlFor('<img src="data:,">')).toBeNull()
  })

  it('leaves a normal src untouched (regression guard for the working sources)', async () => {
    expect(await imageUrlFor('<img src="https://cdn.example.com/a.jpg">')).toBe(
      'https://cdn.example.com/a.jpg'
    )
  })

  it('resolves a relative data-src against the origin, as before', async () => {
    expect(await imageUrlFor('<img src="data:," data-src="/media/a.jpg">')).toBe(
      'https://example.com/media/a.jpg'
    )
  })

  it('still stores the article when no image is found', async () => {
    mockPage('<img src="data:,">')
    const result = await scrapeHtmlPreview(config)
    expect(result.articles[0].title).toBe('Schlagzeile')
    expect(result.articles[0].url).toBe('https://example.com/artikel/1')
  })
})
