/**
 * NEWS-23: testable core of the swapped-date repair — report-only by default,
 * every single correction manually approved.
 *
 * What it repairs: before the NEWS-23 parser fix, a German day-first date with
 * day <= 12 was read month-first (`11.08.2026` → 8 November), so HTML sources
 * with a `selector_date` stored `published_at` values months in the FUTURE.
 * Those rows escape the retention sweep (it deletes by age) and every
 * `from`/`to` date-window query, so they sit in the database until someone
 * happens to look.
 *
 * What it deliberately does NOT do:
 *
 *  - **No automatic correction, no bulk apply.** Review round 3 proved the
 *    auto branch mathematically dead: a genuine V8/chrono-en swap stores
 *    month = the original day (<= 12, or the native parse had failed) and
 *    day = the original month (<= 12 by definition) — so EVERY real swap
 *    victim has a swapped reading with day <= 12 and is indistinguishable
 *    from a genuine future-dated announcement (`08.10.` scraped on 05.10.)
 *    without the raw date string, which is stored nowhere. With a handful of
 *    affected rows, per-row human approval is cheap and the only correct
 *    option: `--apply --id=<uuid>` corrects exactly one row per invocation,
 *    re-validated against all candidate criteria at apply time.
 *  - **No deletion.** Approved rows are corrected in place; nothing else is
 *    touched.
 *
 * Two caveats are printed on EVERY run (and asserted by tests), because
 * omitting them would oversell what the repair achieves — see REPAIR_NOTES.
 */

import { createClient } from '@supabase/supabase-js'
import { swappedDateReading } from '@/lib/scraping/parse-date'

// ---- Configuration ----

/** Rows per Supabase page while listing the candidates. */
export const CANDIDATE_PAGE_SIZE = 500

// ---- Types ----

/**
 * Derived from the factory below rather than from `createClient` itself —
 * the same pattern `missing-images.ts` uses for its admin client.
 */
type AdminClient = ReturnType<typeof createRepairClient>

/** An article row as the candidate query returns it, source joined in. */
export interface RepairArticleRow {
  id: string
  title: string
  url: string
  published_at: string
  created_at: string
  source: {
    name: string
    type: string
    selector_date: string | null
  } | null
}

/** A row the report lists: both readings side by side, for a human to judge. */
export interface SwapCandidate {
  id: string
  title: string
  url: string
  source_name: string
  created_at: string
  /** The stored (possibly swapped) value. */
  published_at: string
  /** The day↔month exchange of the stored value — what the fix would have parsed. */
  swapped_published_at: string
}

/** Outcome of one approved correction. */
export interface ApplyResult {
  id: string
  title: string
  url: string
  source_name: string
  before: string
  after: string
}

// ---- Mandatory output notes ----

/**
 * Printed on every run, report and apply alike. Both are spec'd acceptance
 * criteria, not footnotes:
 *
 *  (a) the dark figure — a swap that happened to land in the PAST
 *      (`03.04.2026` read as 4 March) produces `published_at <= created_at`
 *      and is therefore invisible to the candidate query; the raw date string
 *      is stored nowhere, so no query can tell such a row from a correct one.
 *      Depending on the scrape month this hides most swap victims.
 *  (b) the Bubble limitation — the sync is create-only (no PATCH path, see
 *      the NEWS-21 follow-up note), so records already pushed to Bubble keep
 *      their wrong "Date publishing" regardless of what this script corrects
 *      in Supabase.
 */
export const REPAIR_NOTES = [
  '[Repair] DUNKELZIFFER: Dieses Skript findet nur Dreher, die in der ZUKUNFT gelandet sind ' +
    '(published_at > created_at). Dreher, die zufaellig in der Vergangenheit gelandet sind ' +
    '(z.B. 03.04. als 4. Maerz gelesen), sind NICHT auffindbar — der rohe Datums-String ist ' +
    'nirgends gespeichert. Je nach Scrape-Monat verbirgt das die Mehrzahl der Faelle. ' +
    'Die Korrektheit ab jetzt kommt vom Parser-Fix (NEWS-23), nicht von dieser Reparatur.',
  '[Repair] BUBBLE-LIMITATION: Bereits nach Bubble synchronisierte Records behalten ihr ' +
    'falsches "Date publishing" — der Sync kennt nur CREATE, keinen PATCH-Pfad (siehe ' +
    'NEWS-21-Folgenotiz). Diese Reparatur korrigiert Supabase; Bubble zieht erst nach, ' +
    'wenn der PATCH-Ticket existiert oder ein Record nach dem Fix neu synchronisiert wird.',
]

/** Emit the mandatory caveats. Called by both run functions, never skipped. */
export function printRepairNotes(log: (message: string) => void): void {
  for (const note of REPAIR_NOTES) log(note)
}

// ---- Supabase ----

/**
 * Service-role client. The repair writes `articles`, which only `service_role`
 * may do (RLS grants admins DELETE on articles, never INSERT/UPDATE).
 */
export function createRepairClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Fehlende Umgebungsvariable: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// ---- Candidate predicate ----

/**
 * Decide whether a row is a repair candidate, and compute its swapped reading.
 *
 * All criteria in one pure function, because it runs TWICE: over every row the
 * report lists, and again — against a freshly read row — when a single id is
 * applied. A row that stopped matching between report and apply (a concurrent
 * edit, a wrong `--deployed-before`) is refused at apply time, not corrected
 * on the strength of a stale report.
 *
 * The criteria, each with its reason:
 *
 *  - HTML source with a `selector_date`: only that path ran the defective
 *    parser. RSS sources and HTML sources without a date selector always got
 *    the scrape timestamp or an RFC 822 date — out of scope.
 *  - `created_at` strictly before the fix deploy: rows scraped after the
 *    deploy were parsed correctly; a future date there is a genuine
 *    announcement, not damage.
 *  - `published_at` strictly after `created_at`: the swap's signature. An
 *    article cannot normally be scraped before it was published; the inverse
 *    (swap landed in the past) is the documented dark figure.
 *  - a defined swapped reading (see `swappedDateReading`): excludes
 *    day == month (swap-invariant — nothing to decide, must never be
 *    flagged), day > 12 (the swapped month would not exist, so the row was
 *    never a swap victim) and invalid exchanges.
 */
export function evaluateSwapCandidate(
  row: RepairArticleRow,
  deployedBefore: Date
): SwapCandidate | null {
  if (!row.source || row.source.type !== 'html' || !row.source.selector_date) return null

  const created = new Date(row.created_at)
  const published = new Date(row.published_at)
  if (Number.isNaN(created.getTime()) || Number.isNaN(published.getTime())) return null

  if (created.getTime() >= deployedBefore.getTime()) return null
  if (published.getTime() <= created.getTime()) return null

  const swapped = swappedDateReading(row.published_at)
  if (!swapped) return null

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source_name: row.source.name,
    created_at: row.created_at,
    published_at: row.published_at,
    swapped_published_at: swapped,
  }
}

// ---- Report (default mode) ----

/**
 * Load every candidate, oldest first.
 *
 * The join is server-side (no N+1): source type and `selector_date` are
 * filtered in the query where PostgREST can, and `evaluateSwapCandidate`
 * re-checks EVERYTHING client-side — the column-to-column comparison
 * (`published_at > created_at`) and the swapped reading cannot be expressed
 * server-side anyway, and one predicate for both report and apply beats two
 * half-predicates that could drift apart.
 */
export async function loadSwapCandidates(
  supabase: AdminClient,
  deployedBefore: Date,
  pageSize: number = CANDIDATE_PAGE_SIZE
): Promise<SwapCandidate[]> {
  const candidates: SwapCandidate[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, title, url, published_at, created_at, source:sources!inner(name, type, selector_date)')
      .eq('source.type', 'html')
      .not('source.selector_date', 'is', null)
      .lt('created_at', deployedBefore.toISOString())
      .order('created_at', { ascending: true })
      // Tiebreaker (QA BUG-5): batch inserts share a created_at to the
      // millisecond, and without a total order such ties may shuffle between
      // pages — a row could be listed twice or skipped at a page boundary.
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) {
      throw new Error(`Kandidaten konnten nicht geladen werden: ${error.message}`)
    }

    const page = (data ?? []) as unknown as RepairArticleRow[]
    for (const row of page) {
      const candidate = evaluateSwapCandidate(row, deployedBefore)
      if (candidate) candidates.push(candidate)
    }
    if (page.length < pageSize) break
  }

  return candidates
}

/**
 * One report line per candidate — everything the human needs to judge.
 *
 * Control characters are flattened to spaces (QA BUG-4): title and URL are
 * scraped text, and a newline in a title would let one row forge additional
 * report lines — the report is exactly what a human approves ids FROM, so a
 * forged line is a forged approval basis. One candidate, one line, always.
 */
export function formatCandidateLine(candidate: SwapCandidate): string {
  const line =
    `[Repair] id=${candidate.id}  Quelle="${candidate.source_name}"  ` +
    `gescrapt=${candidate.created_at}  gespeichert=${candidate.published_at}  ` +
    `getauscht=${candidate.swapped_published_at}  "${candidate.title}"  ${candidate.url}`
  // All of C0 (incl. \n \r \t) plus DEL, collapsed runs into one space.
  return line.replace(/[\u0000-\u001F\u007F]+/g, ' ')
}

/**
 * Report mode: list the candidates, write nothing.
 */
export async function runSwapReport(options: {
  supabase: AdminClient
  deployedBefore: Date
  log?: (message: string) => void
}): Promise<SwapCandidate[]> {
  const log = options.log ?? ((message: string) => console.log(message))

  printRepairNotes(log)

  const candidates = await loadSwapCandidates(options.supabase, options.deployedBefore)

  log(
    `[Repair] ${candidates.length} Kandidat(en) gefunden ` +
      `(HTML-Quelle mit selector_date, created_at < ${options.deployedBefore.toISOString()}, ` +
      'published_at > created_at, Tag ≠ Monat). Nichts geschrieben.'
  )

  for (const candidate of candidates) {
    log(formatCandidateLine(candidate))
  }

  if (candidates.length > 0) {
    log(
      '[Repair] Pro Zeile pruefen: Dreher-Opfer oder echte vordatierte Ankuendigung? ' +
        'Korrektur einzeln mit: --apply --id=<uuid> (zusammen mit --deployed-before wie oben).'
    )
  }

  return candidates
}

// ---- Apply (one row, re-validated) ----

/**
 * Correct exactly ONE approved row.
 *
 * The row is re-read and re-validated against the full candidate predicate at
 * apply time — a stale report is never trusted. The UPDATE matches the stored
 * `published_at` in its WHERE clause, so a value that changed between the
 * re-read and the write (a concurrent correction, a manual edit) is never
 * clobbered; such a race surfaces as an error instead.
 */
export async function applySwapRepair(options: {
  supabase: AdminClient
  id: string
  deployedBefore: Date
  log?: (message: string) => void
}): Promise<ApplyResult> {
  const { supabase, id, deployedBefore } = options
  const log = options.log ?? ((message: string) => console.log(message))

  printRepairNotes(log)

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, url, published_at, created_at, source:sources!inner(name, type, selector_date)')
    .eq('id', id)
    .single()

  if (error || !data) {
    throw new Error(`Artikel ${id} konnte nicht geladen werden: ${error?.message ?? 'nicht gefunden'}`)
  }

  const row = data as unknown as RepairArticleRow
  const candidate = evaluateSwapCandidate(row, deployedBefore)
  if (!candidate) {
    throw new Error(
      `Artikel ${id} erfuellt die Kandidaten-Kriterien nicht (mehr) — nichts geschrieben. ` +
        'Kriterien: HTML-Quelle mit selector_date, created_at vor --deployed-before, ' +
        'published_at > created_at, Tag ≠ Monat, gueltige getauschte Lesart.'
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('articles')
    .update({ published_at: candidate.swapped_published_at })
    .eq('id', id)
    .eq('published_at', candidate.published_at)
    .select('id')

  if (updateError) {
    throw new Error(`UPDATE fehlgeschlagen fuer ${id}: ${updateError.message}`)
  }
  if ((updated ?? []).length === 0) {
    throw new Error(
      `published_at von ${id} hat sich seit dem Lesen geaendert — nichts geschrieben. ` +
        'Report erneut ausfuehren und neu beurteilen.'
    )
  }

  const result: ApplyResult = {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    source_name: candidate.source_name,
    before: candidate.published_at,
    after: candidate.swapped_published_at,
  }

  log(
    `[Repair] korrigiert: id=${result.id}  Quelle="${result.source_name}"  "${result.title}"  ` +
      `vorher=${result.before}  nachher=${result.after}`
  )

  return result
}

// ---- CLI arguments ----

/**
 * Parsed CLI options. Lives in the core (rather than the script) so the
 * refusal rules below are unit-testable — the wrapper only prints and
 * delegates. Same split as `missing-images.ts`.
 */
export interface RepairCliArgs {
  help: boolean
  apply: boolean
  id: string | null
  /** Validated ISO timestamp of the fix deploy — mandatory, never hardcoded. */
  deployedBefore: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Strict ISO 8601 for `--deployed-before`: date-only, or date + time with an
 * explicit Z / offset. Everything else is refused.
 *
 * QA BUG-3 showed why a naive `new Date()` check is not a validation here:
 * it happily accepted `11.08.2026` — and read it US-style month-first, the
 * day/month swap INSIDE the very tool that exists to repair that swap. It
 * also accepted `2026`, `0` and `Oct 7 2026`, each silently widening or
 * narrowing the candidate window.
 */
const ISO_DEPLOYED_BEFORE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/

/**
 * Parse and validate the CLI arguments.
 *
 * The refusals are the design, not pedantry:
 *
 *  - `--deployed-before=<ISO>` is MANDATORY. Hardcoding the deploy timestamp
 *    would rot; guessing it would widen or narrow the candidate set silently.
 *  - `--apply` without `--id` is refused — there is no bulk apply, by spec.
 *  - `--id` without `--apply` is refused: in report mode it would be silently
 *    ineffective, and an operator who typed it believed it would do something
 *    (the same rule `parseBackfillCliArgs` applies to its mode flags).
 *
 * `--help` wins over everything and skips validation: asking for help must
 * never error.
 */
export function parseRepairCliArgs(argv: string[]): RepairCliArgs {
  const valueOf = (name: string): string | null => {
    const prefix = `--${name}=`
    const arg = argv.find((candidate) => candidate.startsWith(prefix))
    return arg ? arg.slice(prefix.length) : null
  }

  const args: RepairCliArgs = {
    help: argv.includes('--help'),
    apply: argv.includes('--apply'),
    id: valueOf('id'),
    deployedBefore: null,
  }

  if (args.help) return args

  const unknown = argv.filter(
    (arg) =>
      arg.startsWith('--') &&
      !['--apply', '--help'].includes(arg) &&
      !arg.startsWith('--id=') &&
      !arg.startsWith('--deployed-before=')
  )
  if (unknown.length > 0) {
    throw new Error(`Unbekannte Option(en): ${unknown.join(', ')} — Hilfe mit --help`)
  }

  const rawDeployedBefore = valueOf('deployed-before')
  if (rawDeployedBefore === null) {
    throw new Error(
      '--deployed-before=<ISO-Zeitstempel> ist Pflicht: der Zeitpunkt des Fix-Deploys ' +
        'bestimmt, welche Zeilen ueberhaupt vom alten Parser stammen koennen. ' +
        'Beispiel: --deployed-before=2026-10-07T12:00:00Z'
    )
  }
  if (
    !ISO_DEPLOYED_BEFORE.test(rawDeployedBefore) ||
    Number.isNaN(new Date(rawDeployedBefore).getTime())
  ) {
    throw new Error(
      `--deployed-before ist kein gueltiger ISO-Zeitstempel: ${rawDeployedBefore} — ` +
        'erwartet wird striktes ISO 8601: YYYY-MM-DD oder YYYY-MM-DDTHH:mm:ss mit Z bzw. ±HH:MM. ' +
        'Insbesondere KEIN deutsches Datumsformat: "11.08.2026" wuerde month-first gelesen — ' +
        'exakt der Dreher, den dieses Werkzeug repariert.'
    )
  }
  args.deployedBefore = rawDeployedBefore

  if (args.apply && args.id === null) {
    throw new Error(
      '--apply ohne --id ist nicht erlaubt: es gibt keinen Massen-Apply. ' +
        'Jede Korrektur wird einzeln freigegeben: --apply --id=<uuid>.'
    )
  }
  if (!args.apply && args.id !== null) {
    throw new Error(
      '--id gehoert zu --apply und hat im Report-Modus keine Wirkung. ' +
        'Zum Korrigieren: --apply --id=<uuid>.'
    )
  }
  if (args.id !== null && !UUID_PATTERN.test(args.id)) {
    throw new Error(`--id muss eine Artikel-UUID sein, nicht: ${args.id}`)
  }

  return args
}
