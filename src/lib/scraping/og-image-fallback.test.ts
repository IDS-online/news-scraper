import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FALLBACK_CONCURRENCY,
  FALLBACK_MAX_RESPONSE_SIZE,
  applyImageFallback,
  extractMetaImageUrl,
  fetchFallbackImageUrl,
} from '@/lib/scraping/og-image-fallback'
import { createRunBudget } from '@/lib/scraping/run-budget'
import {
  DT_ARTICLE_HTML,
  DT_ARTICLE_URL,
  DT_EXPECTED_IMAGE,
  MGB_ARTICLE_HTML,
  MGB_ARTICLE_URL,
  MGB_EXPECTED_IMAGE,
  NO_META_ARTICLE_HTML,
  NO_META_ARTICLE_URL,
} from '@/lib/scraping/image-fallback-fixtures'

const ARTICLE_URL = 'https://example.com/news/2026/artikel-1'

function page(head: string): string {
  return `<!DOCTYPE html><html><head>${head}</head><body><p>Text</p></body></html>`
}

function imageFrom(head: string, url: string = ARTICLE_URL): string | null {
  return extractMetaImageUrl(page(head), new URL(url))
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Meta-tag precedence and validation
// ---------------------------------------------------------------------------

describe('extractMetaImageUrl — tag precedence', () => {
  it('reads og:image', () => {
    expect(imageFrom('<meta property="og:image" content="https://cdn.example.com/og.jpg">')).toBe(
      'https://cdn.example.com/og.jpg'
    )
  })

  it('reads twitter:image', () => {
    expect(imageFrom('<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">')).toBe(
      'https://cdn.example.com/tw.jpg'
    )
  })

  it('prefers og:image when both are present', () => {
    expect(
      imageFrom(
        '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">' +
          '<meta property="og:image" content="https://cdn.example.com/og.jpg">'
      )
    ).toBe('https://cdn.example.com/og.jpg')
  })

  it('falls back to twitter:image when og:image is present but unusable', () => {
    expect(
      imageFrom(
        '<meta property="og:image" content="data:,">' +
          '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">'
      )
    ).toBe('https://cdn.example.com/tw.jpg')
  })

  it('skips an empty og:image and uses the filled one behind it', () => {
    expect(
      imageFrom(
        '<meta property="og:image" content="">' +
          '<meta property="og:image" content="https://cdn.example.com/zweites.jpg">'
      )
    ).toBe('https://cdn.example.com/zweites.jpg')
  })

  it('accepts og:image under name= and twitter:image under property=, as real CMSes emit them', () => {
    expect(imageFrom('<meta name="og:image" content="https://cdn.example.com/a.jpg">')).toBe(
      'https://cdn.example.com/a.jpg'
    )
    expect(imageFrom('<meta property="twitter:image" content="https://cdn.example.com/b.jpg">')).toBe(
      'https://cdn.example.com/b.jpg'
    )
  })

  it('returns null when neither tag is present', () => {
    expect(imageFrom('<title>Nur ein Titel</title>')).toBeNull()
  })

  it('ignores og:image:width and other og:image:* siblings', () => {
    expect(
      imageFrom('<meta property="og:image:width" content="2560"><meta property="og:image:type" content="image/jpeg">')
    ).toBeNull()
  })
})

describe('extractMetaImageUrl — validation via image-url.ts', () => {
  it('rejects a data: placeholder (the NEWS-20 defect, now in a meta tag)', () => {
    expect(imageFrom('<meta property="og:image" content="data:,">')).toBeNull()
  })

  it('rejects a javascript: value', () => {
    expect(imageFrom('<meta property="og:image" content="javascript:alert(1)">')).toBeNull()
  })

  it('rejects a javascript: value hidden behind a control character (NEWS-20 BUG-7)', () => {
    // &#1; decodes to U+0001 — the smuggling vector BUG-7 closed for `src`.
    expect(imageFrom('<meta property="og:image" content="&#1;javascript:alert(1)">')).toBeNull()
  })

  it('rejects an empty and a whitespace-only value', () => {
    expect(imageFrom('<meta property="og:image" content="">')).toBeNull()
    expect(imageFrom('<meta property="og:image" content="   ">')).toBeNull()
  })

  it('rejects a meta tag without a content attribute', () => {
    expect(imageFrom('<meta property="og:image">')).toBeNull()
  })
})

describe('extractMetaImageUrl — resolution against the full article URL', () => {
  it('resolves a path-relative value against the article directory, not the origin', () => {
    // This is the exact case html-engine.ts:224 gets wrong by resolving against
    // baseUrl.origin: it would produce https://example.com/bild.jpg.
    expect(imageFrom('<meta property="og:image" content="bild.jpg">')).toBe(
      'https://example.com/news/2026/bild.jpg'
    )
  })

  it('resolves a root-relative value against the origin', () => {
    expect(imageFrom('<meta property="og:image" content="/media/bild.jpg">')).toBe(
      'https://example.com/media/bild.jpg'
    )
  })

  it('resolves a scheme-relative value using the page scheme', () => {
    expect(imageFrom('<meta property="og:image" content="//cdn.example.com/bild.jpg">')).toBe(
      'https://cdn.example.com/bild.jpg'
    )
  })

  it('leaves an absolute value on another host untouched', () => {
    expect(imageFrom('<meta property="og:image" content="https://cdn.fremd.de/bild.jpg">')).toBe(
      'https://cdn.fremd.de/bild.jpg'
    )
  })

  it('resolves a ../ value relative to the article, not the root', () => {
    expect(imageFrom('<meta property="og:image" content="../bild.jpg">')).toBe(
      'https://example.com/news/bild.jpg'
    )
  })
})

// ---------------------------------------------------------------------------
// Recorded fixtures of the two affected sources
// ---------------------------------------------------------------------------

describe('extractMetaImageUrl — recorded article pages', () => {
  it('finds the real og:image of an mgb-dental article', () => {
    expect(extractMetaImageUrl(MGB_ARTICLE_HTML, new URL(MGB_ARTICLE_URL))).toBe(MGB_EXPECTED_IMAGE)
  })

  it('finds the real og:image of a dental-tribune article', () => {
    expect(extractMetaImageUrl(DT_ARTICLE_HTML, new URL(DT_ARTICLE_URL))).toBe(DT_EXPECTED_IMAGE)
  })

  it('returns null for a dentalmarketing-magazin-style page with no meta image', () => {
    expect(extractMetaImageUrl(NO_META_ARTICLE_HTML, new URL(NO_META_ARTICLE_URL))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The HTTP layer
// ---------------------------------------------------------------------------

describe('fetchFallbackImageUrl', () => {
  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const mock = vi.fn(async (url: unknown, init: unknown) =>
      impl(String(url), (init ?? {}) as RequestInit)
    )
    vi.stubGlobal('fetch', mock)
    return mock
  }

  function htmlResponse(html: string, init: ResponseInit = {}): Response {
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      ...init,
    })
  }

  it('performs exactly ONE fetch and serves both meta lookups from it', async () => {
    const mock = stubFetch(async () =>
      htmlResponse(
        page(
          '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">' +
            '<meta property="og:image" content="https://cdn.example.com/og.jpg">'
        )
      )
    )

    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBe('https://cdn.example.com/og.jpg')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('sends the same User-Agent as the primary fetch', async () => {
    const mock = stubFetch(async () => htmlResponse(page('')))
    await fetchFallbackImageUrl(ARTICLE_URL)

    const init = mock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Newsgrap3r/1.0 (+https://github.com/newsgrap3r)')
    expect(headers.Accept).toContain('text/html')
  })

  it('fetches the ARTICLE url, not the feed or listing url', async () => {
    const mock = stubFetch(async () => htmlResponse(page('')))
    await fetchFallbackImageUrl(MGB_ARTICLE_URL)
    expect(mock.mock.calls[0][0]).toBe(MGB_ARTICLE_URL)
  })

  it('returns null on a non-200 response, without throwing', async () => {
    stubFetch(async () => htmlResponse('nope', { status: 404, statusText: 'Not Found' }))
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })

  it('returns null on a network error, without throwing', async () => {
    stubFetch(async () => {
      throw new Error('fetch failed')
    })
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })

  it('returns null when the request is aborted (timeout)', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })

  it('passes an abort signal so the 5s timeout can actually fire', async () => {
    const mock = stubFetch(async () => htmlResponse(page('')))
    await fetchFallbackImageUrl(ARTICLE_URL)
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns null when content-length announces more than the 5 MB cap', async () => {
    stubFetch(
      async () =>
        new Response('x', {
          headers: {
            'content-type': 'text/html',
            'content-length': String(FALLBACK_MAX_RESPONSE_SIZE + 1),
          },
        })
    )
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })

  it('returns null when the streamed body exceeds the cap despite a silent content-length', async () => {
    const oversized = 'y'.repeat(FALLBACK_MAX_RESPONSE_SIZE + 1024)
    stubFetch(async () => new Response(oversized, { headers: { 'content-type': 'text/html' } }))
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })

  it('returns null for a non-http(s) article URL and does not fetch at all', async () => {
    const mock = stubFetch(async () => htmlResponse(page('')))
    await expect(fetchFallbackImageUrl('ftp://example.com/x')).resolves.toBeNull()
    await expect(fetchFallbackImageUrl('nicht-eine-url')).resolves.toBeNull()
    expect(mock).not.toHaveBeenCalled()
  })

  it('decodes an ISO-8859-1 page using the declared charset', async () => {
    // dentalmarketing-magazin serves iso-8859-1; assuming UTF-8 would corrupt any
    // non-ASCII byte in the meta value.
    const bytes = Uint8Array.from(
      '<html><head><meta property="og:image" content="https://example.com/gr\xfcn.jpg"></head></html>',
      (char) => char.charCodeAt(0)
    )
    stubFetch(
      async () =>
        new Response(bytes, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } })
    )
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBe(
      'https://example.com/gr%C3%BCn.jpg'
    )
  })

  it('resolves a relative og:image against the POST-redirect URL (review B-1)', async () => {
    // Native fetch follows the redirect itself and hands back the final
    // address in response.url. A 301 from /artikel to /artikel/ moves the
    // document one directory DOWN — resolved against the pre-redirect URL,
    // "bild.jpg" would wrongly land in /news/ instead of /news/artikel/.
    const redirectedTo = 'https://example.com/news/artikel/'
    stubFetch(async () => {
      const response = htmlResponse(page('<meta property="og:image" content="bild.jpg">'))
      Object.defineProperty(response, 'url', { value: redirectedTo })
      return response
    })

    await expect(fetchFallbackImageUrl('https://example.com/news/artikel')).resolves.toBe(
      'https://example.com/news/artikel/bild.jpg'
    )
  })

  it('falls back to the request URL when response.url is empty or unparsable', async () => {
    // `new Response()` reports url as '' — exactly the synthetic case; the
    // request URL must then stay the resolution base.
    stubFetch(async () => htmlResponse(page('<meta property="og:image" content="bild.jpg">')))

    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBe(
      'https://example.com/news/2026/bild.jpg'
    )
  })

  it('returns null — never throws — for a body that is not HTML at all', async () => {
    stubFetch(async () => new Response('binary', { headers: { 'content-type': 'text/html' } }))
    await expect(fetchFallbackImageUrl(ARTICLE_URL)).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Batch orchestration and the budget
// ---------------------------------------------------------------------------

describe('applyImageFallback', () => {
  function article(url: string, imageUrl: string | null = null) {
    return { url, image_url: imageUrl }
  }

  const fullBudget = () => createRunBudget(20_000)
  const spentBudget = () => createRunBudget(0)

  it('fills the articles that have no image', async () => {
    const articles = [article('https://a.de/1'), article('https://a.de/2')]
    const extract = vi.fn(async (url: string) => `${url}/bild.jpg`)

    const outcome = await applyImageFallback(articles, fullBudget(), extract)

    expect(outcome).toMatchObject({ candidates: 2, attempted: 2, filled: 2, skipped_no_budget: 0 })
    expect(articles[0].image_url).toBe('https://a.de/1/bild.jpg')
    expect(articles[1].image_url).toBe('https://a.de/2/bild.jpg')
  })

  it('performs ZERO fetches when every article already has an image', async () => {
    // The "purely a last resort" guarantee: a source with a working
    // selector_image or RSS media field must cost nothing extra.
    const articles = [
      article('https://a.de/1', 'https://cdn.a.de/1.jpg'),
      article('https://a.de/2', 'https://cdn.a.de/2.jpg'),
    ]
    const extract = vi.fn()

    const outcome = await applyImageFallback(articles, fullBudget(), extract)

    expect(extract).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ candidates: 0, attempted: 0, filled: 0 })
    expect(articles[0].image_url).toBe('https://cdn.a.de/1.jpg')
  })

  it('performs ZERO fetches for an empty batch — the dedup-filtered case', async () => {
    const extract = vi.fn()
    const outcome = await applyImageFallback([], fullBudget(), extract)
    expect(extract).not.toHaveBeenCalled()
    expect(outcome.candidates).toBe(0)
  })

  it('treats a stored placeholder as "no image" and replaces it', async () => {
    // A row that predates NEWS-20 can hold `data:,`. Leaving it would keep Bubble
    // rejecting the record.
    const articles = [article('https://a.de/1', 'data:,')]
    const extract = vi.fn(async () => 'https://cdn.a.de/echt.jpg')

    await applyImageFallback(articles, fullBudget(), extract)

    expect(articles[0].image_url).toBe('https://cdn.a.de/echt.jpg')
  })

  it('starts ZERO fetches when the budget is already spent — not "one, then stop"', async () => {
    // This is the lock-loss guard: a run killed mid-fallback skips the `finally`
    // that releases `scraping_in_progress`, and nothing in the codebase recovers
    // a stale lock.
    const articles = [article('https://a.de/1'), article('https://a.de/2')]
    const extract = vi.fn(async () => 'https://cdn.a.de/x.jpg')

    const outcome = await applyImageFallback(articles, spentBudget(), extract)

    expect(extract).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ candidates: 2, attempted: 0, filled: 0, skipped_no_budget: 2 })
    expect(articles.every((a) => a.image_url === null)).toBe(true)
  })

  it('stops starting fetches once the budget runs out mid-batch, without failing', async () => {
    let now = 0
    const budget = createRunBudget(50, () => now)
    const articles = Array.from({ length: 10 }, (_unused, index) => article(`https://a.de/${index}`))

    const extract = vi.fn(async (url: string) => {
      now += 30 // every fetch "costs" 30ms of the 50ms allowance
      return `${url}/bild.jpg`
    })

    const outcome = await applyImageFallback(articles, budget, extract)

    expect(outcome.attempted).toBeGreaterThan(0)
    expect(outcome.attempted).toBeLessThan(articles.length)
    expect(outcome.filled + outcome.skipped_no_budget).toBe(articles.length)
    // No article is dropped: the rest simply stays imageless and gets inserted.
    expect(articles.filter((a) => a.image_url === null).length).toBe(outcome.skipped_no_budget)
  })

  it('never lets a throwing extractor fail the run', async () => {
    const articles = [article('https://a.de/1'), article('https://a.de/2')]
    const extract = vi.fn(async (url: string) => {
      if (url.endsWith('/1')) throw new Error('kaputt')
      return 'https://cdn.a.de/2.jpg'
    })

    const outcome = await applyImageFallback(articles, fullBudget(), extract)

    expect(outcome).toMatchObject({ attempted: 2, filled: 1 })
    expect(articles[0].image_url).toBeNull()
    expect(articles[1].image_url).toBe('https://cdn.a.de/2.jpg')
  })

  it('keeps at most FALLBACK_CONCURRENCY fetches in flight', async () => {
    let inFlight = 0
    let peak = 0
    const articles = Array.from({ length: 12 }, (_unused, index) => article(`https://a.de/${index}`))

    const extract = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((done) => setTimeout(done, 1))
      inFlight--
      return 'https://cdn.a.de/x.jpg'
    })

    await applyImageFallback(articles, fullBudget(), extract)

    expect(peak).toBeLessThanOrEqual(FALLBACK_CONCURRENCY)
    expect(extract).toHaveBeenCalledTimes(12)
  })

  it('leaves the article imageless when the page yields nothing', async () => {
    const articles = [article('https://a.de/1')]
    const outcome = await applyImageFallback(articles, fullBudget(), async () => null)

    expect(outcome).toMatchObject({ candidates: 1, attempted: 1, filled: 0 })
    expect(articles[0].image_url).toBeNull()
  })
})
