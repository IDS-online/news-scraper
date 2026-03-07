import { z } from 'zod'

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich').max(100, 'Name darf maximal 100 Zeichen haben').trim(),
  description: z.string().min(20, 'Beschreibung muss mindestens 20 Zeichen haben').trim(),
})

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().min(20).trim().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Mindestens ein Feld muss angegeben werden',
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
