/**
 * NEWS-21: testable core of the missing-image backfill.
 *
 * Why a script is needed at all: `insertArticles()` in the scheduler uses
 * `insert`, not `upsert`, keyed on a unique index over `lower(url)`. An article
 * that was stored without an image is therefore skipped on every later run and
 * never gets a second chance at gaining one. Two things leave such rows behind:
 *
 *  1. the ~50 articles that predate the fallback (mgb-dental, dental-tribune),
 *     plus any other historical `image_url IS NULL` row, whatever its cause;
 *  2. **articles the run-wide budget clipped.** Once inserted they are excluded
 *     by deduplication forever, so the scheduler's fallback never revisits them.
 *     This script is therefore the STANDING recovery path, not a one-off
 *     post-deploy step.
 *
 * Why a script rather than "delete the rows and let the scheduler re-insert
 * them": RSS feeds and HTML listings only expose recent items, so every affected
 * article that has scrolled out of the source's current window would be gone for
 * good. That is uncontrolled data loss in exchange for a formatting fix.
 *
 * What it will never do: insert, delete, or touch a row that already has an
 * `image_url`. It only ever sets `image_url` on an existing row, re-checking
 * `image_url IS NULL` in the UPDATE's own WHERE clause — so it is idempotent,
 * re-runnable, and cannot race the scheduler's insert-only deduplication.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getBubbleConfig } from '@/lib/bubble/client'
import {
  FALLBACK_CONCURRENCY,
  fetchFallbackImageUrl,
} from '@/lib/scraping/og-image-fallback'

// ---- Configuration ----

/** Rows per Supabase page while listing the candidates. */
export const CANDIDATE_PAGE_SIZE = 500

/** Ids per `.in()` batch when re-reading sync stamps. */
const RESYNC_LOOKUP_CHUNK = 200

// ---- Types ----

/**
 * Derived from the factory below rather than from `createClient` itself:
 * `ReturnType` on the generic function collapses the table types to `never`,
 * while the concrete call site carries the default (untyped) schema — the same
 * pattern `scheduler.ts` uses for its admin client.
 */
type AdminClient = ReturnType<typeof createBackfillClient>

/** A candidate row: an article that currently has no picture. */
export interface NullImageArticle {
  id: string
  url: string
  title: string
  bubble_id: string | null
  bubble_synced_at: string | null
}

/**
 * One row the fill phase filled (or, in dry run, would fill).
 *
 * The Bubble columns are captured here because the resync phase needs to know
 * which rows were already pushed to Bubble *at the time they were filled* —
 * there is no database marker that could tell "filled by this run" afterwards.
 */
export interface JournalRow {
  id: string
  url: string
  title: string
  image_url: string
  bubble_id: string | null
  bubble_synced_at: string | null
}

export interface BackfillJournal {
  created_at: string
  supabase_url: string
  /** Which Bubble database the fill ran against, for the resync guard's audit trail. */
  bubble_environment: 'test' | 'live' | 'unconfigured'
  rows: JournalRow[]
}

export interface FillReport {
  /** Candidates examined (articles with `image_url IS NULL`). */
  scanned: number
  /** Candidates for which the fallback chain produced a usable image URL. */
  found: number
  /** Rows actually written. Always 0 in a dry run. */
  updated: number
  /**
   * Rows that had a usable image but were no longer `image_url IS NULL` at write
   * time — a concurrent scheduler insert or an earlier run of this script. Not a
   * failure; the guarantee is "never regress a non-null image".
   */
  skipped_already_filled: number
  failures: string[]
  /** The rows that were (or, in a dry run, would be) filled. */
  rows: JournalRow[]
  applied: boolean
}

export interface ResyncTarget {
  id: string
  url: string
  title: string
  bubble_id: string | null
  bubble_synced_at: string
}

export interface ResyncReport {
  cleared: number
  skipped: number
  failures: string[]
}

// ---- Supabase ----

/**
 * Service-role client. The backfill writes `articles`, which only `service_role`
 * may do (RLS grants admins DELETE on articles, never INSERT/UPDATE).
 */
export function createBackfillClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Fehlende Umgebungsvariable: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// ---- Fill phase ----

/**
 * Every article without a picture, oldest first.
 *
 * Deliberately not restricted to the two known sources: a null `image_url` is
 * worth filling whatever put it there.
 */
export async function loadNullImageArticles(
  supabase: AdminClient,
  pageSize: number = CANDIDATE_PAGE_SIZE
): Promise<NullImageArticle[]> {
  const rows: NullImageArticle[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, url, title, bubble_id, bubble_synced_at')
      .is('image_url', null)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) {
      throw new Error(`Artikel konnten nicht geladen werden: ${error.message}`)
    }

    const page = (data ?? []) as unknown as NullImageArticle[]
    rows.push(...page)
    if (page.length < pageSize) break
  }

  return rows
}

/**
 * Run the fill phase.
 *
 * Dry run is the default: without `apply` nothing is written, and the report
 * says exactly what would change.
 */
export async function runFill(options: {
  supabase: AdminClient
  apply: boolean
  /** Cap the number of candidates processed — useful for a careful first run. */
  limit?: number
  /** Injection point for tests; defaults to the shared fallback chain. */
  extract?: (url: string) => Promise<string | null>
  log?: (message: string) => void
}): Promise<FillReport> {
  const { supabase, apply } = options
  const extract = options.extract ?? fetchFallbackImageUrl
  const log = options.log ?? ((message: string) => console.log(message))

  const all = await loadNullImageArticles(supabase)
  const candidates = options.limit ? all.slice(0, options.limit) : all

  const report: FillReport = {
    scanned: candidates.length,
    found: 0,
    updated: 0,
    skipped_already_filled: 0,
    failures: [],
    rows: [],
    applied: apply,
  }

  log(
    `[Backfill] ${all.length} Artikel ohne Bild gefunden` +
      (options.limit && all.length > candidates.length ? `, verarbeite ${candidates.length} (--limit)` : '')
  )

  if (candidates.length === 0) return report

  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= candidates.length) return

      const article = candidates[index]

      let imageUrl: string | null = null
      try {
        imageUrl = await extract(article.url)
      } catch (err: unknown) {
        // fetchFallbackImageUrl never throws; a custom extract might.
        report.failures.push(
          `Abruf fehlgeschlagen fuer ${article.url}: ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }

      if (!imageUrl) continue

      report.found++
      const row: JournalRow = {
        id: article.id,
        url: article.url,
        title: article.title,
        image_url: imageUrl,
        bubble_id: article.bubble_id,
        bubble_synced_at: article.bubble_synced_at,
      }

      if (!apply) {
        report.rows.push(row)
        log(`[Backfill] WUERDE setzen: ${article.title} → ${imageUrl}`)
        continue
      }

      // The `.is('image_url', null)` here is the idempotency guarantee: a row
      // that gained an image since it was listed is left alone rather than
      // overwritten. Re-running the script is a no-op for rows it already filled.
      const { data, error } = await supabase
        .from('articles')
        .update({ image_url: imageUrl })
        .eq('id', article.id)
        .is('image_url', null)
        .select('id')

      if (error) {
        report.failures.push(`UPDATE fehlgeschlagen fuer ${article.id}: ${error.message}`)
        continue
      }

      if ((data ?? []).length === 0) {
        report.skipped_already_filled++
        continue
      }

      report.updated++
      report.rows.push(row)
      log(`[Backfill] gesetzt: ${article.title} → ${imageUrl}`)
    }
  }

  const workerCount = Math.min(FALLBACK_CONCURRENCY, candidates.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return report
}

// ---- Journal ----

export function buildJournal(rows: JournalRow[], supabaseUrl: string): BackfillJournal {
  const config = getBubbleConfig()
  return {
    created_at: new Date().toISOString(),
    supabase_url: supabaseUrl,
    bubble_environment: config ? (config.useTestVersion ? 'test' : 'live') : 'unconfigured',
    rows,
  }
}

export function journalFilePath(createdAt: string): string {
  return resolve(process.cwd(), `scripts/.image-backfill-journal-${createdAt.replace(/[:.]/g, '-')}.json`)
}

export function writeJournalFile(journal: BackfillJournal): string {
  const path = journalFilePath(journal.created_at)
  writeFileSync(path, JSON.stringify(journal, null, 2), 'utf8')
  return path
}

export function readJournalFile(path: string): BackfillJournal {
  const journal = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as BackfillJournal
  if (!Array.isArray(journal.rows)) {
    throw new Error(`Journal-Datei enthaelt kein "rows"-Array: ${path}`)
  }
  return journal
}

// ---- Resync phase ----

/**
 * Refuse any resync action unless the Bubble target is the development database.
 *
 * Filling `image_url` in Supabase does not update Bubble: `src/lib/bubble/client.ts`
 * exports only `bulkCreate` (`POST`) — there is no PATCH path — and the sync only
 * ever selects `bubble_synced_at IS NULL`. Articles already stamped therefore keep
 * their blank picture in Bubble forever. The only available remedy is to clear the
 * stamps so the next sync re-CREATES the records, and that is safe only because
 * the operator deletes the stale records in Bubble first. Run against a database
 * where they are not deleted, it produces duplicates.
 *
 * Hence: hard guard, no override flag. `BUBBLE_USE_TEST_VERSION !== 'true'` aborts.
 * A production re-sync needs the Bubble update path
 * (`PATCH /obj/{type}/{bubble_id}`) instead — a separate ticket, deliberately not
 * a side-effect of a backfill script.
 */
export function assertResyncTargetIsTestBubble(env: NodeJS.ProcessEnv = process.env): void {
  const config = getBubbleConfig()

  if (!config) {
    throw new Error(
      '--resync abgebrochen: Bubble ist nicht konfiguriert (BUBBLE_API_BASE_URL / BUBBLE_API_TOKEN / ' +
        'BUBBLE_DATA_TYPE fehlen). Ohne bekanntes Ziel laesst sich nicht pruefen, ob die Entwicklungs-' +
        'Datenbank gemeint ist.'
    )
  }

  if (env.BUBBLE_USE_TEST_VERSION !== 'true' || !config.useTestVersion) {
    throw new Error(
      '--resync abgebrochen: erlaubt ist ausschliesslich die Bubble-ENTWICKLUNGS-Datenbank ' +
        '(BUBBLE_USE_TEST_VERSION=true, /version-test). Aktuelles Ziel: ' +
        `${config.useTestVersion ? 'test' : 'LIVE'} (${config.baseUrl}). ` +
        'Das Zuruecksetzen der Stempel laesst den Sync die Records NEU ANLEGEN — gegen eine Datenbank, ' +
        'in der die alten Records noch stehen, entstehen Duplikate. Es gibt keinen Schalter, der das ' +
        'aufhebt: fuer ein Produktions-Resync braucht es den PATCH-Pfad (eigenes Ticket).'
    )
  }
}

/**
 * The journal rows that actually need a resync: those whose article still
 * carries a Bubble sync stamp *right now*.
 *
 * Read from the database rather than trusted from the journal, because the
 * journal is a snapshot: a row that was unsynced when it was filled has since
 * been pushed WITH its new image and needs nothing, and a stamp an operator
 * already cleared by hand must not be cleared twice.
 */
export async function loadResyncTargets(
  supabase: AdminClient,
  journal: BackfillJournal
): Promise<ResyncTarget[]> {
  const ids = journal.rows.map((row) => row.id)
  const targets: ResyncTarget[] = []

  for (let from = 0; from < ids.length; from += RESYNC_LOOKUP_CHUNK) {
    const chunk = ids.slice(from, from + RESYNC_LOOKUP_CHUNK)

    const { data, error } = await supabase
      .from('articles')
      .select('id, url, title, bubble_id, bubble_synced_at')
      .in('id', chunk)
      .not('bubble_synced_at', 'is', null)
      .limit(RESYNC_LOOKUP_CHUNK)

    if (error) {
      throw new Error(`Resync-Kandidaten konnten nicht geladen werden: ${error.message}`)
    }

    for (const row of (data ?? []) as unknown as NullImageArticle[]) {
      if (!row.bubble_synced_at) continue
      targets.push({
        id: row.id,
        url: row.url,
        title: row.title,
        bubble_id: row.bubble_id,
        bubble_synced_at: row.bubble_synced_at,
      })
    }
  }

  return targets
}

/**
 * Clear `bubble_synced_at` and `bubble_id` so the next scheduled sync re-creates
 * the records — with the image this time.
 *
 * The stamp is matched in the WHERE clause, so a stamp the sync job wrote after
 * the targets were listed is never clobbered.
 */
export async function applyResync(
  supabase: AdminClient,
  targets: ResyncTarget[]
): Promise<ResyncReport> {
  const report: ResyncReport = { cleared: 0, skipped: 0, failures: [] }

  for (const target of targets) {
    const { data, error } = await supabase
      .from('articles')
      .update({ bubble_synced_at: null, bubble_id: null })
      .eq('id', target.id)
      .eq('bubble_synced_at', target.bubble_synced_at)
      .select('id')

    if (error) {
      report.failures.push(`Resync fehlgeschlagen fuer ${target.id}: ${error.message}`)
      continue
    }

    if ((data ?? []).length === 0) {
      report.skipped++
      continue
    }

    report.cleared++
  }

  return report
}

/**
 * The six-step procedure, printed on every run of the CLI.
 *
 * Step 4 is manual on purpose: nothing in this codebase deletes Bubble records,
 * and a backfill script is not the place to start.
 */
export const RESYNC_PROCEDURE = [
  'Ablauf (NEWS-21) — Schritt 4 ist Handarbeit und bleibt es:',
  '  1. npm run backfill:images                      → Dry run, zeigt nur an, was passieren wuerde',
  '  2. npm run backfill:images -- --apply           → setzt image_url, schreibt ein Journal',
  '  3. npm run backfill:images -- --resync --list --journal=<Datei>',
  '                                                  → listet die betroffenen bubble_id-Werte',
  '  4. Diese Records in der Bubble-ENTWICKLUNGS-Datenbank manuell loeschen',
  '  5. npm run backfill:images -- --resync --apply --journal=<Datei>',
  '                                                  → loescht bubble_synced_at / bubble_id',
  '  6. Naechster planmaessiger Sync (06:00 UTC) legt die Records neu an — mit Bild',
].join('\n')
