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

  it('applies the minimum length after trimming', () => {
    const result = createCategorySchema.safeParse({
      name: 'Test',
      description: `  ${'a'.repeat(19)}  `,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only name', () => {
    const result = createCategorySchema.safeParse({ ...validCategory, name: '   ' })
    expect(result.success).toBe(false)
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
