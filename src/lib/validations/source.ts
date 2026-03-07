import { z } from 'zod'

// Supported language codes
export const LANGUAGE_CODES = [
  'auto', 'de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko', 'ar',
] as const

// Slug validation regex: only lowercase letters, numbers, hyphens
const SLUG_REGEX = /^[a-z0-9-]+$/

// URL validation: must be http or https
const URL_REGEX = /^https?:\/\/.+/

// Base schema for source fields shared between create and update
const sourceBaseFields = {
  name: z.string().min(1, 'Name ist erforderlich').max(255, 'Name darf maximal 255 Zeichen haben'),
  url: z.string()
    .min(1, 'URL ist erforderlich')
    .max(2000, 'URL darf maximal 2000 Zeichen haben')
    .regex(URL_REGEX, 'URL muss mit http:// oder https:// beginnen'),
  type: z.enum(['rss', 'html'], { error: 'Typ ist erforderlich (rss oder html)' }),
  language: z.enum(LANGUAGE_CODES).default('auto'),
  interval_minutes: z.number()
    .int('Intervall muss eine ganze Zahl sein')
    .min(5, 'Mindestintervall ist 5 Minuten'),
  is_active: z.boolean().default(true),

  // HTML-specific CSS selectors
  selector_container: z.string().max(500).nullable().optional(),
  selector_title: z.string().max(500).nullable().optional(),
  selector_link: z.string().max(500).nullable().optional(),
  selector_description: z.string().max(500).nullable().optional(),
  selector_date: z.string().max(500).nullable().optional(),
  selector_category: z.string().max(500).nullable().optional(),
  selector_image: z.string().max(500).nullable().optional(),

  // NEWS-10: Slug, default category, retention
  slug: z.string()
    .max(80, 'Slug darf maximal 80 Zeichen haben')
    .regex(SLUG_REGEX, 'Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten')
    .nullable()
    .optional(),
  default_category_id: z.string().uuid('Ungueltige Kategorie-ID').nullable().optional(),
  retention_days: z.number()
    .int('Retention muss eine ganze Zahl sein')
    .positive('Retention muss groesser als 0 sein')
    .nullable()
    .optional(),
}

// Schema for creating a source
export const createSourceSchema = z.object(sourceBaseFields)

// Schema for updating a source (all fields optional)
export const updateSourceSchema = z.object({
  name: sourceBaseFields.name.optional(),
  url: sourceBaseFields.url.optional(),
  type: sourceBaseFields.type.optional(),
  language: z.enum(LANGUAGE_CODES).optional(),
  interval_minutes: sourceBaseFields.interval_minutes.optional(),
  is_active: z.boolean().optional(),
  selector_container: sourceBaseFields.selector_container,
  selector_title: sourceBaseFields.selector_title,
  selector_link: sourceBaseFields.selector_link,
  selector_description: sourceBaseFields.selector_description,
  selector_date: sourceBaseFields.selector_date,
  selector_category: sourceBaseFields.selector_category,
  selector_image: sourceBaseFields.selector_image,
  slug: sourceBaseFields.slug,
  default_category_id: sourceBaseFields.default_category_id,
  retention_days: sourceBaseFields.retention_days,
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Mindestens ein Feld muss zum Aktualisieren angegeben werden' }
)

// Schema for source category mappings (NEWS-10)
export const sourceCategoryMappingSchema = z.object({
  source_category_raw: z.string().min(1, 'Quellen-Kategorie ist erforderlich').max(255),
  category_id: z.string().uuid('Ungueltige Kategorie-ID'),
})

export const sourceCategoryMappingsArraySchema = z.array(sourceCategoryMappingSchema)

// Types
export type CreateSourceInput = z.infer<typeof createSourceSchema>
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>
export type SourceCategoryMappingInput = z.infer<typeof sourceCategoryMappingSchema>
