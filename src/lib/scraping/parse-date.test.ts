import { describe, it, expect } from 'vitest'
import { parseScrapedDate, swappedDateReading } from '@/lib/scraping/parse-date'

/**
 * NEWS-23. The suite runs under the repository-wide `TZ=UTC` pin (see
 * `vitest.config.ts`), which is also production's zone on Vercel — so the UTC
 * assertions below are assertions about production behaviour.
 *
 * Every relative-expression test injects `refDate` instead of reading the wall
 * clock, so a test that passes today still passes in March.
 */

/** Fixed "now" for all parses: Tuesday, 6 October 2026, 09:00 UTC. */
const REF = new Date('2026-10-06T09:00:00Z')

/** Parse with the pinned reference time. */
function parse(raw: string | null | undefined): string | null {
  return parseScrapedDate(raw, { refDate: REF })
}

/** The calendar day a parse landed on, as `YYYY-MM-DD`, or null. */
function day(raw: string | null | undefined): string | null {
  const result = parse(raw)
  return result ? result.slice(0, 10) : null
}

// ---------------------------------------------------------------------------
// The defect this ticket exists for
// ---------------------------------------------------------------------------

describe('parseScrapedDate — German day-first numeric dates (the swap)', () => {
  it('reads 11.08.2026 as 11 August, not 8 November', () => {
    // The verbatim production case. Before the fix this produced 2026-11-08:
    // a date two months in the FUTURE, which also escaped the retention sweep
    // and every from/to date-window query.
    expect(day('11.08.2026')).toBe('2026-08-11')
  })

  it('reads 28.08.2026 as 28 August (day > 12 was never affected)', () => {
    expect(day('28.08.2026')).toBe('2026-08-28')
  })

  it('reads unpadded D.M.YYYY day-first', () => {
    expect(day('1.8.2026')).toBe('2026-08-01')
    expect(day('5.9.2026')).toBe('2026-09-05')
  })

  it('reads DD.MM.YY day-first', () => {
    expect(day('11.08.26')).toBe('2026-08-11')
  })

  it('reads slash-separated dates day-first', () => {
    // `new Date('11/08/2026')` is 8 November — the same swap in another shape.
    expect(day('11/08/2026')).toBe('2026-08-11')
  })

  it('keeps an explicit time of day', () => {
    expect(parse('11.08.2026 14:30')).toBe('2026-08-11T14:30:00.000Z')
    expect(parse('11.08.2026, 14:30 Uhr')).toBe('2026-08-11T14:30:00.000Z')
    expect(parse('Stand: 11.08.2026, 14:30 Uhr')).toBe('2026-08-11T14:30:00.000Z')
  })

  it('normalizes a non-breaking space between date and time', () => {
    // German date cells routinely use &nbsp; here. Unnormalized it splits the
    // match in two and the time of day is lost.
    expect(parse('11.08.2026\u00A014:30')).toBe('2026-08-11T14:30:00.000Z')
  })

  it('parses the date and drops the time when a dash separates them', () => {
    // Documented, accepted limitation: the time component is lost, the date is
    // right. Implicit noon (see the module docstring on issue #2).
    expect(day('11.08.2026 – 14:30 Uhr')).toBe('2026-08-11')
  })

  it('is stable for a swap-invariant date', () => {
    expect(day('08.08.2026')).toBe('2026-08-08')
  })

  it('resolves a fully ambiguous date day-first (the deliberate default)', () => {
    // Both readings are valid past dates. German sources are the domain, so
    // day-first wins — stated in the spec as a deliberate choice, not a guess.
    expect(day('05.04.2026')).toBe('2026-04-05')
  })
})

// ---------------------------------------------------------------------------
// Machine formats must not change at all
// ---------------------------------------------------------------------------

describe('parseScrapedDate — unambiguous machine formats (regression guard)', () => {
  it('passes a full ISO 8601 timestamp through unchanged', () => {
    expect(parse('2026-08-11T10:30:00Z')).toBe('2026-08-11T10:30:00.000Z')
    expect(parse('2026-03-06T10:30:00Z')).toBe('2026-03-06T10:30:00.000Z')
  })

  it('honours an ISO offset', () => {
    expect(parse('2026-08-11T10:30:00+02:00')).toBe('2026-08-11T08:30:00.000Z')
  })

  it('reads an ISO date-only string as UTC midnight (unchanged behaviour)', () => {
    expect(parse('2026-08-11')).toBe('2026-08-11T00:00:00.000Z')
  })

  it('parses RFC 822 exactly, including its timezone', () => {
    // chrono.de on this string matches ONLY `10:30:00 GMT` and returns the
    // SCRAPE day — which is why machine formats are detected before chrono.
    expect(parse('Mon, 11 Aug 2026 10:30:00 GMT')).toBe('2026-08-11T10:30:00.000Z')
    expect(parse('11 Aug 2026 10:30:00 GMT')).toBe('2026-08-11T10:30:00.000Z')
    expect(parse('Mon, 11 Aug 2026 10:30:00 +0200')).toBe('2026-08-11T08:30:00.000Z')
  })

  it('rejects a well-shaped but impossible machine date instead of rolling it over', () => {
    // The native parser does not fail on these — it shifts them silently:
    // `new Date('2026-02-30')` is 2 March, `new Date('2026-04-31')` is 1 May,
    // and `new Date('30 Feb 2026 10:00:00 GMT')` is 2 March 10:00. A silently
    // shifted date is the defect class this module exists to stop, so the
    // calendar triple is validated before the native parser is trusted.
    expect(parse('2026-02-30')).toBeNull()
    expect(parse('2026-04-31')).toBeNull()
    expect(parse('2026-13-01')).toBeNull()
    expect(parse('2026-02-30T10:00:00Z')).toBeNull()
    expect(parse('30 Feb 2026 10:00:00 GMT')).toBeNull()
    expect(parse('Mon, 30 Feb 2026 10:00:00 GMT')).toBeNull()
  })

  it('still accepts 29 February in a leap year', () => {
    expect(parse('2024-02-29')).toBe('2024-02-29T00:00:00.000Z')
    expect(parse('29 Feb 2024 10:00:00 GMT')).toBe('2024-02-29T10:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// Written-out German months — a second silent defect the same fix covers
// ---------------------------------------------------------------------------

describe('parseScrapedDate — written-out German month names', () => {
  it('parses month names that were previously not recognized at all', () => {
    // Before the fix these fell through to the scrape timestamp, so the
    // article silently carried the wrong date with no trace.
    expect(day('8. Mai 2026')).toBe('2026-05-08')
    expect(day('8. März 2026')).toBe('2026-03-08')
  })

  it('parses 11. August 2026 as the 11th (was August 10 or August 1)', () => {
    // Native Date gave August 10 via a timezone shift; English chrono gave
    // August 1, treating "11" as a time of day.
    expect(day('11. August 2026')).toBe('2026-08-11')
  })

  it('parses abbreviated German months', () => {
    expect(day('11. Okt. 2026')).toBe('2026-10-11')
    expect(day('11. Dez. 2026')).toBe('2026-12-11')
    expect(day('8. Jan. 2026')).toBe('2026-01-08')
    expect(day('8. Sept. 2026')).toBe('2026-09-08')
  })

  it('parses a month name with surrounding text and a time', () => {
    expect(parse('Veröffentlicht am 11. August 2026 um 14:30 Uhr')).toBe(
      '2026-08-11T14:30:00.000Z'
    )
  })
})

// ---------------------------------------------------------------------------
// Weekday prefixes — the decoy that would have been worse than the bug
// ---------------------------------------------------------------------------

describe('parseScrapedDate — weekday prefixes', () => {
  it('parses the literal date, not the weekday', () => {
    expect(day('Mo., 11.08.2026')).toBe('2026-08-11')
    expect(day('Di., 11.08.2026')).toBe('2026-08-11')
    expect(day('Montag, 11.08.2026')).toBe('2026-08-11')
    expect(day('Mo, 11.08.2026')).toBe('2026-08-11')
    expect(day('SO., 11.08.2026')).toBe('2026-08-11')
    expect(day('Mi., 8. März 2026')).toBe('2026-03-08')
    expect(day('Freitag, 8. Mai 2026')).toBe('2026-05-08')
  })

  it('never resolves to the weekday nearest the reference date', () => {
    // chrono.de's FIRST match on `Mo., 11.08.2026` is the bare token `Mo`,
    // which resolves to Monday 5 October 2026 — a plausible near-past date and
    // therefore a silent defect worse than the swap. Taking the first match
    // blindly is exactly what this asserts against.
    expect(day('Mo., 11.08.2026')).not.toBe('2026-10-05')
    expect(day('Di., 11.08.2026')).not.toBe('2026-10-06')
  })

  it('does not mistake a word beginning with a weekday abbreviation', () => {
    expect(day('Mondlandung am 11.08.2026')).toBe('2026-08-11')
  })

  it('keeps the time when a weekday prefix is present', () => {
    expect(parse('Veröffentlicht am Mo., 11.08.2026, 14:30 Uhr')).toBe(
      '2026-08-11T14:30:00.000Z'
    )
  })
})

// ---------------------------------------------------------------------------
// Relative expressions — documented behaviour CHANGE, not a regression guard
// ---------------------------------------------------------------------------

describe('parseScrapedDate — relative German expressions', () => {
  it('resolves hours against the injected reference time', () => {
    expect(parse('vor 2 Stunden')).toBe('2026-10-06T07:00:00.000Z')
    expect(parse('vor einer Stunde')).toBe('2026-10-06T08:00:00.000Z')
  })

  it('resolves days against the injected reference time', () => {
    expect(parse('vor 3 Tagen')).toBe('2026-10-03T09:00:00.000Z')
    expect(day('gestern')).toBe('2026-10-05')
    expect(day('heute')).toBe('2026-10-06')
  })
})

// ---------------------------------------------------------------------------
// The native parser is dead as a fallback
// ---------------------------------------------------------------------------

describe('parseScrapedDate — never falls through to a month-first native parse', () => {
  it('returns null for 1.8.26 rather than 8 January', () => {
    // `new Date('1.8.26')` is 2026-01-08. The outcome must be either a correct
    // day-first date or the scrape-timestamp fallback — never a US reading.
    expect(parse('1.8.26')).toBeNull()
  })

  it('returns null for 11. 08. 2026 rather than 8 November', () => {
    // `new Date('11. 08. 2026')` is 2026-11-08 — the swap, in the shape the
    // old code would still have produced after the chrono change.
    expect(parse('11. 08. 2026')).toBeNull()
  })

  it('refuses the English parser for numeric dates even beside a month token', () => {
    // Both gates on stage 3 matter: an English month token is present here,
    // but the string also carries a day-first numeric date, which vetoes the
    // month-first parser outright.
    const result = parse('11. 08. 2026 (Aug)')
    expect(result?.slice(0, 10)).not.toBe('2026-11-08')
  })
})

// ---------------------------------------------------------------------------
// Guarded English fallback — German pages on English CMS templates
// ---------------------------------------------------------------------------

describe('parseScrapedDate — guarded English month-token fallback', () => {
  it('parses English month abbreviations that chrono.de rejects', () => {
    expect(day('11 Oct 2026')).toBe('2026-10-11')
    expect(day('11 Dec 2026')).toBe('2026-12-11')
  })

  it('keeps parsing the English formats the old implementation handled', () => {
    // These two were pinned by html-engine.test.ts before this ticket.
    expect(day('January 15, 2024')).toBe('2024-01-15')
    expect(day('Jan 15th, 2024')).toBe('2024-01-15')
  })
})

// ---------------------------------------------------------------------------
// Edge cases from the spec
// ---------------------------------------------------------------------------

describe('parseScrapedDate — fallback and edge cases', () => {
  it('returns null for empty and blank input', () => {
    expect(parse('')).toBeNull()
    expect(parse(null)).toBeNull()
    expect(parse(undefined)).toBeNull()
    expect(parse('   ')).toBeNull()
  })

  it('returns null for text containing no date', () => {
    expect(parse('weder Datum noch Uhrzeit')).toBeNull()
  })

  it('returns null for nonsense dates instead of crashing', () => {
    expect(parse('13.13.2026')).toBeNull()
    expect(parse('32.01.2026')).toBeNull()
    expect(parse('29.02.2026')).toBeNull() // 2026 is not a leap year
  })

  it('returns null for a bare time of day rather than inventing today', () => {
    // A fragment is not a date. Returning today would be a silent invention;
    // null lets the caller keep the scrape timestamp, which is honest.
    expect(parse('14:30 Uhr')).toBeNull()
    expect(parse('2026')).toBeNull()
  })

  it('resolves a date range to a date inside the range', () => {
    // Which endpoint wins is chrono's business and documented, not engineered
    // around: dash forms yield the end, "bis" forms the start. The guarantee
    // is that the result is inside the range and never a swap.
    const dash = day('11.–13.08.2026')
    expect(dash).not.toBeNull()
    expect(dash! >= '2026-08-11' && dash! <= '2026-08-13').toBe(true)

    const bis = day('11. bis 13. August 2026')
    expect(bis).not.toBeNull()
    expect(bis! >= '2026-08-11' && bis! <= '2026-08-13').toBe(true)
  })

  it('takes the first full date when a cell holds two', () => {
    // In the common German layout the publish date leads and the update date
    // follows. A source leading with its update date would win instead —
    // accepted, documented, no keyword heuristics.
    expect(day('Veröffentlicht am 11.08.2026 | Aktualisiert am 12.08.2026')).toBe(
      '2026-08-11'
    )
  })

  it('prefers a match carrying an explicit year over a year-less one', () => {
    expect(day('Veröffentlicht am 11.08. | Aktualisiert am 12.08.2026')).toBe(
      '2026-08-12'
    )
  })

  it('ignores the source language: German dates parse without any locale hint', () => {
    // The pipeline is input-driven. There is no `language` parameter at all,
    // so a source configured `en` whose page shows German dates (and vice
    // versa) is parsed on the strength of the string alone.
    expect(day('11.08.2026')).toBe('2026-08-11')
    expect(day('11 Oct 2026')).toBe('2026-10-11')
  })
})

// ---------------------------------------------------------------------------
// Property-based test — the machine that outlasts review rounds
// ---------------------------------------------------------------------------

/**
 * Seeded PRNG (mulberry32). Hand-rolled on purpose: `fast-check` would be a
 * new dependency, and this ticket adds none.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MONTHS_FULL = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const MONTHS_ABBR = [
  'Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.',
]
const WEEKDAYS_FULL = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
]
const WEEKDAYS_ABBR = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

describe('parseScrapedDate — property-based (fuzz) round trip', () => {
  it('parses every supported rendering back to the exact calendar day', () => {
    // Three review rounds each found a format trap humans had missed. This
    // searches the format space mechanically on every CI run instead.
    const seed = Number(process.env.PARSE_DATE_FUZZ_SEED ?? 20261006)
    const random = mulberry32(seed)
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
    const chance = (probability: number): boolean => random() < probability

    const ITERATIONS = 2000
    const failures: string[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      // 2000..2045 keeps 2-digit years unambiguous: chrono maps yy < 50 to the
      // 2000s, so the 2-digit rendering below stays faithful.
      const year = 2000 + Math.floor(random() * 46)
      const month = 1 + Math.floor(random() * 12)
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const dayOfMonth = 1 + Math.floor(random() * daysInMonth)

      const dd = String(dayOfMonth).padStart(2, '0')
      const mm = String(month).padStart(2, '0')
      const yy = String(year % 100).padStart(2, '0')

      const shape = pick([
        'numeric-padded', 'numeric-unpadded', 'numeric-2digit-year',
        'numeric-slash', 'month-full', 'month-abbr',
      ])

      let rendered: string
      switch (shape) {
        case 'numeric-padded':
          rendered = `${dd}.${mm}.${year}`
          break
        case 'numeric-unpadded':
          rendered = `${dayOfMonth}.${month}.${year}`
          break
        case 'numeric-2digit-year':
          rendered = `${dd}.${mm}.${yy}`
          break
        case 'numeric-slash':
          rendered = `${dd}/${mm}/${year}`
          break
        case 'month-full':
          rendered = `${dayOfMonth}. ${MONTHS_FULL[month - 1]} ${year}`
          break
        default:
          rendered = `${dayOfMonth}. ${MONTHS_ABBR[month - 1]} ${year}`
          break
      }

      // Optional weekday prefix — the actual weekday for this date, so the
      // string is one a real source could emit.
      if (chance(0.4)) {
        const weekdayIndex = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()
        const weekday = chance(0.5)
          ? WEEKDAYS_ABBR[weekdayIndex]
          : WEEKDAYS_FULL[weekdayIndex]
        rendered = `${weekday}, ${rendered}`
      }

      // Optional time suffix.
      let expectedTime: string | null = null
      if (chance(0.4)) {
        const hour = Math.floor(random() * 24)
        const minute = Math.floor(random() * 60)
        expectedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        rendered = `${rendered}, ${expectedTime} Uhr`
      }

      // Optional surrounding prose.
      if (chance(0.3)) {
        rendered = `Veröffentlicht am ${rendered}`
      }

      const expectedDay = `${year}-${mm}-${dd}`
      const actual = parse(rendered)

      if (actual === null) {
        failures.push(`${JSON.stringify(rendered)} → null (expected ${expectedDay})`)
        continue
      }
      if (actual.slice(0, 10) !== expectedDay) {
        failures.push(
          `${JSON.stringify(rendered)} → ${actual.slice(0, 10)} (expected ${expectedDay})`
        )
      }
    }

    expect(
      failures.slice(0, 20),
      `fuzz seed ${seed} — rerun with PARSE_DATE_FUZZ_SEED=${seed}; ` +
        `${failures.length}/${ITERATIONS} renderings failed`
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The repair helper
// ---------------------------------------------------------------------------

describe('swappedDateReading', () => {
  it('exchanges day and month', () => {
    expect(swappedDateReading('2026-11-08T12:00:00.000Z')).toBe('2026-08-11T12:00:00.000Z')
    expect(swappedDateReading('2026-12-08T00:00:00.000Z')).toBe('2026-08-12T00:00:00.000Z')
  })

  it('preserves the time of day', () => {
    expect(swappedDateReading('2026-11-08T14:30:45.123Z')).toBe('2026-08-11T14:30:45.123Z')
  })

  it('is undefined when day equals month (swap-invariant)', () => {
    // 08.08.2026 reads the same either way — there is nothing to decide, and
    // the repair must never flag such a row.
    expect(swappedDateReading('2026-08-08T12:00:00.000Z')).toBeUndefined()
  })

  it('is undefined when the stored day cannot be a month', () => {
    // This is also the proof that an automatic-correction branch is dead: a
    // genuine swap always stores day <= 12, so a row with day > 12 was never a
    // swap victim.
    expect(swappedDateReading('2026-08-28T12:00:00.000Z')).toBeUndefined()
    expect(swappedDateReading('2026-01-13T12:00:00.000Z')).toBeUndefined()
  })

  it('is undefined for an invalid timestamp', () => {
    expect(swappedDateReading('not a date')).toBeUndefined()
  })

  it('round-trips with the parser for the production case', () => {
    // The stored damage was 2026-11-08; its swapped reading is the date the
    // fixed parser now produces from the same raw string.
    const stored = '2026-11-08T12:00:00.000Z'
    expect(swappedDateReading(stored)!.slice(0, 10)).toBe(day('11.08.2026'))
  })
})
