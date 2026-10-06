import { describe, it, expect } from 'vitest'
import {
  normalizeUrl,
  parseDate,
  extractImageUrl,
  extractCategory,
  iso639_3to1,
} from '@/lib/scraping/rss-engine'

describe('normalizeUrl', () => {
  it('strips a trailing slash from the path', () => {
    expect(normalizeUrl('https://example.com/artikel/')).toBe('https://example.com/artikel')
  })

  it('strips repeated trailing slashes', () => {
    expect(normalizeUrl('https://example.com/artikel///')).toBe('https://example.com/artikel')
  })

  it('keeps the root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/artikel/?id=7')).toBe(
      'https://example.com/artikel?id=7'
    )
  })

  it('returns unparseable input unchanged apart from trailing slashes', () => {
    expect(normalizeUrl('nicht-ganz-eine-url/')).toBe('nicht-ganz-eine-url')
  })
})

describe('parseDate', () => {
  it('converts an RFC 822 date to ISO 8601', () => {
    expect(parseDate('Mon, 06 Mar 2026 10:30:00 GMT')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('passes an ISO 8601 date through', () => {
    expect(parseDate('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('returns null for an unparseable string', () => {
    expect(parseDate('kein datum')).toBeNull()
  })

  it('returns null for null, undefined and empty string', () => {
    expect(parseDate(null)).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate('')).toBeNull()
  })

  /**
   * NEWS-23 guard tests. The RSS engine is deliberately NOT changed by that
   * ticket — `rss-engine.ts` has a zero-line diff — and these cases are the
   * proof rather than the assumption.
   *
   * The two tests above already cover the formats that matter: RSS 2.0
   * mandates RFC 822 `pubDate` and Atom mandates RFC 3339, both of which are
   * unambiguous (month spelled out, or year first) and therefore immune to the
   * day/month swap that NEWS-23 fixes in the HTML engine.
   */
  it('is unaffected by the NEWS-23 fix for the formats feeds actually use', () => {
    // Day > 12 and day <= 12, RFC 822 and ISO: all four read literally.
    expect(parseDate('Tue, 11 Aug 2026 10:30:00 GMT')).toBe('2026-08-11T10:30:00.000Z')
    expect(parseDate('Fri, 28 Aug 2026 10:30:00 GMT')).toBe('2026-08-28T10:30:00.000Z')
    expect(parseDate('2026-08-11T10:30:00Z')).toBe('2026-08-11T10:30:00.000Z')
    expect(parseDate('2026-08-28T10:30:00Z')).toBe('2026-08-28T10:30:00.000Z')
  })

  it('DOCUMENTED LIMITATION: a non-conformant localized pubDate is still read month-first', () => {
    // A feed that violates RSS 2.0 by emitting a German numeric date hits the
    // identical swap here, because this parser is native `Date` only:
    // `11.08.2026` becomes 8 November. This is OUT OF SCOPE for NEWS-23 by
    // explicit decision (the spec's dependency note) and is pinned here so the
    // behaviour is visible and any future change to it is deliberate.
    //
    // The fix, should a real feed ever need it, is to delegate to
    // `@/lib/scraping/parse-date` exactly as the HTML engine now does.
    expect(parseDate('11.08.2026')).toBe('2026-11-08T00:00:00.000Z')

    // Day > 12 is not even parseable, so such an article silently receives the
    // scrape timestamp instead (the caller's `?? now` fallback).
    expect(parseDate('28.08.2026')).toBeNull()
  })
})

describe('extractImageUrl', () => {
  it('reads media:content', () => {
    const item = { mediaContent: { $: { url: 'https://example.com/bild.jpg' } } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.jpg')
  })

  it('reads media:thumbnail', () => {
    const item = { mediaThumbnail: { $: { url: 'https://example.com/thumb.jpg' } } }
    expect(extractImageUrl(item)).toBe('https://example.com/thumb.jpg')
  })

  it('accepts an enclosure with an image MIME type', () => {
    const item = { enclosure: { url: 'https://example.com/bild.png', type: 'image/png' } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.png')
  })

  it('accepts an enclosure with an image extension but no MIME type', () => {
    const item = { enclosure: { url: 'https://example.com/bild.webp' } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.webp')
  })

  it('rejects a non-image enclosure', () => {
    const item = { enclosure: { url: 'https://example.com/folge.mp3', type: 'audio/mpeg' } }
    expect(extractImageUrl(item)).toBeNull()
  })

  it('returns null when the item carries no image', () => {
    expect(extractImageUrl({})).toBeNull()
  })

  it('prefers media:content over an enclosure', () => {
    const item = {
      mediaContent: { $: { url: 'https://example.com/bevorzugt.jpg' } },
      enclosure: { url: 'https://example.com/andere.jpg', type: 'image/jpeg' },
    }
    expect(extractImageUrl(item)).toBe('https://example.com/bevorzugt.jpg')
  })

  it('accepts an enclosure whose MIME type is an image but whose URL has no image extension', () => {
    const item = { enclosure: { url: 'https://example.com/bild', type: 'image/png' } }
    expect(extractImageUrl(item)).toBe('https://example.com/bild')
  })

  it('accepts an enclosure with an image extension despite a non-image MIME type', () => {
    const item = {
      enclosure: { url: 'https://example.com/bild.jpg', type: 'application/octet-stream' },
    }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.jpg')
  })

  it('prefers media:content over media:thumbnail', () => {
    const item = {
      mediaContent: { $: { url: 'https://example.com/content.jpg' } },
      mediaThumbnail: { $: { url: 'https://example.com/thumb.jpg' } },
    }
    expect(extractImageUrl(item)).toBe('https://example.com/content.jpg')
  })

  it('falls through to the enclosure when media:content carries no url', () => {
    const item = {
      mediaContent: {},
      enclosure: { url: 'https://example.com/bild.jpg', type: 'image/jpeg' },
    }
    expect(extractImageUrl(item)).toBe('https://example.com/bild.jpg')
  })
})

describe('extractCategory', () => {
  it('returns a string category', () => {
    expect(extractCategory({ category: 'Technik' })).toBe('Technik')
  })

  it('returns the first entry of an array category', () => {
    expect(extractCategory({ category: ['Technik', 'Wirtschaft'] })).toBe('Technik')
  })

  it('returns null for an empty array', () => {
    expect(extractCategory({ category: [] })).toBeNull()
  })

  it('returns null when no category is present', () => {
    expect(extractCategory({})).toBeNull()
  })

  it('returns null when the first array entry is not a string', () => {
    expect(extractCategory({ category: [123] })).toBeNull()
  })
})

describe('iso639_3to1', () => {
  it('maps German', () => {
    expect(iso639_3to1('deu')).toBe('de')
  })

  it('maps English', () => {
    expect(iso639_3to1('eng')).toBe('en')
  })

  it('returns the three-letter code when no mapping exists', () => {
    expect(iso639_3to1('xyz')).toBe('xyz')
  })
})
