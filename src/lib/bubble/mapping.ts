/**
 * NEWS-19: mapping between a scraped article and the Bubble data type
 * "News Scraped".
 *
 * ── ANPASSEN ──────────────────────────────────────────────────────────────
 * The keys on the right are the field names Bubble's Data API expects. Bubble
 * derives them from the field names in the app's Data tab — lowercased, spaces
 * preserved ("Image URL" becomes "image url"). They are NOT the display labels
 * and NOT guessable; read them off the app's API documentation page at
 * https://<app>.bubbleapps.io/api/1.1/meta/swagger.json and correct the values
 * below if they differ. Everything else in this feature is field-agnostic, so
 * this file is the only place that needs touching.
 */

/** The Bubble side of one field pairing. */
export const BUBBLE_FIELDS = {
  title: 'title',
  url: 'url',
  description: 'description',
  image_url: 'image_url',
  language: 'language',
  published_at: 'published_at',
  source_name: 'source_name',
  source_category_raw: 'source_category',
  /** Supabase articles.id — lets Bubble deduplicate on its own side too. */
  external_id: 'external_id',
} as const

/** An article row as the sync job reads it out of Supabase. */
export interface SyncableArticle {
  id: string
  title: string
  url: string
  description: string | null
  image_url: string | null
  language: string
  published_at: string
  source_category_raw: string | null
  sources: { name: string } | null
}

/** One record in the shape Bubble's Data API accepts. */
export type BubbleRecord = Record<string, string>

/**
 * Convert one article into a Bubble record.
 *
 * Null fields are omitted rather than sent as empty strings: Bubble treats an
 * absent key as "leave the field empty", while an explicit "" can overwrite a
 * typed field with a blank value.
 */
export function toBubbleRecord(article: SyncableArticle): BubbleRecord {
  const record: BubbleRecord = {
    [BUBBLE_FIELDS.external_id]: article.id,
    [BUBBLE_FIELDS.title]: article.title,
    [BUBBLE_FIELDS.url]: article.url,
    [BUBBLE_FIELDS.language]: article.language,
    [BUBBLE_FIELDS.published_at]: article.published_at,
  }

  if (article.description) record[BUBBLE_FIELDS.description] = article.description
  if (article.image_url) record[BUBBLE_FIELDS.image_url] = article.image_url
  if (article.source_category_raw) {
    record[BUBBLE_FIELDS.source_category_raw] = article.source_category_raw
  }
  if (article.sources?.name) record[BUBBLE_FIELDS.source_name] = article.sources.name

  return record
}
