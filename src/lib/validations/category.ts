import { z } from 'zod'

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich').max(100, 'Name darf maximal 100 Zeichen haben'),
  description: z.string().trim().min(20, 'Beschreibung muss mindestens 20 Zeichen haben'),
})

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(20).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Mindestens ein Feld muss angegeben werden',
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
