import { createClient } from '@supabase/supabase-js'
import { scrapeRssFeed, scrapeHtmlPage } from '@/lib/scraping'
import type { Source } from '@/types/source'
import type { NormalizedArticle, ScrapeResult } from '@/types/article'

// ---- Configuration ----

const MAX_BATCH_INSERT = 100
const JOB_TIMEOUT_MS = 30_000

// ---- Types ----

export interface SchedulerResult {
  source_id: string
  source_name: string
  articles_found: number
  articles_inserted: number
  errors: string[]
  skipped_reason?: string
}

// ---- Supabase Admin Client ----

/**
 * Create a Supabase admin client using the service role key.
 * This bypasses RLS and is used only for server-side scheduler operations.
 */
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}

// ---- Public API ----

/**
 * Run the scheduled scraping job.
 * Finds all active sources that are due for scraping (based on interval_minutes)
 * and processes each one.
 *
 * Returns results for all processed sources.
 */
export async function runScheduledScrape(): Promise<SchedulerResult[]> {
  const supabase = createAdminClient()
  const results: SchedulerResult[] = []

  // Find active sources that are due for scraping
  const { data: sources, error } = await supabase
    .from('sources')
    .select('*')
    .eq('is_active', true)
    .eq('scraping_in_progress', false)

  if (error) {
    console.error('[Scheduler] Error loading sources:', error)
    return results
  }

  if (!sources || sources.length === 0) {
    console.log('[Scheduler] No active sources found')
    return results
  }

  // Filter sources that are due for scraping
  const dueSources = sources.filter((source) => isSourceDue(source))

  console.log(`[Scheduler] ${dueSources.length} of ${sources.length} active sources are due`)

  // Process each due source sequentially to avoid overloading
  for (const source of dueSources) {
    const result = await scrapeSource(supabase, source as Source)
    results.push(result)
  }

  return results
}

/**
 * Manually trigger a scrape for a specific source.
 * Used by the admin manual trigger endpoint.
 */
export async function scrapeSourceById(sourceId: string): Promise<SchedulerResult> {
  const supabase = createAdminClient()

  // Load the source
  const { data: source, error } = await supabase
    .from('sources')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (error || !source) {
    return {
      source_id: sourceId,
      source_name: 'Unknown',
      articles_found: 0,
      articles_inserted: 0,
      errors: ['Quelle nicht gefunden'],
    }
  }

  if (!source.is_active) {
    return {
      source_id: sourceId,
      source_name: source.name,
      articles_found: 0,
      articles_inserted: 0,
      errors: [],
      skipped_reason: 'Quelle ist deaktiviert',
    }
  }

  return scrapeSource(supabase, source as Source)
}

// ---- Internal ----

/**
 * Check if a source is due for scraping based on its interval_minutes.
 */
function isSourceDue(source: { last_scraped_at: string | null; interval_minutes: number }): boolean {
  if (!source.last_scraped_at) {
    // Never scraped before — it's due
    return true
  }

  const lastScraped = new Date(source.last_scraped_at).getTime()
  const intervalMs = source.interval_minutes * 60 * 1000
  const now = Date.now()

  return now - lastScraped >= intervalMs
}

/**
 * Scrape a single source: acquire lock, run engine, deduplicate, insert, release lock.
 */
async function scrapeSource(
  supabase: ReturnType<typeof createAdminClient>,
  source: Source
): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    source_id: source.id,
    source_name: source.name,
    articles_found: 0,
    articles_inserted: 0,
    errors: [],
  }

  // 1. Acquire concurrency lock
  const locked = await acquireLock(supabase, source.id)
  if (!locked) {
    result.skipped_reason = 'Scraping bereits in Ausfuehrung (Lock aktiv)'
    console.log(`[Scheduler] Skipping ${source.name}: already in progress`)
    return result
  }

  try {
    // 2. Run the appropriate scraping engine with timeout
    const scrapeResult = await runWithTimeout(
      source.type === 'rss'
        ? scrapeRssFeed(source)
        : scrapeHtmlPage(source),
      JOB_TIMEOUT_MS
    )

    // Collect any scrape errors
    for (const err of scrapeResult.errors) {
      result.errors.push(err.message)
    }

    result.articles_found = scrapeResult.articles.length

    if (scrapeResult.articles.length === 0) {
      // No new articles — still update last_scraped_at
      await updateSourceStatus(supabase, source.id, null)
      return result
    }

    // 3. Deduplicate against existing URLs in the database
    const newArticles = await deduplicateArticles(supabase, scrapeResult.articles)

    if (newArticles.length === 0) {
      // All articles already exist
      await updateSourceStatus(supabase, source.id, null)
      return result
    }

    // 4. Insert new articles in batches
    const inserted = await insertArticles(supabase, newArticles, result)
    result.articles_inserted = inserted

    // 5. Update source status
    await updateSourceStatus(
      supabase,
      source.id,
      result.errors.length > 0 ? result.errors.join('; ') : null
    )

    console.log(
      `[Scheduler] ${source.name}: ${result.articles_found} found, ${result.articles_inserted} inserted`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(message)

    // Update source with error
    await updateSourceStatus(supabase, source.id, message)

    console.error(`[Scheduler] Error scraping ${source.name}:`, message)
  } finally {
    // 6. Release the lock
    await releaseLock(supabase, source.id)
  }

  return result
}

/**
 * Acquire the scraping lock for a source.
 * Returns true if the lock was acquired, false if already locked.
 */
async function acquireLock(
  supabase: ReturnType<typeof createAdminClient>,
  sourceId: string
): Promise<boolean> {
  // Use an atomic update: only set scraping_in_progress = true
  // if it's currently false
  const { data, error } = await supabase
    .from('sources')
    .update({ scraping_in_progress: true })
    .eq('id', sourceId)
    .eq('scraping_in_progress', false)
    .select('id')

  if (error) {
    console.error(`[Scheduler] Error acquiring lock for ${sourceId}:`, error)
    return false
  }

  // If no rows were updated, the lock was already held
  return data !== null && data.length > 0
}

/**
 * Release the scraping lock for a source.
 */
async function releaseLock(
  supabase: ReturnType<typeof createAdminClient>,
  sourceId: string
): Promise<void> {
  const { error } = await supabase
    .from('sources')
    .update({ scraping_in_progress: false })
    .eq('id', sourceId)

  if (error) {
    console.error(`[Scheduler] Error releasing lock for ${sourceId}:`, error)
  }
}

/**
 * Update source status after a scrape run.
 */
async function updateSourceStatus(
  supabase: ReturnType<typeof createAdminClient>,
  sourceId: string,
  lastError: string | null
): Promise<void> {
  const { error } = await supabase
    .from('sources')
    .update({
      last_scraped_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq('id', sourceId)

  if (error) {
    console.error(`[Scheduler] Error updating source status for ${sourceId}:`, error)
  }
}

/**
 * Deduplicate articles against existing URLs in the database.
 * Uses a batch query with case-insensitive URL comparison.
 * Returns only articles whose URLs don't exist yet.
 */
async function deduplicateArticles(
  supabase: ReturnType<typeof createAdminClient>,
  articles: NormalizedArticle[]
): Promise<NormalizedArticle[]> {
  if (articles.length === 0) return []

  // Normalize URLs for comparison (lowercase, no trailing slash)
  const urlsToCheck = articles.map((a) => normalizeUrlForComparison(a.url))

  // Query existing URLs in one batch
  // Use .in() with lowercased URLs to match the LOWER(url) index
  const { data: existing, error } = await supabase
    .from('articles')
    .select('url')
    .in('url', urlsToCheck)

  if (error) {
    console.error('[Scheduler] Error checking existing URLs:', error)
    // On error, try to insert all — the unique constraint will catch duplicates
    return articles
  }

  // Build a set of existing URLs (lowercased for comparison)
  const existingUrls = new Set(
    (existing ?? []).map((row) => normalizeUrlForComparison(row.url))
  )

  return articles.filter(
    (article) => !existingUrls.has(normalizeUrlForComparison(article.url))
  )
}

/**
 * Normalize a URL for case-insensitive comparison.
 * Lowercase and remove trailing slashes.
 */
function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url.toLowerCase())
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString()
  } catch {
    return url.toLowerCase().replace(/\/+$/, '')
  }
}

/**
 * Insert new articles into the database in batches.
 * Articles are inserted with categorization_status='pending' for NEWS-11.
 * Handles individual insert failures gracefully.
 */
async function insertArticles(
  supabase: ReturnType<typeof createAdminClient>,
  articles: NormalizedArticle[],
  result: SchedulerResult
): Promise<number> {
  let totalInserted = 0

  // Process in batches of MAX_BATCH_INSERT
  for (let i = 0; i < articles.length; i += MAX_BATCH_INSERT) {
    const batch = articles.slice(i, i + MAX_BATCH_INSERT)

    const rows = batch.map((article) => ({
      source_id: article.source_id,
      title: article.title,
      url: article.url,
      description: article.description,
      image_url: article.image_url,
      language: article.language,
      published_at: article.published_at,
      source_category_raw: article.source_category_raw,
      categorization_status: 'pending' as const,
    }))

    const { data, error } = await supabase
      .from('articles')
      .insert(rows)
      .select('id')

    if (error) {
      // If batch insert fails (e.g., one duplicate slipped through),
      // try inserting articles individually
      console.warn(`[Scheduler] Batch insert failed, trying individual inserts:`, error.message)

      for (const row of rows) {
        const { error: singleError } = await supabase
          .from('articles')
          .insert(row)
          .select('id')

        if (singleError) {
          if (singleError.code === '23505') {
            // Duplicate URL — expected, skip silently
            continue
          }
          result.errors.push(`Insert fehlgeschlagen fuer "${row.title}": ${singleError.message}`)
        } else {
          totalInserted++
        }
      }
    } else {
      totalInserted += data?.length ?? 0
    }
  }

  return totalInserted
}

/**
 * Run a promise with a timeout. Rejects if the timeout is exceeded.
 */
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Job-Timeout: Scraping dauerte laenger als ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}
