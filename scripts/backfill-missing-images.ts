#!/usr/bin/env tsx
/**
 * NEWS-21: fill `articles.image_url` for rows that have none, using the same
 * og:image / twitter:image fallback chain the scheduler uses.
 *
 * This is a thin CLI. All logic lives in `src/lib/backfill/missing-images.ts`,
 * which is why this file is TypeScript and run through `tsx`: a `.mjs` script
 * would have to re-implement the extraction, and the two copies would drift —
 * defeating the whole point of "the same fallback chain".
 *
 * Two phases, invoked separately:
 *
 *   FILL    (default)  Refetches each affected article's OWN page and sets
 *                      `image_url` where a usable value was found. Dry run
 *                      unless --apply. Never inserts, never deletes, never
 *                      touches a row that already has an image.
 *
 *   RESYNC  (--resync) Clears `bubble_synced_at` / `bubble_id` for exactly the
 *                      rows a previous --apply filled, so the next scheduled
 *                      Bubble sync re-creates them WITH the image. Only ever
 *                      against the Bubble development database — see the guard
 *                      in the core module.
 *
 * Usage (from the project root, with .env.local present):
 *   npm run backfill:images                                   # dry run
 *   npm run backfill:images -- --apply
 *   npm run backfill:images -- --apply --limit=10
 *   npm run backfill:images -- --resync --list
 *   npm run backfill:images -- --resync --apply --journal=scripts/.image-backfill-journal-....json
 *
 * Env (read from .env.local or the shell):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   BUBBLE_API_BASE_URL, BUBBLE_API_TOKEN, BUBBLE_DATA_TYPE,
 *   BUBBLE_USE_TEST_VERSION   (only --resync reads these)
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getBubbleConfig } from '../src/lib/bubble/client'
import {
  RESYNC_PROCEDURE,
  applyResync,
  assertJournalMatchesSupabaseTarget,
  assertResyncTargetIsTestBubble,
  buildJournal,
  createBackfillClient,
  loadResyncTargets,
  parseBackfillCliArgs,
  readJournalFile,
  runFill,
  writeJournalFile,
  type BackfillCliArgs,
} from '../src/lib/backfill/missing-images'

// ---- Environment ----

/** Load .env.local into process.env without overwriting real env vars. */
function loadEnvFile(path: string): void {
  let raw: string
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

/** The `<ref>` in https://<ref>.supabase.co — the id the dashboard shows. */
function supabaseProjectRef(url: string | undefined): string {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url ?? '')
  return match ? match[1] : (url ?? 'unbekannt')
}

// ---- Arguments ----
// Parsing and mode/flag validation live in the core module
// (parseBackfillCliArgs), where they are unit-tested; this wrapper only
// consumes the result.

/** Usage text for --help — the six-step procedure follows it. */
const USAGE = [
  'Verwendung: npm run backfill:images -- [Optionen]',
  '',
  '  Fill-Phase (Standard):',
  '    (keine Option)          Dry run — zeigt nur an, was passieren wuerde',
  '    --apply                 setzt image_url, schreibt ein Journal',
  '    --limit=<n>             verarbeitet hoechstens n Kandidaten (nur Fill-Phase)',
  '',
  '  Resync-Phase (separat aufzurufen):',
  '    --resync --list         listet die bubble_ids der gefuellten, gestempelten Artikel',
  '    --resync --apply        setzt bubble_synced_at / bubble_id dieser Artikel zurueck',
  '    --journal=<Datei>       Journal einer frueheren --apply-Fuellung (Standard: neuestes)',
  '',
  '    --resync laeuft AUSSCHLIESSLICH gegen die Bubble-ENTWICKLUNGS-Datenbank',
  '    (BUBBLE_USE_TEST_VERSION=true) — es gibt keinen Schalter, der das aufhebt.',
  '',
  '  --help                    diese Hilfe',
].join('\n')

/** Newest journal in scripts/, so --journal can be omitted in the common case. */
function newestJournalPath(): string {
  const dir = resolve(process.cwd(), 'scripts')
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith('.image-backfill-journal-') && name.endsWith('.json'))
    .sort()

  if (candidates.length === 0) {
    throw new Error(
      'Kein Journal gefunden. Zuerst "npm run backfill:images -- --apply" ausfuehren, ' +
        'oder das Journal mit --journal=<Datei> angeben.'
    )
  }

  return resolve(dir, candidates[candidates.length - 1])
}

// ---- Banner ----

function printBanner(mode: string): void {
  const config = getBubbleConfig()
  const bubble = config
    ? `${config.useTestVersion ? 'TEST (/version-test)' : 'LIVE'} — ${config.baseUrl} / ${config.dataType}`
    : 'nicht konfiguriert'

  const line = '='.repeat(72)
  console.log(line)
  console.log(`[Backfill] MODUS:            ${mode}`)
  console.log(`[Backfill] SUPABASE-PROJEKT: ${supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL)}`)
  console.log(`[Backfill] Supabase-URL:     ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`[Backfill] BUBBLE-UMGEBUNG:  ${bubble}`)
  console.log(line)
  console.log(
    '[Backfill] Bitte pruefen: ist das SUPABASE-PROJEKT oben dasselbe, das im Dashboard hinter /project/ steht?'
  )
  console.log(line)
  console.log(RESYNC_PROCEDURE)
  console.log(line)
}

// ---- Phases ----

async function runFillPhase(args: BackfillCliArgs): Promise<void> {
  printBanner(args.apply ? 'FILL — APPLY (schreibt image_url)' : 'FILL — DRY RUN (schreibt nicht)')

  const supabase = createBackfillClient()
  const report = await runFill({
    supabase,
    apply: args.apply,
    limit: args.limit ?? undefined,
  })

  console.log(
    `[Backfill] ${report.scanned} geprueft, ${report.found} mit verwertbarem Bild, ` +
      `${report.updated} geschrieben, ${report.skipped_already_filled} inzwischen anderweitig gefuellt`
  )

  for (const failure of report.failures) {
    console.error(`[Backfill] ${failure}`)
  }

  if (!args.apply) {
    console.log(
      `[Backfill] Dry run beendet — ${report.rows.length} Artikel wuerden ein Bild bekommen. ` +
        'Mit --apply erneut ausfuehren, um zu schreiben.'
    )
    return
  }

  if (report.rows.length === 0) {
    console.log('[Backfill] Nichts geschrieben — kein Journal noetig.')
    if (report.failures.length > 0) process.exitCode = 1
    return
  }

  const journal = buildJournal(report.rows, process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'unbekannt')
  const journalPath = writeJournalFile(journal)
  console.log(`[Backfill] Journal geschrieben: ${journalPath}`)

  const stamped = report.rows.filter((row) => row.bubble_synced_at !== null).length
  if (stamped > 0) {
    console.log(
      `[Backfill] ACHTUNG: ${stamped} der gefuellten Artikel sind bereits in Bubble. ` +
        'Bubble wird durch das Fuellen NICHT aktualisiert (es gibt keinen PATCH-Pfad). ' +
        `Weiter mit Schritt 3: npm run backfill:images -- --resync --list --journal=${journalPath}`
    )
  }

  if (report.failures.length > 0) process.exitCode = 1
}

async function runResyncPhase(args: BackfillCliArgs): Promise<void> {
  const mode = args.apply ? 'RESYNC — APPLY (setzt Sync-Stempel zurueck)' : 'RESYNC — LIST (schreibt nicht)'
  printBanner(mode)

  // Before a single row is read: a wrong Bubble target must never get as far as
  // listing, let alone writing.
  assertResyncTargetIsTestBubble()

  const journalPath = args.journal ?? newestJournalPath()
  const journal = readJournalFile(journalPath)

  // Review B-4: the journal's row ids are only meaningful inside the Supabase
  // project they were filled in — a journal from another project aborts hard.
  assertJournalMatchesSupabaseTarget(journal)

  console.log(
    `[Backfill] Journal: ${journalPath} (${journal.rows.length} gefuellte Artikel, ` +
      `Umgebung beim Fuellen: ${journal.bubble_environment})`
  )

  const supabase = createBackfillClient()
  const targets = await loadResyncTargets(supabase, journal)

  console.log(`[Backfill] ${targets.length} davon tragen aktuell einen Bubble-Sync-Stempel`)

  if (targets.length === 0) {
    console.log('[Backfill] Nichts zu tun — kein gefuellter Artikel ist bereits in Bubble.')
    return
  }

  if (!args.apply) {
    console.log(
      '[Backfill] Diese Bubble-Records in der ENTWICKLUNGS-Datenbank loeschen (Schritt 4), danach --resync --apply:'
    )
    for (const target of targets) {
      console.log(`  ${target.bubble_id ?? '(kein bubble_id — nie uebertragen)'}  ${target.title}`)
    }
    return
  }

  const report = await applyResync(supabase, targets)
  console.log(
    `[Backfill] Stempel zurueckgesetzt: ${report.cleared}, unveraendert: ${report.skipped} ` +
      '(Stempel hat sich zwischenzeitlich geaendert)'
  )
  for (const failure of report.failures) {
    console.error(`[Backfill] ${failure}`)
  }
  console.log('[Backfill] Der naechste planmaessige Sync (06:00 UTC) legt die Records neu an — mit Bild.')

  if (report.failures.length > 0) process.exitCode = 1
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = parseBackfillCliArgs(process.argv.slice(2))

  if (args.help) {
    console.log(USAGE)
    console.log('')
    console.log(RESYNC_PROCEDURE)
    return // exit 0 — asking for help is never an error
  }

  loadEnvFile(resolve(process.cwd(), '.env.local'))

  if (args.resync) {
    await runResyncPhase(args)
    return
  }

  await runFillPhase(args)
}

main().catch((err: unknown) => {
  console.error('[Backfill] Abgebrochen:', err instanceof Error ? err.message : err)
  process.exit(1)
})
