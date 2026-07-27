import { describe, it, expect } from 'vitest'
import { normalizeUrl, extractLinkTagFeeds } from '@/lib/scraping/feed-detector'

describe('normalizeUrl', () => {
  it('prepends https:// when no scheme is given', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  it('leaves an https URL untouched', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('leaves an http URL untouched', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('trims before deciding whether a scheme is present', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
  })
})

describe('extractLinkTagFeeds', () => {
  it('finds an RSS link tag and resolves it against the base URL', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      </head><body></body></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/feed.xml',
    ])
  })

  it('finds an Atom link tag', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/atom.xml',
    ])
  })

  it('returns every matching feed link', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([
      'https://example.com/feed.xml',
      'https://example.com/atom.xml',
    ])
  })

  it('ignores link tags whose type is not a feed MIME type', () => {
    const html = `
      <html><head>
        <link rel="stylesheet" type="text/css" href="/style.css">
      </head></html>`
    expect(extractLinkTagFeeds(html, 'https://example.com')).toEqual([])
  })

  it('returns an empty array when the document has no link tags', () => {
    expect(extractLinkTagFeeds('<html><body>nichts</body></html>', 'https://example.com')).toEqual(
      []
    )
  })
})
