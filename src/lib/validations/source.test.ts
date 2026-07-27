import { describe, it, expect } from 'vitest'
import {
  createSourceSchema,
  updateSourceSchema,
  sourceCategoryMappingSchema,
} from '@/lib/validations/source'

const validSource = {
  name: 'heise online',
  url: 'https://www.heise.de/rss/heise-atom.xml',
  type: 'rss' as const,
  interval_minutes: 30,
}

describe('createSourceSchema', () => {
  it('accepts a minimal valid source', () => {
    const result = createSourceSchema.safeParse(validSource)
    expect(result.success).toBe(true)
  })

  it('defaults language to auto and is_active to true', () => {
    const result = createSourceSchema.parse(validSource)
    expect(result.language).toBe('auto')
    expect(result.is_active).toBe(true)
  })

  it('rejects a URL without an http scheme', () => {
    const result = createSourceSchema.safeParse({ ...validSource, url: 'ftp://example.com/feed' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = createSourceSchema.safeParse({ ...validSource, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an interval below five minutes', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 4 })
    expect(result.success).toBe(false)
  })

  it('accepts an interval of exactly five minutes', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 5 })
    expect(result.success).toBe(true)
  })

  it('rejects a non-integer interval', () => {
    const result = createSourceSchema.safeParse({ ...validSource, interval_minutes: 15.5 })
    expect(result.success).toBe(false)
  })

  it('rejects a type other than rss or html', () => {
    const result = createSourceSchema.safeParse({ ...validSource, type: 'json' })
    expect(result.success).toBe(false)
  })

  it('accepts a lowercase hyphenated slug', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'heise-online' })
    expect(result.success).toBe(true)
  })

  it('rejects a slug containing uppercase letters', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'Heise-Online' })
    expect(result.success).toBe(false)
  })

  it('rejects a slug containing spaces', () => {
    const result = createSourceSchema.safeParse({ ...validSource, slug: 'heise online' })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported language code', () => {
    const result = createSourceSchema.safeParse({ ...validSource, language: 'kli' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID default_category_id', () => {
    const result = createSourceSchema.safeParse({ ...validSource, default_category_id: 'nope' })
    expect(result.success).toBe(false)
  })

  it('accepts null retention_days meaning never delete', () => {
    const result = createSourceSchema.safeParse({ ...validSource, retention_days: null })
    expect(result.success).toBe(true)
  })

  it('rejects zero or negative retention_days', () => {
    expect(createSourceSchema.safeParse({ ...validSource, retention_days: 0 }).success).toBe(false)
    expect(createSourceSchema.safeParse({ ...validSource, retention_days: -1 }).success).toBe(false)
  })
})

describe('updateSourceSchema', () => {
  it('accepts a single field', () => {
    expect(updateSourceSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true)
  })

  it('rejects an empty object', () => {
    expect(updateSourceSchema.safeParse({}).success).toBe(false)
  })

  it('still enforces the interval minimum', () => {
    expect(updateSourceSchema.safeParse({ interval_minutes: 1 }).success).toBe(false)
  })
})

describe('sourceCategoryMappingSchema', () => {
  it('accepts a raw category paired with a category UUID', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: 'Tech',
      category_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty raw category', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: '',
      category_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID category_id', () => {
    const result = sourceCategoryMappingSchema.safeParse({
      source_category_raw: 'Tech',
      category_id: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })
})
