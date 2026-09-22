/**
 * NEWS-19: mapping between a scraped article and the Bubble data type
 * "News Scraped".
 *
 * The keys on the right are the field names Bubble's Data API expects. They
 * were read off an existing record in the app (ids.online), not guessed — the
 * casing and the spaces are part of the name and must stay exactly as they are.
 *
 * Bubble has no counterpart for `language` or `source_category_raw`, so those
 * two are not transferred.
 */

/** The Bubble side of one field pairing. */
export const BUBBLE_FIELDS = {
  title: 'Headline_DE',
  subheadline: 'Subheadline_DE',
  description: 'Teaser_Text_DE',
  url: 'Link Source URL',
  image_url: 'Picture',
  publisher: 'Publisher',
  published_at: 'Date publishing',
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
 * Derive the publisher from the article URL, e.g. "zwp-online.info".
 *
 * The existing 53 records in Bubble store the bare host without "www.", and
 * Bubble filters on that value — deriving it from the URL keeps new rows
 * consistent with the old ones, which the Supabase source name would not.
 */
export function toPublisher(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Convert one article into a Bubble record.
 *
 * Null fields are omitted rather than sent as empty strings: Bubble treats an
 * absent key as "leave the field empty", while an explicit "" can overwrite a
 * typed field with a blank value.
 */
export function toBubbleRecord(article: SyncableArticle): BubbleRecord {
  const record: BubbleRecord = {
    [BUBBLE_FIELDS.title]: article.title,
    // The scraper has no separate subheadline, and the existing records repeat
    // the headline here rather than leaving it blank.
    [BUBBLE_FIELDS.subheadline]: article.title,
    [BUBBLE_FIELDS.url]: article.url,
    [BUBBLE_FIELDS.published_at]: article.published_at,
  }

  if (article.description) record[BUBBLE_FIELDS.description] = article.description
  if (article.image_url) record[BUBBLE_FIELDS.image_url] = article.image_url

  const publisher = toPublisher(article.url)
  if (publisher) record[BUBBLE_FIELDS.publisher] = publisher

  return record
}
