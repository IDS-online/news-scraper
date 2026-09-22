/**
 * NEWS-19: push newly scraped articles into the Bubble "News Scraped" data type.
 *
 * Runs once a day after the night's scrapes. "New" means exactly one thing:
 * articles.bubble_synced_at IS NULL. A row is stamped only after Bubble has
 * confirmed it, so a crash, a timeout or a partial batch costs nothing — the
 * next run picks up precisely what is still missing.
 */

import { createClient } from '@supabase/supabase-js'
import {
  BUBBLE_BULK_LIMIT,
  bulkCreate,
  getBubbleConfig,
  type BubbleConfig,
} from './client'
import { toBubbleRecord, type SyncableArticle } from './mapping'

/** Records per Bubble call. Well under the hard limit, keeps retries cheap. */
const BATCH_SIZE = 100

/** Ceiling per run, so one backlog cannot exhaust the function's 60s budget. */
const MAX_ARTICLES_PER_RUN = 1000

export interface BubbleSyncResult {
  articles_pending: number
  articles_synced: number
  articles_failed: number
  errors: string[]
  skipped_reason?: string
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Run the daily Bubble sync.
 * Skips cleanly (no error) when the Bubble credentials are not configured.
 */
export async function runBubbleSync(): Promise<BubbleSyncResult> {
  const result: BubbleSyncResult = {
    articles_pending: 0,
    articles_synced: 0,
    articles_failed: 0,
    errors: [],
  }

  const config = getBubbleConfig()
  if (!config) {
    result.skipped_reason =
      'Bubble nicht konfiguriert (BUBBLE_API_BASE_URL, BUBBLE_API_TOKEN, BUBBLE_DATA_TYPE)'
    console.warn(`[BubbleSync] ${result.skipped_reason}`)
    return result
  }

  const supabase = createAdminClient()
  const articles = await loadUnsyncedArticles(supabase)
  result.articles_pending = articles.length

  if (articles.length === 0) {
    console.log('[BubbleSync] Keine neuen Artikel — nichts zu tun')
    return result
  }

  console.log(`[BubbleSync] ${articles.length} neue Artikel werden übertragen`)

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    await syncBatch(supabase, config, articles.slice(i, i + BATCH_SIZE), result)
  }

  console.log(
    `[BubbleSync] Fertig: ${result.articles_synced} übertragen, ${result.articles_failed} fehlgeschlagen`
  )

  return result
}

/**
 * Load articles that have not reached Bubble yet, oldest first, so a backlog is
 * worked off in the order the articles were published rather than randomly.
 */
async function loadUnsyncedArticles(supabase: AdminClient): Promise<SyncableArticle[]> {
  const { data, error } = await supabase
    .from('articles')
    .select(
      'id, title, url, description, image_url, language, published_at, source_category_raw, sources(name)'
    )
    .is('bubble_synced_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_ARTICLES_PER_RUN)

  if (error) {
    throw new Error(`Artikel konnten nicht geladen werden: ${error.message}`)
  }

  // Supabase types the embedded relation as an array; it is a to-one join here.
  return (data ?? []).map((row) => {
    const { sources, ...rest } = row as unknown as Omit<SyncableArticle, 'sources'> & {
      sources: { name: string } | { name: string }[] | null
    }
    return {
      ...rest,
      sources: Array.isArray(sources) ? (sources[0] ?? null) : sources,
    }
  })
}

/**
 * Send one batch and stamp the articles Bubble accepted.
 *
 * A transport failure fails the whole batch — every article stays unsynced and
 * is retried tomorrow. Per-record rejections are counted and reported, but do
 * not stop the remaining batches.
 */
async function syncBatch(
  supabase: AdminClient,
  config: BubbleConfig,
  batch: SyncableArticle[],
  result: BubbleSyncResult
): Promise<void> {
  if (batch.length > BUBBLE_BULK_LIMIT) {
    throw new Error(`Batch zu groß: ${batch.length} > ${BUBBLE_BULK_LIMIT}`)
  }

  let outcomes
  try {
    outcomes = await bulkCreate(config, batch.map(toBubbleRecord))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    result.articles_failed += batch.length
    result.errors.push(`Batch fehlgeschlagen (${batch.length} Artikel): ${message}`)
    console.error('[BubbleSync] Batch fehlgeschlagen:', message)
    return
  }

  const syncedAt = new Date().toISOString()

  for (const [index, outcome] of outcomes.entries()) {
    const article = batch[index]

    if (!outcome.success) {
      result.articles_failed++
      result.errors.push(`"${article.title}": ${outcome.error ?? 'unbekannter Fehler'}`)
      continue
    }

    const { error } = await supabase
      .from('articles')
      .update({ bubble_synced_at: syncedAt, bubble_id: outcome.id ?? null })
      .eq('id', article.id)

    if (error) {
      // The record exists in Bubble but we failed to remember that. Flag it
      // loudly: the next run will send it again and create a duplicate.
      result.errors.push(
        `Artikel ${article.id} wurde an Bubble übertragen, konnte aber nicht als synchronisiert markiert werden: ${error.message}`
      )
      console.error('[BubbleSync] Stamp fehlgeschlagen für', article.id, error.message)
      continue
    }

    result.articles_synced++
  }
}
