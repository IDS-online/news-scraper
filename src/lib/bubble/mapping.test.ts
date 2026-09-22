import { describe, it, expect } from 'vitest'
import { BUBBLE_FIELDS, toBubbleRecord, type SyncableArticle } from './mapping'

const article: SyncableArticle = {
  id: 'uuid-1',
  title: 'Schlagzeile',
  url: 'https://news.example.com/a',
  description: 'Teaser',
  image_url: 'https://news.example.com/a.jpg',
  language: 'de',
  published_at: '2026-09-22T06:00:00.000Z',
  source_category_raw: 'Politik',
  sources: { name: 'Beispiel-Quelle' },
}

describe('toBubbleRecord', () => {
  it('maps every populated field', () => {
    expect(toBubbleRecord(article)).toEqual({
      [BUBBLE_FIELDS.external_id]: 'uuid-1',
      [BUBBLE_FIELDS.title]: 'Schlagzeile',
      [BUBBLE_FIELDS.url]: 'https://news.example.com/a',
      [BUBBLE_FIELDS.language]: 'de',
      [BUBBLE_FIELDS.published_at]: '2026-09-22T06:00:00.000Z',
      [BUBBLE_FIELDS.description]: 'Teaser',
      [BUBBLE_FIELDS.image_url]: 'https://news.example.com/a.jpg',
      [BUBBLE_FIELDS.source_category_raw]: 'Politik',
      [BUBBLE_FIELDS.source_name]: 'Beispiel-Quelle',
    })
  })

  it('omits empty optional fields instead of sending blanks', () => {
    const record = toBubbleRecord({
      ...article,
      description: null,
      image_url: null,
      source_category_raw: null,
      sources: null,
    })
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.description)
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.image_url)
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.source_category_raw)
    expect(record).not.toHaveProperty(BUBBLE_FIELDS.source_name)
  })

  it('always carries the Supabase id so Bubble can deduplicate too', () => {
    expect(toBubbleRecord(article)[BUBBLE_FIELDS.external_id]).toBe('uuid-1')
  })
})
