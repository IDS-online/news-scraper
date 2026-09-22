import { describe, it, expect } from 'vitest'
import { BUBBLE_FIELDS, toBubbleRecord, toPublisher, type SyncableArticle } from './mapping'

const article: SyncableArticle = {
  id: 'uuid-1',
  title: 'Schlagzeile',
  url: 'https://www.zwp-online.info/news/a',
  description: 'Teaser',
  image_url: 'https://www.zwp-online.info/a.jpg',
  language: 'de',
  published_at: '2026-09-22T06:00:00.000Z',
  source_category_raw: 'Politik',
  sources: { name: 'ZWP online' },
}

describe('toPublisher', () => {
  it('strips the www prefix, matching the existing Bubble records', () => {
    expect(toPublisher('https://www.zwp-online.info/news/a')).toBe('zwp-online.info')
  })

  it('keeps a host that has no www prefix', () => {
    expect(toPublisher('https://mgo-dental.de/x')).toBe('mgo-dental.de')
  })

  it('keeps a subdomain that is not www', () => {
    expect(toPublisher('https://news.example.co.uk/x')).toBe('news.example.co.uk')
  })

  it('returns null for an unparseable URL instead of throwing', () => {
    expect(toPublisher('not-a-url')).toBeNull()
  })
})

describe('toBubbleRecord', () => {
  it('maps every populated field to its Bubble name', () => {
    expect(toBubbleRecord(article)).toEqual({
      'Headline_DE': 'Schlagzeile',
      'Subheadline_DE': 'Schlagzeile',
      'Link Source URL': 'https://www.zwp-online.info/news/a',
      'Date publishing': '2026-09-22T06:00:00.000Z',
      'Teaser_Text_DE': 'Teaser',
      'Picture': 'https://www.zwp-online.info/a.jpg',
      'Publisher': 'zwp-online.info',
    })
  })

  it('repeats the headline as subheadline, as the existing records do', () => {
    expect(toBubbleRecord(article)[BUBBLE_FIELDS.subheadline]).toBe('Schlagzeile')
  })

  it('omits empty optional fields instead of sending blanks', () => {
    const record = toBubbleRecord({ ...article, description: null, image_url: null })
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.description)
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.image_url)
  })

  it('sends no publisher when the URL cannot be parsed', () => {
    const record = toBubbleRecord({ ...article, url: 'not-a-url' })
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.publisher)
  })
})
