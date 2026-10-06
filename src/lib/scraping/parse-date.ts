/**
 * NEWS-23: date parsing for scraped HTML, German day-first by default.
 *
 * ## Why this module exists
 *
 * The old implementation (inside `html-engine.ts`) tried `new Date(raw)` first
 * and `chrono.parseDate(raw)` (English locale) second. Both read a German
 * numeric date month-first:
 *
 *   | raw          | new Date()        | chrono (en) | chrono.de  |
 *   |--------------|-------------------|-------------|------------|
 *   | `11.08.2026` | 2026-11-08 WRONG  | 2026-11-08  | 2026-08-11 |
 *   | `28.08.2026` | Invalid Date      | 2026-08-28  | 2026-08-28 |
 *
 * For a day <= 12 the native parse *succeeds silently* with day and month
 * exchanged, so the fallback never ran — and the English fallback was
 * month-first too. Production ended up with articles dated months into the
 * future, which also made them immune to the retention sweep and invisible to
 * every `from`/`to` date-window query.
 *
 * ## The pipeline
 *
 * Five stages, in a fixed order. Each one exists because skipping it
 * reintroduces a defect that was reproduced against the installed
 * `chrono-node` 2.9.0 — the comments name the concrete trap, because the
 * ordering *is* the correctness here, not an implementation detail.
 *
 *   0. sanitize            trim, normalize whitespace (incl. NBSP), strip a
 *                          leading German weekday token
 *   1. machine formats     ISO 8601 / RFC 822 via native Date — and ONLY these
 *   2. chrono.de           day-first, best-match selection (never first-match)
 *   3. chrono (en)         only for strings carrying an alphabetic month token
 *   4. null                caller falls back to the scrape timestamp
 *
 * Native `Date` is deliberately dead as a general fallback: `1.8.26` becomes
 * 8 January and `11. 08. 2026` becomes 8 November through it (both verified),
 * i.e. exactly the swap this module exists to prevent. A numeric day-first
 * shape that chrono rejects therefore ends at stage 4, not at `new Date()`.
 *
 * ## Documented behaviour changes (not regressions)
 *
 * - Bare dates now carry chrono's implicit **12:00 server-local** instead of
 *   native midnight. Under production UTC the calendar day is unaffected. One
 *   measurable consequence (QA BUG-6/7): the articles API's `to=` date filter
 *   now excludes a bare-dated article when the window ends between that day's
 *   midnight and noon — rows the old midnight stamp kept in. The window
 *   narrows by at most half a day for such rows, and the exact instant stays
 *   tied to production UTC. The question of what a date-only string *should*
 *   mean (source-locale timezone, date-typed column, "time unknown" marker)
 *   is GitHub issue #2 and stays open — it has schema implications this
 *   bugfix excludes on purpose.
 * - Relative German expressions (`vor 2 Stunden`, `gestern`) now resolve
 *   against `refDate`. Previously they were not recognized at all and the
 *   article silently received the scrape timestamp.
 */

import * as chrono from 'chrono-node'

// ---- Types ----

export interface ParseScrapedDateOptions {
  /**
   * Reference point for relative expressions ("vor 2 Stunden") and for the
   * century of a 2-digit year. Injectable so tests assert fixed outputs
   * instead of racing the wall clock.
   */
  refDate?: Date
}

// ---- Patterns ----

/**
 * Full ISO 8601 / RFC 3339. Date-only (`2026-08-11`) is included: it is
 * unambiguous and native `Date` reads it as UTC midnight, which is today's
 * behaviour and worth preserving exactly.
 *
 * Captures year/month/day so the calendar triple can be validated before the
 * native parser is trusted — see `isRealCalendarDate`.
 */
const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/

/**
 * Year-first numeric dates with `/` or `.` separators: `2026/08/11`,
 * `2026.08.11`, optional time of day. Unambiguous — the 4-digit year leads,
 * so the remaining order can only be month, day — and correctly handled by
 * the native parser, which read them before this module existed (QA BUG-1
 * caught the first pipeline version dropping them to null). The separator is
 * captured and back-referenced, so a mixed `2026/08.11` stays out.
 */
const YEAR_FIRST =
  /^(\d{4})([./])(\d{1,2})\2(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/

/**
 * RFC 822 / RFC 1123, the shape RSS feeds use
 * (`Mon, 11 Aug 2026 10:30:00 GMT`), with the weekday optional.
 *
 * This must be recognized *before* chrono runs: `chrono.de` partial-matches
 * only the clock time of such a string and returns the *scrape day* with the
 * feed's time of day pinned on it (verified: `Mon, 11 Aug 2026 10:30:00 GMT`
 * -> today 10:30). A month-first reading is impossible here because the month
 * is spelled out, so the native parser is both safe and timezone-exact.
 */
const RFC_822 =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{2,4})\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC?|[A-Z]{2,4}|[+-]\d{4})?$/i

/** Month-name -> month number, for validating an RFC 822 calendar triple. */
const EN_MONTH_NUMBER: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Leading German weekday, abbreviated or written out, with an optional period
 * and an optional comma — `Mo., ` / `Montag, ` / `Mi. `.
 *
 * Why strip it: `chrono.de`'s *first* match on `Mo., 11.08.2026` is the bare
 * weekday token `Mo`, which resolves to the **previous Monday** — a plausible
 * near-past date, and therefore a silent defect worse than the swap itself
 * (verified; same for `Mi., 8. März 2026` and uppercase `SO., 11.08.2026`).
 * Removing the decoy is belt; `selectBestMatch` is braces.
 *
 * Full names come first in the alternation so `Samstag` is not clipped to `Sa`
 * leaving `mstag`. A following period/comma/space is required, so
 * `Mondlandung am 11.08.2026` keeps its `Mo`.
 */
const LEADING_WEEKDAY =
  /^(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|mo|di|mi|do|fr|sa|so)\.?(?:\s*,\s*|\s+)/i

/**
 * A day missing its ordinal dot before a German month name: `11 März 2026`.
 *
 * `chrono.de` requires the dot — `11. März 2026` parses, `11 März 2026` does
 * not — while months whose name German and English share (`April`, `August`,
 * `Mai`/`May`-adjacent shapes) slipped through the English stage 3 and parsed
 * anyway. That was QA BUG-2's inconsistency: `11 April 2026` worked,
 * `11 März 2026` silently became the scrape timestamp. Restoring the dot
 * sends BOTH through the German stage 2. Only genuine month names are
 * rewritten (`11 Meter 2026` stays untouched), and the rewrite runs AFTER the
 * stage-1 machine-format check, so an RFC 822 string never sees it.
 */
const DE_DAY_MONTH_MISSING_DOT =
  /\b(\d{1,2})\s+(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez)\b/gi

/**
 * English month names, full and abbreviated. The gate for stage 3.
 *
 * Word boundaries matter: without them `mar` would fire inside `März` and
 * `dec` inside `Dezember`, handing German strings to the month-first parser.
 * With them, the German-only names (`Januar`, `Juni`, `Okt.`, `Dez.`) do not
 * match, while the names German and English share (`August`, `November`,
 * `September`) are already consumed by stage 2 and never reach stage 3.
 */
const EN_MONTH_TOKEN =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i

/**
 * A day-first numeric date, dot or slash separated: `11.08.2026`, `1.8.2026`,
 * `11.08.26`, `11/08/2026`, `11. 08. 2026`.
 *
 * Used as a hard veto on stage 3. The English parser reads every one of these
 * month-first (`11.08.2026` -> 8 November, `11/08/2026` -> 8 November), so a
 * string shaped like this must never reach it — even if some stray English
 * month token also appears in the cell.
 */
const DAY_FIRST_NUMERIC = /\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4}/

// ---- Public API ----

/**
 * Parse a scraped date string into an ISO 8601 timestamp.
 *
 * Returns `null` when nothing conclusive was found; the caller then keeps the
 * scrape timestamp, exactly as before this ticket. Never throws.
 */
export function parseScrapedDate(
  raw: string | null | undefined,
  options: ParseScrapedDateOptions = {}
): string | null {
  if (!raw) return null

  const refDate = options.refDate ?? new Date()

  // --- Stage 0a: normalize whitespace ---
  // NBSP is routine in German date cells (`11.08.2026&nbsp;14:30`). Left as
  // U+00A0 it splits chrono's match in two and the time of day is lost;
  // normalized, the whole string matches and the time survives.
  const normalized = raw.replace(/[\s\u00A0\u202F]+/g, ' ').trim()
  if (!normalized) return null

  // --- Stage 1: unambiguous machine formats ---
  // Runs before the weekday stripper so an RFC 822 `Mon, ...` cannot be
  // touched by it, and before chrono for the partial-match reason above.
  //
  // The calendar triple is validated first because the native parser does NOT
  // reject an impossible day — it rolls it over silently: `2026-02-30` becomes
  // 2 March and `30 Feb 2026 10:00:00 GMT` becomes 2 March 10:00 (both
  // verified). A silently shifted date is the very defect class this module
  // exists to stop, so an unreal triple falls through to stage 4 (null) and
  // the caller keeps the scrape timestamp instead.
  const iso = normalized.match(ISO_8601)
  const rfc = iso ? null : normalized.match(RFC_822)
  const yearFirst = iso || rfc ? null : normalized.match(YEAR_FIRST)

  if (iso || rfc || yearFirst) {
    const real = iso
      ? isRealCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
      : rfc
        ? isRealCalendarDate(
            expandTwoDigitYear(Number(rfc[3])),
            EN_MONTH_NUMBER[rfc[2].toLowerCase()],
            Number(rfc[1])
          )
        : isRealCalendarDate(
            Number(yearFirst![1]),
            Number(yearFirst![3]),
            Number(yearFirst![4])
          )

    if (real) {
      const native = new Date(normalized)
      if (!Number.isNaN(native.getTime())) {
        return native.toISOString()
      }
    }
    // One-way street, on purpose (review L1): once a machine shape has
    // matched, a failed calendar validation or native parse ends at null —
    // never a fall-through to chrono. On exactly these strings chrono.de
    // partial-matches only the clock time and would return the scrape day
    // wearing the feed's time, which is the silent-defect class this module
    // exists to stop. Null hands the caller its honest scrape-timestamp
    // fallback instead.
    return null
  }

  // --- Stage 0b: strip the weekday decoy ---
  const withoutWeekday = normalized.replace(LEADING_WEEKDAY, '').trim()

  // --- Stage 0c: restore the missing ordinal dot before a German month ---
  const candidate = (withoutWeekday || normalized).replace(
    DE_DAY_MONTH_MISSING_DOT,
    '$1. $2'
  )

  // --- Stage 2: German, day-first ---
  // Year-less dates (`11.08.`) resolve to the year nearest refDate, which can
  // lie in the FUTURE (review L2). Accepted: the scheduler's future-date
  // guard makes exactly those rows loud instead of letting them sit silently.
  const german = selectBestMatch(chrono.de.parse(candidate, refDate))
  if (german) return german.start.date().toISOString()

  // --- Stage 3: English, month-name strings only ---
  // German pages rendered by English CMS templates emit `11 Oct 2026` /
  // `11 Dec 2026`, which `chrono.de` does not recognize at all. Admitting them
  // costs nothing as long as purely numeric shapes stay out: hence both a
  // positive gate (an English month token is present) and a veto (no day-first
  // numeric date anywhere in the string).
  if (EN_MONTH_TOKEN.test(candidate) && !DAY_FIRST_NUMERIC.test(candidate)) {
    const english = selectBestMatch(chrono.parse(candidate, refDate))
    if (english) return english.start.date().toISOString()
  }

  // --- Stage 4: nothing conclusive ---
  return null
}

/**
 * Is this year/month/day an actual day on the calendar?
 *
 * Guards the native parser's silent rollover (see stage 1). Leap years are
 * handled by construction: `Date.UTC(year, month, 0)` is the last day of
 * `month`, so February 2024 allows 29 and February 2026 does not.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  if (!Number.isInteger(day) || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * RFC 822 permits a 2-digit year. Mapped the same way chrono and the native
 * parser do: below 50 into the 2000s, otherwise into the 1900s. Only ever
 * affects whether 29 February is accepted.
 */
function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year
  return year < 50 ? 2000 + year : 1900 + year
}

/**
 * Pick the match to trust out of everything chrono found.
 *
 * Never the first match blindly — that is the weekday-prefix bug. Two rules:
 *
 *  1. **Only complete dates.** A match whose day or month is merely *implied*
 *     is not a date, it is a fragment: the bare weekday `Mo` (implies the
 *     previous Monday), a lone time of day `14:30 Uhr` (implies today), a
 *     stray `2026`. Taking a fragment would silently invent a plausible date,
 *     which is strictly worse than returning null and keeping the scrape
 *     timestamp. Relative expressions (`gestern`, `vor 3 Tagen`) do mark day,
 *     month and year as certain and pass this filter.
 *  2. **Prefer an explicit year, then the earliest match.** Preferring the
 *     year makes `11.08. | Aktualisiert am 12.08.2026` resolve to the dated
 *     one. Earliest-wins implements the spec's "first full date wins", which
 *     in the common German layout (`Veröffentlicht am … | Aktualisiert am …`)
 *     is the publication date.
 *
 * Note on the architecture section's "prefer the longest match": dropped on
 * purpose. Its job was to beat the weekday decoy, which rule 1 already
 * eliminates (the decoy carries no certain day/month), and it would otherwise
 * contradict the explicit "first full-date match wins" acceptance criterion
 * whenever a later, more verbose date appears in the same cell.
 */
function selectBestMatch(results: chrono.ParsedResult[]): chrono.ParsedResult | null {
  const complete = results.filter(
    (result) => result.start.isCertain('day') && result.start.isCertain('month')
  )
  if (complete.length === 0) return null

  return complete.reduce((best, current) => {
    const bestHasYear = best.start.isCertain('year')
    const currentHasYear = current.start.isCertain('year')
    if (bestHasYear !== currentHasYear) return bestHasYear ? best : current
    return best.index <= current.index ? best : current
  })
}

// ---- Repair helpers (NEWS-23 report tooling) ----

/**
 * The same instant with day and month exchanged — the "what the date would
 * have been without the bug" reading the repair report shows next to the
 * stored value.
 *
 * Returns `undefined` when the exchange is not a real date, which is the
 * interesting part:
 *
 *  - **day equals month** (`08.08.2026`): swap-invariant, nothing to decide,
 *    and the repair must never flag such a row;
 *  - **stored day > 12**: the swapped month would not exist. This is also the
 *    proof that no row needs an automatic branch: a genuine V8/chrono-en swap
 *    stores month = the original day (<= 12, or the native parse would have
 *    failed) and day = the original month (<= 12 by definition), so every real
 *    victim has a swapped reading with day <= 12 and is indistinguishable from
 *    a genuine future-dated announcement without the raw string — which is
 *    stored nowhere.
 *  - **invalid calendar day** after the exchange (`30.01` -> `01.30`).
 *
 * Works on UTC components: production runs UTC, and the stored `published_at`
 * is what the report has to explain.
 */
export function swappedDateReading(isoTimestamp: string): string | undefined {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return undefined

  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()

  if (day === month) return undefined
  if (day > 12) return undefined

  const swapped = new Date(date.getTime())
  swapped.setUTCMonth(day - 1, month)

  // Reject an overflow like 31 February silently rolling into March.
  if (swapped.getUTCFullYear() !== year) return undefined
  if (swapped.getUTCMonth() + 1 !== day) return undefined
  if (swapped.getUTCDate() !== month) return undefined

  return swapped.toISOString()
}
