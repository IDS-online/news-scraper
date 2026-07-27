import { describe, it, expect } from 'vitest'
import { createCategorySchema, updateCategorySchema } from '@/lib/validations/category'

const validCategory = {
  name: 'Technologie',
  description: 'Nachrichten zu Software, Hardware und IT-Sicherheit.',
}

describe('createCategorySchema', () => {
  it('accepts a valid category', () => {
    expect(createCategorySchema.safeParse(validCategory).success).toBe(true)
  })

  it('rejects a description shorter than twenty characters', () => {
    const result = createCategorySchema.safeParse({ ...validCategory, description: 'Zu kurz' })
    expect(result.success).toBe(false)
  })

  it('accepts a description of exactly twenty characters', () => {
    const result = createCategorySchema.safeParse({
      ...validCategory,
      description: 'a'.repeat(20),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createCategorySchema.safeParse({ ...validCategory, name: '' }).success).toBe(false)
  })

  it('rejects a name longer than one hundred characters', () => {
    const result = createCategorySchema.safeParse({ ...validCategory, name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('trims surrounding whitespace from name and description', () => {
    const result = createCategorySchema.parse({
      name: '  Technologie  ',
      description: `  ${validCategory.description}  `,
    })
    expect(result.name).toBe('Technologie')
    expect(result.description).toBe(validCategory.description)
  })

  it('checks the minimum length before trimming, so padding can satisfy it', () => {
    // description: z.string().min(20, ...).trim() — the chain applies the
    // min-length check on the raw string first, then trims. A string that is
    // only long enough because of surrounding whitespace therefore still
    // passes, and the trimmed result can end up shorter than the minimum.
    const result = createCategorySchema.safeParse({
      name: 'Test',
      description: `  ${'a'.repeat(19)}  `,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description.length).toBe(19)
    }
  })
})

describe('updateCategorySchema', () => {
  it('accepts a single field', () => {
    expect(updateCategorySchema.safeParse({ name: 'Neuer Name' }).success).toBe(true)
  })

  it('rejects an empty object', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false)
  })
})
