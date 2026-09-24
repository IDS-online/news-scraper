#!/usr/bin/env node
/**
 * NEWS-19 / B-2: one-off backfill for `articles.bubble_synced_at`.
 *
 * The migration added `bubble_synced_at` as NULL for every row, so without this
 * script the first live run treats the ENTIRE archive as new and pushes it to
 * Bubble — duplicating the records that are already there.
 *
 * What it does:
 *  1. Reads every existing record of the Bubble data type (paged via cursor)
 *     and indexes it by its "Link Source URL".
 *  2. Matches unsynced Supabase articles against that index by normalised URL.
 *  3. Stamps the matches with `bubble_synced_at` (= now) and the Bubble `_id`,
 *     so the sync job skips exactly the articles that already exist there.
 *  4. Optionally (--cutoff=<ISO date>) stamps every REMAINING unsynced article
 *     created before that date, without a bubble_id — the "do not push the old
 *     archive at all" switch. Those rows are marked with a comment-free NULL
 *     bubble_id, which is how a backfilled row is told apart from a synced one.
 *
 * Safety: dry run by default. Nothing is written unless --apply is passed.
 * Idempotent: rows that already carry a bubble_synced_at are never touched.
 *
 * Target safety (NEWS-19, B-12): a stamp written from the TEST database carries
 * a test `_id` and locks the article out of the LIVE database forever — the sync
 * job will never push it again. Writing therefore requires naming the target
 * explicitly with --target=live|test, and it must match BUBBLE_USE_TEST_VERSION.
 * Stamping against the test database additionally requires --confirm-test-target.
 *
 * Two targets, not one: the Bubble app the ids are READ from, and the Supabase
 * project the stamps are WRITTEN to. A dev and a live Supabase are told apart
 * only by the project ref in NEXT_PUBLIC_SUPABASE_URL, so every run prints it
 * next to the Bubble environment — compare it against the dashboard URL before
 * passing --apply.
 *
 * Index safety (NEWS-19, B-13): the script only trusts an index it read to the
 * end. If Bubble still reports records after MAX_PAGES, or returns zero records
 * (an empty data type, or a Privacy Rule hiding it), the run aborts instead of
 * concluding "not in Bubble" for everything. A genuinely empty database can be
 * accepted with --allow-empty-index.
 *
 * Undo: every --apply writes a journal file (scripts/.backfill-journal-*.json)
 * listing exactly which rows it stamped. `--undo=<journal>` clears those stamps
 * again — the clean way back after a test run, before switching to live.
 *
 * Usage (from the project root, with .env.local present):
 *   node scripts/backfill-bubble-synced.mjs                      # dry run, report only
 *   node scripts/backfill-bubble-synced.mjs --apply --target=live
 *   node scripts/backfill-bubble-synced.mjs --apply --target=test --confirm-test-target
 *   node scripts/backfill-bubble-synced.mjs --cutoff=2026-09-22 --apply --target=live
 *   node scripts/backfill-bubble-synced.mjs --undo=scripts/.backfill-journal-....json
 *   node scripts/backfill-bubble-synced.mjs --apply --target=test --confirm-test-target --allow-empty-index
 *
 * Via npm the flags need a separating "--":
 *   npm run backfill:bubble -- --apply --target=live
 *
 * Env (same names as the sync job, read from .env.local or the shell):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   BUBBLE_API_BASE_URL, BUBBLE_API_TOKEN, BUBBLE_DATA_TYPE,
 *   BUBBLE_USE_TEST_VERSION (optional, "true" → /version-test)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

/** Bubble's Data API caps a page at 100 objects. */
const PAGE_SIZE = 100
/** Hard stop so a misconfigured endpoint cannot page forever. */
const MAX_PAGES = 200
/** Parallel stamp updates — same budget reasoning as the sync job. */
const STAMP_CONCURRENCY = 25
/** The Bubble field holding the article URL (see src/lib/bubble/mapping.ts). */
const BUBBLE_URL_FIELD = 'Link Source URL'

/** Load .env.local into process.env without overwriting real env vars. */
function loadEnvFile(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '')
  }
}

function parseArgs(argv) {
  const apply = argv.includes('--apply')
  const confirmTestTarget = argv.includes('--confirm-test-target')
  const allowEmptyIndex = argv.includes('--allow-empty-index')
  const cutoffArg = argv.find((arg) => arg.startsWith('--cutoff='))
  const cutoff = cutoffArg ? cutoffArg.slice('--cutoff='.length) : null
  const targetArg = argv.find((arg) => arg.startsWith('--target='))
  const target = targetArg ? targetArg.slice('--target='.length) : null
  const undoArg = argv.find((arg) => arg.startsWith('--undo='))
  const undo = undoArg ? undoArg.slice('--undo='.length) : null

  if (cutoff && Number.isNaN(Date.parse(cutoff))) {
    throw new Error(`--cutoff ist kein gültiges Datum: ${cutoff}`)
  }

  if (target && target !== 'live' && target !== 'test') {
    throw new Error(`--target muss "live" oder "test" sein, nicht: ${target}`)
  }

  return { apply, cutoff, target, confirmTestTarget, allowEmptyIndex, undo }
}

/**
 * Refuse to write until the operator has named the Bubble environment and it
 * matches the configuration (NEWS-19, B-12).
 *
 * A stamp is only meaningful for the database the ids came from. Stamping from
 * the test database silently excludes those articles from the live database for
 * good, so the test target needs a second, explicit confirmation.
 */
function assertTargetConfirmed({ target, confirmTestTarget }, useTestVersion) {
  const actual = useTestVersion ? 'test' : 'live'

  if (!target) {
    throw new Error(
      `--apply schreibt gegen die ${actual.toUpperCase()}-Datenbank. Ziel bitte ausdrücklich bestätigen: --target=${actual}`
    )
  }

  if (target !== actual) {
    throw new Error(
      `Ziel-Konflikt: --target=${target}, aber BUBBLE_USE_TEST_VERSION ergibt "${actual}". Es wird nichts geschrieben.`
    )
  }

  if (actual === 'test' && !confirmTestTarget) {
    throw new Error(
      'Stempel aus der TEST-Datenbank sperren die Artikel dauerhaft für die LIVE-Datenbank. ' +
        'Wenn das gewollt ist, zusätzlich --confirm-test-target setzen. ' +
        'Rückgängig machen lässt sich der Lauf danach mit --undo=<Journal-Datei>.'
    )
  }
}

/**
 * Refuse to act on an index that may not represent the Bubble database
 * (NEWS-19, B-13).
 *
 * Every conclusion this script draws is a conclusion from absence: an article
 * whose URL is missing from the index counts as "not in Bubble" and — in the
 * --cutoff branch — gets marked as synchronised without ever being pushed. That
 * inference is only valid if the index really is the complete database. Two
 * ways it silently is not:
 *   - the pager hit MAX_PAGES while Bubble still reported records remaining;
 *   - Bubble returned HTTP 200 with an empty `results` because a Privacy Rule
 *     hides the data type from this API token.
 * Truncation is never legitimate and always aborts. An empty database can be
 * legitimate (a fresh test app), so that case is overridable — but only
 * deliberately, via --allow-empty-index.
 */
function assertIndexTrustworthy({ index, total, complete }, allowEmptyIndex) {
  if (!complete) {
    throw new Error(
      `Bubble-Index unvollständig: nach ${MAX_PAGES} Seiten (${total} Records) meldet Bubble weitere Datensätze. ` +
        'Ein unvollständiger Index würde vorhandene Artikel als "nicht in Bubble" einstufen. ' +
        'Es wird nichts geschrieben — bitte MAX_PAGES erhöhen und erneut laufen lassen.'
    )
  }

  // NEWS-19, B-16: a full read whose records carry no usable URL is not an
  // index — it is a silent mismatch between BUBBLE_URL_FIELD and the field
  // Bubble actually returns (renamed, hidden by a Privacy Rule, or empty).
  // Every record present and none usable looks exactly like "nothing is in
  // Bubble", which is the premise the --cutoff branch acts on. Deliberately NOT
  // overridable by --allow-empty-index: that flag asserts an empty database,
  // and this database is demonstrably not empty.
  if (total > 0 && index.size === 0) {
    throw new Error(
      `Bubble-Index unbrauchbar: ${total} Records gelesen, aber kein einziger mit verwertbarer URL im Feld "${BUBBLE_URL_FIELD}". ` +
        'Vermutlich heisst das Feld in Bubble inzwischen anders, ist leer oder wird per Privacy Rule ausgeblendet. ' +
        'Es wird nichts geschrieben — bitte den Feldnamen pruefen (BUBBLE_URL_FIELD in diesem Skript und src/lib/bubble/mapping.ts).'
    )
  }

  // Below this share, the index is still usable but something is off with the
  // data — loud enough to notice, not fatal, because single bad records are
  // normal in a real database.
  const USABLE_URL_WARN_RATIO = 0.9
  if (total > 0 && index.size / total < USABLE_URL_WARN_RATIO) {
    const percent = Math.round((index.size / total) * 100)
    console.warn('!'.repeat(72))
    console.warn(
      `[Backfill] WARNUNG: nur ${index.size} von ${total} Bubble-Records (${percent} %) haben eine verwertbare URL.`
    )
    console.warn(
      `[Backfill] Artikel ohne Gegenstueck im Index gelten als "nicht in Bubble" — bei dieser Quote bitte pruefen, bevor --apply laeuft.`
    )
    console.warn('!'.repeat(72))
  }

  if (total === 0 && !allowEmptyIndex) {
    throw new Error(
      'Bubble-Index ist leer: 0 Records gelesen. Das ist entweder eine wirklich leere Datenbank ' +
        'oder eine Privacy Rule, die den Datentyp für dieses API-Token verbirgt (HTTP 200 mit leerem Ergebnis). ' +
        'Im zweiten Fall würde der --cutoff-Zweig den gesamten Altbestand als erledigt markieren, ohne dass er je übertragen wurde. ' +
        'Ist die Datenbank tatsächlich leer, mit --allow-empty-index erneut ausführen.'
    )
  }
}

/**
 * The Supabase project ref, i.e. the `<ref>` in https://<ref>.supabase.co — the
 * same id the dashboard shows after /project/, so the banner can be compared
 * against the browser tab at a glance.
 */
function supabaseProjectRef(url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url ?? '')
  return match ? match[1] : (url ?? 'unbekannt')
}

/**
 * Big, unmissable banner naming BOTH environments that are about to be touched.
 *
 * There are two independent targets here and they are easy to confuse: the
 * Bubble app the ids are read from, and the Supabase project the stamps are
 * written to. A dev Supabase and a live Supabase look identical on the command
 * line, so the project ref is printed next to the Bubble environment.
 */
function printTargetBanner(bubbleConfig, supabaseUrl, mode) {
  const environment = bubbleConfig.useTestVersion ? 'TEST (/version-test)' : 'LIVE'
  const line = '='.repeat(72)
  console.log(line)
  console.log(`[Backfill] BUBBLE-UMGEBUNG:  ${environment}`)
  console.log(`[Backfill] Bubble-URL:       ${bubbleConfig.baseUrl}${bubbleConfig.useTestVersion ? '/version-test' : ''}`)
  console.log(`[Backfill] Datentyp:         ${bubbleConfig.dataType}`)
  console.log(`[Backfill] SUPABASE-PROJEKT: ${supabaseProjectRef(supabaseUrl)}`)
  console.log(`[Backfill] Supabase-URL:     ${supabaseUrl}`)
  console.log(`[Backfill] Modus:            ${mode}`)
  console.log(line)
  console.log(
    '[Backfill] Bitte pruefen: ist das SUPABASE-PROJEKT oben dasselbe, das im Dashboard hinter /project/ steht?'
  )
  console.log(line)
}

/**
 * Record what was stamped so the run can be undone.
 *
 * The stamps are the only trace a backfill leaves, and from the outside a
 * backfilled row is indistinguishable from one the sync job wrote. The journal
 * closes that gap: it names the environment and the exact rows, which is what
 * makes a later test → live switch a mechanical revert instead of guesswork.
 */
function writeJournal(bubbleConfig, rows, syncedAt) {
  const path = resolve(
    process.cwd(),
    `scripts/.backfill-journal-${syncedAt.replace(/[:.]/g, '-')}.json`
  )
  const journal = {
    created_at: syncedAt,
    bubble_environment: bubbleConfig.useTestVersion ? 'test' : 'live',
    bubble_base_url: bubbleConfig.baseUrl,
    data_type: bubbleConfig.dataType,
    synced_at: syncedAt,
    rows: rows.map(({ id, bubbleId }) => ({ id, bubbleId })),
  }
  writeFileSync(path, JSON.stringify(journal, null, 2), 'utf8')
  return path
}

/**
 * Clear the stamps of a previous run, so the sync job picks those articles up
 * again. Only rows whose current stamp still matches the journal are touched —
 * anything the sync job has written in the meantime stays untouched.
 */
async function undoFromJournal(supabase, path) {
  const journal = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))
  const rows = journal.rows ?? []

  console.log(
    `[Backfill] UNDO: ${rows.length} Stempel aus dem Lauf vom ${journal.created_at} (Umgebung: ${journal.bubble_environment})`
  )

  let reverted = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i += STAMP_CONCURRENCY) {
    const chunk = rows.slice(i, i + STAMP_CONCURRENCY)
    const outcomes = await Promise.all(
      chunk.map(async ({ id, bubbleId }) => {
        let query = supabase
          .from('articles')
          .update({ bubble_synced_at: null, bubble_id: null })
          .eq('id', id)
          .eq('bubble_synced_at', journal.synced_at)

        query = bubbleId === null ? query.is('bubble_id', null) : query.eq('bubble_id', bubbleId)

        const { data, error } = await query.select('id')
        return { id, error, hit: (data ?? []).length > 0 }
      })
    )

    for (const { id, error, hit } of outcomes) {
      if (error) {
        console.error(`[Backfill] UNDO fehlgeschlagen für ${id}: ${error.message}`)
        continue
      }
      if (hit) reverted++
      else skipped++
    }
  }

  console.log(
    `[Backfill] UNDO fertig: ${reverted} zurückgesetzt, ${skipped} unverändert (Stempel stammt nicht aus diesem Lauf)`
  )
}

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Fehlende Umgebungsvariable: ${name}`)
  return value
}

/**
 * Normalise a URL for comparison: Supabase and Bubble store the same article
 * with cosmetic differences (trailing slash, tracking fragment, host casing).
 * Query parameters are kept — they often carry the article id.
 */
function normaliseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value.trim())
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.protocol = 'https:'
    const normalised = url.toString()
    return normalised.endsWith('/') ? normalised.slice(0, -1) : normalised
  } catch {
    return value.trim().toLowerCase()
  }
}

function buildListUrl(baseUrl, dataType, useTestVersion, cursor) {
  const versionPath = useTestVersion ? '/version-test' : ''
  return `${baseUrl}${versionPath}/api/1.1/obj/${dataType}?limit=${PAGE_SIZE}&cursor=${cursor}`
}

/** Read every record of the data type, returning normalisedUrl → Bubble _id. */
async function loadBubbleIndex({ baseUrl, apiToken, dataType, useTestVersion }) {
  const index = new Map()
  let cursor = 0
  let total = 0
  // Only a loop that ran out of records — not one that ran out of pages —
  // produces an index that is safe to draw conclusions from (NEWS-19, B-13).
  let complete = false

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(buildListUrl(baseUrl, dataType, useTestVersion, cursor), {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(30_000),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Bubble API ${response.status}: ${text.slice(0, 500)}`)
    }

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`Bubble-Antwort ist kein JSON: ${text.slice(0, 200)}`)
    }

    const results = payload?.response?.results
    if (!Array.isArray(results)) {
      throw new Error(`Unerwartete Bubble-Antwort: ${text.slice(0, 200)}`)
    }

    for (const record of results) {
      const key = normaliseUrl(record?.[BUBBLE_URL_FIELD])
      if (!key) continue
      // First record wins: if Bubble already holds duplicates, keep the oldest
      // id rather than overwriting it with the newer copy.
      if (!index.has(key)) index.set(key, record?._id ?? null)
    }

    total += results.length
    // NEWS-19, B-17: `?? 0` turned a MISSING field into "nothing left to read",
    // so a changed response shape or a proxy that drops `remaining` would stop
    // the pager after one page and call the result complete. Only an explicit
    // number may end the loop; anything else keeps paging until Bubble runs out
    // of records on its own.
    const remaining = payload?.response?.remaining
    const remainingKnown = typeof remaining === 'number'
    cursor += results.length

    console.log(
      `[Backfill] Bubble-Seite ${page + 1}: ${results.length} Records, ` +
        (remainingKnown ? `${remaining} verbleibend` : 'Feld "remaining" fehlt in der Antwort')
    )

    // An empty page is Bubble's own end-of-data signal and needs no `remaining`.
    if (results.length === 0 || (remainingKnown && remaining <= 0)) {
      complete = true
      break
    }
  }

  console.log(`[Backfill] ${total} Bubble-Records gelesen, ${index.size} mit eindeutiger URL`)
  return { index, total, complete }
}

/** Every article that the sync job would currently push, oldest first. */
async function loadUnsyncedArticles(supabase) {
  const articles = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, url, title, created_at')
      .is('bubble_synced_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Artikel konnten nicht geladen werden: ${error.message}`)
    if (!data || data.length === 0) break

    articles.push(...data)
    if (data.length < pageSize) break
  }

  return articles
}

/** Apply the stamps in parallel chunks; returns the number of failures. */
async function stamp(supabase, rows, syncedAt) {
  let failed = 0

  for (let i = 0; i < rows.length; i += STAMP_CONCURRENCY) {
    const chunk = rows.slice(i, i + STAMP_CONCURRENCY)
    const outcomes = await Promise.all(
      chunk.map(async ({ id, bubbleId }) => {
        const { error } = await supabase
          .from('articles')
          .update({ bubble_synced_at: syncedAt, bubble_id: bubbleId })
          .eq('id', id)
          // Never overwrite a stamp the sync job has already set.
          .is('bubble_synced_at', null)
        return { id, error }
      })
    )

    for (const { id, error } of outcomes) {
      if (error) {
        failed++
        console.error(`[Backfill] Stempel fehlgeschlagen für ${id}: ${error.message}`)
      }
    }
  }

  return failed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { apply, cutoff } = args
  loadEnvFile(resolve(process.cwd(), '.env.local'))

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabase = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const bubbleConfig = {
    baseUrl: requireEnv('BUBBLE_API_BASE_URL').replace(/\/+$/, ''),
    apiToken: requireEnv('BUBBLE_API_TOKEN'),
    dataType: requireEnv('BUBBLE_DATA_TYPE'),
    useTestVersion: process.env.BUBBLE_USE_TEST_VERSION === 'true',
  }

  if (args.undo) {
    printTargetBanner(bubbleConfig, supabaseUrl, `UNDO (${args.undo})`)
    await undoFromJournal(supabase, args.undo)
    return
  }

  printTargetBanner(bubbleConfig, supabaseUrl, apply ? 'APPLY (schreibt)' : 'DRY RUN (schreibt nicht)')

  // Fail before a single Bubble page is read: a wrong target must never get as
  // far as writing (NEWS-19, B-12).
  if (apply) assertTargetConfirmed(args, bubbleConfig.useTestVersion)

  const [bubbleResult, articles] = await Promise.all([
    loadBubbleIndex(bubbleConfig),
    loadUnsyncedArticles(supabase),
  ])

  // Checked in dry run too: a report built on a truncated index is as
  // misleading as a write built on one (NEWS-19, B-13).
  assertIndexTrustworthy(bubbleResult, args.allowEmptyIndex)
  const bubbleIndex = bubbleResult.index

  console.log(`[Backfill] ${articles.length} Artikel ohne bubble_synced_at`)

  const matches = []
  const unmatched = []

  for (const article of articles) {
    const key = normaliseUrl(article.url)
    if (key && bubbleIndex.has(key)) {
      matches.push({ id: article.id, bubbleId: bubbleIndex.get(key), title: article.title })
    } else {
      unmatched.push(article)
    }
  }

  const cutoffTime = cutoff ? Date.parse(cutoff) : null
  const cutoffRows = cutoffTime
    ? unmatched
        .filter((article) => Date.parse(article.created_at) < cutoffTime)
        .map((article) => ({ id: article.id, bubbleId: null, title: article.title }))
    : []

  console.log(`[Backfill] URL-Treffer in Bubble: ${matches.length}`)
  console.log(
    `[Backfill] Ohne Treffer: ${unmatched.length}` +
      (cutoff ? ` — davon vor ${cutoff}: ${cutoffRows.length} (werden als synchronisiert markiert)` : '')
  )
  console.log(
    `[Backfill] Nach dem Lauf würde der Sync noch ${unmatched.length - cutoffRows.length} Artikel übertragen`
  )

  for (const row of matches.slice(0, 10)) {
    console.log(`  Treffer: ${row.title} → ${row.bubbleId}`)
  }
  if (matches.length > 10) console.log(`  … und ${matches.length - 10} weitere`)

  const rows = [...matches, ...cutoffRows]

  if (!apply) {
    console.log(
      `[Backfill] Dry run beendet — mit --apply --target=${bubbleConfig.useTestVersion ? 'test --confirm-test-target' : 'live'} erneut ausführen, um zu schreiben.`
    )
    return
  }

  if (rows.length === 0) {
    console.log('[Backfill] Nichts zu stempeln.')
    return
  }

  const syncedAt = new Date().toISOString()
  const journalPath = writeJournal(bubbleConfig, rows, syncedAt)
  console.log(`[Backfill] Journal geschrieben: ${journalPath}`)

  const failed = await stamp(supabase, rows, syncedAt)
  console.log(`[Backfill] Fertig: ${rows.length - failed} gestempelt, ${failed} fehlgeschlagen`)
  console.log(`[Backfill] Rückgängig machen: node scripts/backfill-bubble-synced.mjs --undo=${journalPath}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[Backfill] Abgebrochen:', err instanceof Error ? err.message : err)
  process.exit(1)
})
