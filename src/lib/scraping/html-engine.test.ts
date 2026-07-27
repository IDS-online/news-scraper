import { describe, it, expect } from 'vitest'
import { resolveUrl, normalizeUrl, parseDate } from '@/lib/scraping/html-engine'

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

describe('parseDate', () => {
  it('passes an ISO 8601 date through', () => {
    expect(parseDate('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('parses a natural-language English date via chrono', () => {
    const result = parseDate('January 15, 2024')
    expect(result).not.toBeNull()
    expect(result!.startsWith('2024-01-15')).toBe(true)
  })

  it('returns null for an empty string', () => {
    expect(parseDate('')).toBeNull()
  })

  it('returns null for text containing no date', () => {
    expect(parseDate('weder Datum noch Uhrzeit')).toBeNull()
  })
})
