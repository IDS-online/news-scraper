/**
 * Normalized article format returned by scraping engines (RSS, HTML).
 * This is the in-memory representation before persistence (NEWS-5 handles storage).
 */
export interface NormalizedArticle {
  title: string
  url: string
  description: string | null
  image_url: string | null
  source_category_raw: string | null
  published_at: string // ISO 8601
  source_id: string
  language: string // ISO 639-1 code or 'und' for undetermined
}

/**
 * Result of a single scraping run for one source.
 */
export interface ScrapeResult {
  source_id: string
  articles: NormalizedArticle[]
  errors: ScrapeError[]
  fetched_at: string // ISO 8601
}

/**
 * Structured error from a scraping run.
 */
export interface ScrapeError {
  source_id: string
  message: string
  code: 'NETWORK_ERROR' | 'TIMEOUT' | 'HTTP_ERROR' | 'PARSE_ERROR' | 'INVALID_FEED' | 'UNKNOWN'
  http_status?: number
  timestamp: string // ISO 8601
}
