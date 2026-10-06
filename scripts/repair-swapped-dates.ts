#!/usr/bin/env tsx
/**
 * NEWS-23: report (and, one row at a time, correct) `published_at` values
 * damaged by the day/month swap the parser fix closed.
 *
 * This is a thin CLI. All logic lives in `src/lib/backfill/swapped-dates.ts`,
 * which is why this file is TypeScript and run through `tsx` — the candidate
 * predicate and the apply-time re-validation are unit-tested there, and the
 * swapped-reading helper is shared with the parser module instead of being
 * re-implemented here.
 *
 * Two modes, deliberately asymmetric:
 *
 *   REPORT  (default)  Lists every candidate with both readings (stored and
 *                      day↔month swapped). Writes nothing. A candidate is an
 *                      article of an HTML source with `selector_date`, scraped
 *                      before the fix deploy, whose `published_at` lies in the
 *                      future relative to `created_at` and whose day ≠ month.
 *
 *   APPLY   (--apply --id=<uuid>)
 *                      Corrects exactly ONE row per invocation, after
 *                      re-validating all candidate criteria against the live
 *                      row. There is NO bulk apply and NO automatic branch —
 *                      a genuine swap victim and a genuine future-dated
 *                      announcement are indistinguishable without the raw
 *                      date string, which is stored nowhere (spec, round 3).
 *
 * Usage (from the project root, with .env.local present):
 *   npm run repair:dates -- --deployed-before=2026-10-07T12:00:00Z
 *   npm run repair:dates -- --deployed-before=2026-10-07T12:00:00Z --apply --id=<uuid>
 *
 * Env (read from .env.local or the shell):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applySwapRepair,
  createRepairClient,
  parseRepairCliArgs,
  runSwapReport,
  type RepairCliArgs,
} from '../src/lib/backfill/swapped-dates'

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
// Parsing and the refusal rules (--deployed-before mandatory, --apply only
// with --id, no bulk apply) live in the core module (parseRepairCliArgs),
// where they are unit-tested; this wrapper only consumes the result.

/** Usage text for --help. */
const USAGE = [
  'Verwendung: npm run repair:dates -- --deployed-before=<ISO> [Optionen]',
  '',
  '  --deployed-before=<ISO>   PFLICHT: Zeitstempel des NEWS-23-Fix-Deploys.',
  '                            Nur Artikel mit created_at davor sind Kandidaten.',
  '',
  '  Report-Modus (Standard):',
  '    (keine weitere Option)  listet alle Kandidaten mit gespeicherter und',
  '                            getauschter Lesart — schreibt nichts',
  '',
  '  Apply-Modus (eine Zeile pro Aufruf):',
  '    --apply --id=<uuid>     korrigiert GENAU diesen Artikel, nach erneuter',
  '                            Pruefung aller Kriterien; gibt vorher/nachher aus',
  '',
  '    Es gibt keinen Massen-Apply und keinen Automatik-Zweig: ein echtes',
  '    Dreher-Opfer und eine echte vordatierte Ankuendigung sind ohne den',
  '    rohen Datums-String (nirgends gespeichert) nicht unterscheidbar.',
  '',
  '  --help                    diese Hilfe',
].join('\n')

// ---- Banner ----

function printBanner(mode: string, deployedBefore: string): void {
  const line = '='.repeat(72)
  console.log(line)
  console.log(`[Repair] MODUS:            ${mode}`)
  console.log(`[Repair] SUPABASE-PROJEKT: ${supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL)}`)
  console.log(`[Repair] Supabase-URL:     ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`[Repair] FIX-DEPLOY:       created_at < ${deployedBefore}`)
  console.log(line)
  console.log(
    '[Repair] Bitte pruefen: ist das SUPABASE-PROJEKT oben dasselbe, das im Dashboard hinter /project/ steht?'
  )
  console.log(line)
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args: RepairCliArgs = parseRepairCliArgs(process.argv.slice(2))

  if (args.help) {
    console.log(USAGE)
    return // exit 0 — asking for help is never an error
  }

  loadEnvFile(resolve(process.cwd(), '.env.local'))

  const deployedBefore = new Date(args.deployedBefore!)

  if (args.apply) {
    printBanner(`APPLY — korrigiert genau eine Zeile (id=${args.id})`, args.deployedBefore!)
    const supabase = createRepairClient()
    await applySwapRepair({ supabase, id: args.id!, deployedBefore })
    return
  }

  printBanner('REPORT — schreibt nichts', args.deployedBefore!)
  const supabase = createRepairClient()
  const candidates = await runSwapReport({ supabase, deployedBefore })

  if (candidates.length === 0) {
    console.log('[Repair] Keine Kandidaten — nichts zu beurteilen.')
  }
}

main().catch((err: unknown) => {
  console.error('[Repair] Abgebrochen:', err instanceof Error ? err.message : err)
  process.exit(1)
})
