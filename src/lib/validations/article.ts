import { z } from 'zod'

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ISO 8601 date string validation
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Zod schema for GET /api/articles query parameters.
 * All fields are optional — defaults are applied server-side.
 */
export const articlesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => {
      const parsed = parseInt(val ?? '1', 10)
      return isNaN(parsed) || parsed < 1 ? 1 : parsed
    }),

  limit: z
    .string()
    .optional()
    .transform((val) => {
      const parsed = parseInt(val ?? '20', 10)
      if (isNaN(parsed) || parsed < 1) return 20
      return parsed > 100 ? 100 : parsed
    }),

  source_id: z
    .string()
    .regex(UUID_REGEX, 'source_id muss eine gueltige UUID sein')
    .optional(),

  category_id: z
    .string()
    .regex(UUID_REGEX, 'category_id muss eine gueltige UUID sein')
    .optional(),

  language: z
    .string()
    .min(2)
    .max(5)
    .optional(),

  from: z
    .string()
    .regex(ISO_DATE_REGEX, 'from muss ein gueltiges ISO-8601-Datum sein')
    .optional(),

  to: z
    .string()
    .regex(ISO_DATE_REGEX, 'to muss ein gueltiges ISO-8601-Datum sein')
    .optional(),

  search: z
    .string()
    .max(200, 'Suchbegriff darf maximal 200 Zeichen haben')
    .optional(),
}).refine(
  (data) => {
    if (data.from && data.to) {
      return new Date(data.from) <= new Date(data.to)
    }
    return true
  },
  { message: 'from darf nicht nach to liegen', path: ['from'] }
)

export type ArticlesQueryInput = z.infer<typeof articlesQuerySchema>
