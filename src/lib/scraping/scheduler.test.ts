import { describe, it, expect } from 'vitest'
import { isSourceDue, normalizeUrlForComparison, resolveScrapeStatus } from '@/lib/scraping/scheduler'

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
