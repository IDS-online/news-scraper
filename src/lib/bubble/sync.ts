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

/** Parallel stamp updates. Keeps the 60 s budget without flooding Supabase. */
const STAMP_CONCURRENCY = 25

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
  logErrors(result)

  return result
}

/**
 * NEWS-20: write the collected reasons to the log when a run finishes.
 *
 * They were already gathered in `result.errors`, but only the caller could see
 * them. Repeating them at the end keeps the whole picture of a run in one place
 * in the Vercel log, without having to query the database.
 */
function logErrors(result: BubbleSyncResult): void {
  if (result.errors.length === 0) return

  console.error(`[BubbleSync] ${result.errors.length} Fehler in diesem Lauf:`)
  for (const message of result.errors) {
    console.error(`[BubbleSync]   - ${message}`)
  }
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
 * not stop the remaining batches. An HTTP 400 with per-record verdicts is a
 * partial success and is handled here like any other mixed result (NEWS-19, B-6)
 * — but only when Bubble returned exactly one status line per submitted record.
 * Otherwise the client throws and the batch lands in the transport-failure path
 * above: nothing is stamped, everything is retried (NEWS-19, B-8).
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

  // Belt and braces for the positional mapping: bulkCreate() already guarantees
  // one verdict per submitted record, but if that guarantee ever breaks again
  // (NEWS-19, B-11) the loop below would read batch[index] === undefined, stamp
  // articles with a foreign bubble_id and then abort the whole run with a
  // TypeError. Fail the batch instead — nothing is stamped, the remaining
  // batches keep running, and everything here is retried tomorrow.
  if (outcomes.length !== batch.length) {
    result.articles_failed += batch.length
    result.errors.push(
      `Batch fehlgeschlagen (${batch.length} Artikel): Bubble lieferte ${outcomes.length} Ergebnisse für ${batch.length} Datensätze — Zuordnung nicht möglich`
    )
    console.error(
      `[BubbleSync] Zuordnung nicht möglich: ${outcomes.length} Ergebnisse für ${batch.length} Datensätze, nichts gestempelt. Ergebnisse: ${JSON.stringify(outcomes).slice(0, 2000)}`
    )
    return
  }

  const syncedAt = new Date().toISOString()
  const accepted: { article: SyncableArticle; bubbleId: string | null }[] = []

  for (const [index, outcome] of outcomes.entries()) {
    const article = batch[index]

    if (!outcome.success) {
      const reason = outcome.error ?? 'unbekannter Fehler'
      result.articles_failed++
      result.errors.push(`"${article.title}": ${reason}`)
      // NEWS-20: one line per rejected article, with its ID, so the reason shows
      // up in the Vercel log instead of only in this function's return value.
      console.error(
        `[BubbleSync] Artikel abgelehnt: ${article.id} ("${article.title}") — ${reason}`
      )
      continue
    }

    accepted.push({ article, bubbleId: outcome.id ?? null })
  }

  await stampSynced(supabase, accepted, syncedAt, result)
}

/**
 * Mark the articles Bubble accepted as synced.
 *
 * Every row carries its own bubble_id, so the stamps cannot collapse into a
 * single statement. Running them sequentially meant up to 1000 round-trips per
 * run and blew the 60 s function budget (NEWS-19, B-3); they are issued in
 * parallel chunks instead, which turns 100 round-trips per batch into four.
 */
async function stampSynced(
  supabase: AdminClient,
  accepted: { article: SyncableArticle; bubbleId: string | null }[],
  syncedAt: string,
  result: BubbleSyncResult
): Promise<void> {
  for (let i = 0; i < accepted.length; i += STAMP_CONCURRENCY) {
    const chunk = accepted.slice(i, i + STAMP_CONCURRENCY)

    const outcomes = await Promise.all(
      chunk.map(async ({ article, bubbleId }) => {
        const { error } = await supabase
          .from('articles')
          .update({ bubble_synced_at: syncedAt, bubble_id: bubbleId })
          .eq('id', article.id)
        return { article, error }
      })
    )

    for (const { article, error } of outcomes) {
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
}
