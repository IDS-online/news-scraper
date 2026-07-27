import { describe, it, expect } from 'vitest'
import { articlesQuerySchema } from '@/lib/validations/article'

const UUID = '11111111-1111-1111-1111-111111111111'

describe('articlesQuerySchema', () => {
  it('defaults page to 1 and limit to 20 when absent', () => {
    const result = articlesQuerySchema.parse({})
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('parses numeric strings', () => {
    const result = articlesQuerySchema.parse({ page: '3', limit: '50' })
    expect(result.page).toBe(3)
    expect(result.limit).toBe(50)
  })

  it('falls back to page 1 for a non-numeric page', () => {
    expect(articlesQuerySchema.parse({ page: 'abc' }).page).toBe(1)
  })

  it('falls back to page 1 for a page below 1', () => {
    expect(articlesQuerySchema.parse({ page: '0' }).page).toBe(1)
  })

  it('caps limit at 100', () => {
    expect(articlesQuerySchema.parse({ limit: '500' }).limit).toBe(100)
  })

  it('falls back to limit 20 for a limit below 1', () => {
    expect(articlesQuerySchema.parse({ limit: '0' }).limit).toBe(20)
  })

  it('accepts a valid source_id UUID', () => {
    expect(articlesQuerySchema.safeParse({ source_id: UUID }).success).toBe(true)
  })

  it('rejects a malformed source_id', () => {
    expect(articlesQuerySchema.safeParse({ source_id: 'nope' }).success).toBe(false)
  })

  it('rejects a malformed category_id', () => {
    expect(articlesQuerySchema.safeParse({ category_id: '123' }).success).toBe(false)
  })

  it('accepts a date-only from value', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-06' }).success).toBe(true)
  })

  it('accepts a full ISO 8601 from value', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-06T10:30:00Z' }).success).toBe(true)
  })

  it('rejects a malformed date', () => {
    expect(articlesQuerySchema.safeParse({ from: '06.03.2026' }).success).toBe(false)
  })

  it('accepts a range where from precedes to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-06' })
    expect(result.success).toBe(true)
  })

  it('rejects a range where from is after to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-06', to: '2026-03-01' })
    expect(result.success).toBe(false)
  })

  it('accepts a range where from equals to', () => {
    const result = articlesQuerySchema.safeParse({ from: '2026-03-06', to: '2026-03-06' })
    expect(result.success).toBe(true)
  })

  it('rejects a search term longer than two hundred characters', () => {
    expect(articlesQuerySchema.safeParse({ search: 'a'.repeat(201) }).success).toBe(false)
  })
})
