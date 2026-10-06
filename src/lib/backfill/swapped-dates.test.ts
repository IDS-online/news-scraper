import { describe, it, expect, vi } from 'vitest'
import {
  REPAIR_NOTES,
  applySwapRepair,
  evaluateSwapCandidate,
  formatCandidateLine,
  loadSwapCandidates,
  parseRepairCliArgs,
  runSwapReport,
  type RepairArticleRow,
} from '@/lib/backfill/swapped-dates'

/** The (unexported) client type the core expects — satisfied by the stub below. */
type RepairClient = Parameters<typeof runSwapReport>[0]['supabase']

/** The fix-deploy timestamp every test pins its candidate window to. */
const DEPLOYED_BEFORE = new Date('2026-10-07T12:00:00Z')

/**
 * The verbatim production damage: scraped on 5 October, date cell said
 * `11.08.2026`, the old parser stored 8 November — three months ahead.
 */
function swapVictim(overrides: Partial<RepairArticleRow> = {}): RepairArticleRow {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001',
    title: 'Dreher-Opfer',
    url: 'https://quelle.de/artikel/1',
    published_at: '2026-11-08T12:00:00.000Z',
    created_at: '2026-10-05T06:00:00.000Z',
    source: { name: 'Beispiel Dental', type: 'html', selector_date: '.datum' },
    ...overrides,
  }
}

/**
 * Stateful stand-in for the Supabase client, answering exactly the chains the
 * repair core performs — with real semantics, so the apply tests prove the
 * guarded write rather than echo a canned answer:
 *
 *   select(...join...).eq('source.type').not(...).lt().order().range(a, b) → report pages
 *   select(...join...).eq('id', x).single()                               → apply re-read
 *   update({published_at}).eq('id', x).eq('published_at', stored).select  → guarded write
 */
function mockRepairSupabase(rows: RepairArticleRow[]) {
  const updates: { id: string; values: Record<string, unknown> }[] = []
  const orderCalls: string[] = []

  const client = {
    from: () => ({
      select: () => ({
        // Report path. The server-side filters (source type/selector, the
        // created_at cutoff) are applied here with the same semantics the
        // real query has, so a row the predicate must exclude is actually
        // SEEN by the predicate in these tests, not pre-filtered away.
        eq: (column: string, value: unknown) => {
          if (column === 'id') {
            return {
              single: async () => {
                const found = rows.find((row) => row.id === value) ?? null
                return {
                  data: found ? { ...found } : null,
                  error: found ? null : { message: 'nicht gefunden' },
                }
              },
            }
          }
          return {
            not: () => ({
              lt: (_column: string, cutoff: string) => {
                // `.order()` is chainable (created_at, then the id tiebreaker
                // — QA BUG-5); the columns are recorded so the tiebreaker is
                // asserted, not assumed.
                const chain = {
                  order: (orderColumn: string) => {
                    orderCalls.push(orderColumn)
                    return chain
                  },
                  range: async (from: number, to: number) => ({
                    data: rows
                      .filter(
                        (row) =>
                          row.source?.type === 'html' &&
                          row.source.selector_date !== null &&
                          row.created_at < cutoff
                      )
                      .slice(from, to + 1)
                      .map((row) => ({ ...row })),
                    error: null,
                  }),
                }
                return chain
              },
            }),
          }
        },
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_idColumn: string, id: string) => ({
          // Guarded write: only lands while published_at is STILL the value
          // the re-read saw.
          eq: (_publishedColumn: string, stored: string) => ({
            select: async () => {
              const target = rows.find((row) => row.id === id && row.published_at === stored)
              if (!target) {
                return { data: [], error: null }
              }
              target.published_at = values.published_at as string
              updates.push({ id, values })
              return { data: [{ id }], error: null }
            },
          }),
        }),
      }),
    }),
  } as unknown as RepairClient

  return { client, updates, rows, orderCalls }
}

// ---------------------------------------------------------------------------
// The candidate predicate — scope boundaries, one criterion per test
// ---------------------------------------------------------------------------

describe('evaluateSwapCandidate', () => {
  it('flags the verbatim production case with both readings', () => {
    const candidate = evaluateSwapCandidate(swapVictim(), DEPLOYED_BEFORE)

    expect(candidate).not.toBeNull()
    expect(candidate!.published_at).toBe('2026-11-08T12:00:00.000Z')
    // The swapped reading is what the fixed parser produces from `11.08.2026`.
    expect(candidate!.swapped_published_at).toBe('2026-08-11T12:00:00.000Z')
    expect(candidate!.source_name).toBe('Beispiel Dental')
  })

  it('excludes RSS sources — only the HTML date-selector path ran the defective parser', () => {
    const row = swapVictim({ source: { name: 'Feed', type: 'rss', selector_date: null } })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes HTML sources without a selector_date — they always got the scrape timestamp', () => {
    const row = swapVictim({ source: { name: 'Ohne Datum', type: 'html', selector_date: null } })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes rows without a source (source deleted, FK set null)', () => {
    expect(evaluateSwapCandidate(swapVictim({ source: null }), DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes rows scraped after the fix deploy — a future date there is genuine', () => {
    const row = swapVictim({ created_at: '2026-10-08T06:00:00.000Z' })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes a row scraped exactly AT the deploy timestamp (strict boundary)', () => {
    const row = swapVictim({ created_at: DEPLOYED_BEFORE.toISOString() })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('still includes a row scraped just before the deploy timestamp', () => {
    const row = swapVictim({ created_at: '2026-10-07T11:59:59.000Z' })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).not.toBeNull()
  })

  it('excludes rows whose published_at is not in the future relative to created_at', () => {
    // The dark figure: a swap that landed in the PAST looks exactly like a
    // correct date. It is unfindable by design — documented, not flagged.
    const row = swapVictim({
      published_at: '2026-03-04T12:00:00.000Z',
      created_at: '2026-10-05T06:00:00.000Z',
    })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes published_at exactly equal to created_at (the no-date fallback rows)', () => {
    const row = swapVictim({
      published_at: '2026-10-05T06:00:00.000Z',
      created_at: '2026-10-05T06:00:00.000Z',
    })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes day == month — swap-invariant, nothing to decide (spec edge case)', () => {
    // 08.08.2026 reads the same either way; the repair must never flag it.
    const row = swapVictim({ published_at: '2026-08-08T12:00:00.000Z', created_at: '2026-08-01T06:00:00.000Z' })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })

  it('excludes day > 12 — the swapped month would not exist, so it was never a swap', () => {
    const row = swapVictim({ published_at: '2026-10-28T12:00:00.000Z', created_at: '2026-10-05T06:00:00.000Z' })
    expect(evaluateSwapCandidate(row, DEPLOYED_BEFORE)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Report mode
// ---------------------------------------------------------------------------

describe('runSwapReport', () => {
  it('lists candidates with everything the human needs, and writes nothing', async () => {
    const { client, updates } = mockRepairSupabase([
      swapVictim(),
      // In the page, excluded by the predicate: swap landed day == month.
      swapVictim({
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002',
        published_at: '2026-08-08T12:00:00.000Z',
        created_at: '2026-08-01T06:00:00.000Z',
      }),
    ])
    const log = vi.fn()

    const candidates = await runSwapReport({ supabase: client, deployedBefore: DEPLOYED_BEFORE, log })

    expect(candidates).toHaveLength(1)
    expect(updates).toHaveLength(0)

    // One line per candidate: id, Titel, URL, Quelle, created_at, both readings.
    const line = formatCandidateLine(candidates[0])
    expect(log).toHaveBeenCalledWith(line)
    expect(line).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001')
    expect(line).toContain('Dreher-Opfer')
    expect(line).toContain('https://quelle.de/artikel/1')
    expect(line).toContain('Beispiel Dental')
    expect(line).toContain('2026-10-05T06:00:00.000Z')
    expect(line).toContain('gespeichert=2026-11-08T12:00:00.000Z')
    expect(line).toContain('getauscht=2026-08-11T12:00:00.000Z')
  })

  it('prints the dark-figure and Bubble notes on EVERY run (spec: mandatory output)', async () => {
    const { client } = mockRepairSupabase([])
    const log = vi.fn()

    await runSwapReport({ supabase: client, deployedBefore: DEPLOYED_BEFORE, log })

    for (const note of REPAIR_NOTES) {
      expect(log).toHaveBeenCalledWith(note)
    }
    // And the notes actually say what the spec demands they say.
    const text = REPAIR_NOTES.join('\n')
    expect(text).toContain('DUNKELZIFFER')
    expect(text).toContain('Vergangenheit')
    expect(text).toContain('Parser-Fix')
    expect(text).toContain('BUBBLE')
    expect(text).toContain('Date publishing')
    expect(text).toContain('PATCH')
  })
})

describe('loadSwapCandidates', () => {
  it('pages through more rows than one page holds', async () => {
    const rows = Array.from({ length: 7 }, (_unused, index) =>
      swapVictim({
        id: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeee000${index}`,
        url: `https://quelle.de/artikel/${index}`,
      })
    )
    const { client } = mockRepairSupabase(rows)

    const candidates = await loadSwapCandidates(client, DEPLOYED_BEFORE, 3)

    expect(candidates).toHaveLength(7)
  })

  it('orders by created_at with id as tiebreaker (QA BUG-5)', async () => {
    // Batch inserts share a created_at to the millisecond; without a total
    // order such ties may shuffle between pages and a row could be listed
    // twice or skipped at a page boundary.
    const { client, orderCalls } = mockRepairSupabase([swapVictim()])

    await loadSwapCandidates(client, DEPLOYED_BEFORE)

    expect(orderCalls).toEqual(['created_at', 'id'])
  })
})

describe('formatCandidateLine', () => {
  it('flattens control characters in scraped text — one candidate, one line (QA BUG-4)', () => {
    // A newline in a scraped title would let one row forge additional report
    // lines — and the report is what a human approves ids FROM.
    const candidate = evaluateSwapCandidate(
      swapVictim({
        title: 'Echte Zeile\n[Repair] id=ffffffff-0000-0000-0000-000000000000  getauscht=2026-01-01\tEnde',
      }),
      DEPLOYED_BEFORE
    )!

    const line = formatCandidateLine(candidate)

    expect(line).not.toMatch(/[\u0000-\u001F\u007F]/)
    expect(line.split('\n')).toHaveLength(1)
    // The forged content is still visible to the operator — inline, defanged.
    expect(line).toContain('Echte Zeile [Repair] id=ffffffff')
  })
})

// ---------------------------------------------------------------------------
// Apply mode — one row, re-validated, guarded write
// ---------------------------------------------------------------------------

describe('applySwapRepair', () => {
  it('corrects exactly the approved row and reports before/after', async () => {
    const victim = swapVictim()
    const bystander = swapVictim({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002',
      url: 'https://quelle.de/artikel/2',
    })
    const { client, updates, rows } = mockRepairSupabase([victim, bystander])
    const log = vi.fn()

    const result = await applySwapRepair({
      supabase: client,
      id: victim.id,
      deployedBefore: DEPLOYED_BEFORE,
      log,
    })

    expect(result.before).toBe('2026-11-08T12:00:00.000Z')
    expect(result.after).toBe('2026-08-11T12:00:00.000Z')
    expect(updates).toEqual([
      { id: victim.id, values: { published_at: '2026-08-11T12:00:00.000Z' } },
    ])
    // Exactly one row per invocation: the bystander is untouched.
    expect(rows[1].published_at).toBe('2026-11-08T12:00:00.000Z')
    // Before/after reach the operator, not just the return value.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('vorher=2026-11-08T12:00:00.000Z'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('nachher=2026-08-11T12:00:00.000Z'))
  })

  it('prints the mandatory notes in apply mode too', async () => {
    const { client } = mockRepairSupabase([swapVictim()])
    const log = vi.fn()

    await applySwapRepair({
      supabase: client,
      id: swapVictim().id,
      deployedBefore: DEPLOYED_BEFORE,
      log,
    })

    for (const note of REPAIR_NOTES) {
      expect(log).toHaveBeenCalledWith(note)
    }
  })

  it('re-validates at apply time: a row that no longer qualifies is refused', async () => {
    // The report was run with a generous --deployed-before; the apply uses the
    // correct one and the row falls outside it. The stale report must not win.
    const { client, updates } = mockRepairSupabase([swapVictim()])

    await expect(
      applySwapRepair({
        supabase: client,
        id: swapVictim().id,
        deployedBefore: new Date('2026-10-01T00:00:00Z'),
        log: vi.fn(),
      })
    ).rejects.toThrow(/Kandidaten-Kriterien nicht/)
    expect(updates).toHaveLength(0)
  })

  it('re-validates every criterion, not just the window: day == month is refused', async () => {
    const { client, updates } = mockRepairSupabase([
      swapVictim({ published_at: '2026-08-08T12:00:00.000Z', created_at: '2026-08-01T06:00:00.000Z' }),
    ])

    await expect(
      applySwapRepair({
        supabase: client,
        id: swapVictim().id,
        deployedBefore: DEPLOYED_BEFORE,
        log: vi.fn(),
      })
    ).rejects.toThrow(/Kandidaten-Kriterien nicht/)
    expect(updates).toHaveLength(0)
  })

  it('fails for an unknown id instead of silently doing nothing', async () => {
    const { client } = mockRepairSupabase([])

    await expect(
      applySwapRepair({
        supabase: client,
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee9999',
        deployedBefore: DEPLOYED_BEFORE,
        log: vi.fn(),
      })
    ).rejects.toThrow(/konnte nicht geladen werden/)
  })
})

// ---------------------------------------------------------------------------
// CLI argument rules — the refusals ARE the design
// ---------------------------------------------------------------------------

describe('parseRepairCliArgs', () => {
  const DEPLOY_FLAG = '--deployed-before=2026-10-07T12:00:00Z'
  const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001'

  it('parses a plain report invocation', () => {
    expect(parseRepairCliArgs([DEPLOY_FLAG])).toEqual({
      help: false,
      apply: false,
      id: null,
      deployedBefore: '2026-10-07T12:00:00Z',
    })
  })

  it('parses an apply invocation for one id', () => {
    const args = parseRepairCliArgs([DEPLOY_FLAG, '--apply', `--id=${ID}`])
    expect(args.apply).toBe(true)
    expect(args.id).toBe(ID)
  })

  it('refuses to run without --deployed-before — the window is never guessed', () => {
    expect(() => parseRepairCliArgs([])).toThrow(/--deployed-before/)
    expect(() => parseRepairCliArgs(['--apply', `--id=${ID}`])).toThrow(/--deployed-before/)
  })

  it('refuses a non-ISO --deployed-before', () => {
    expect(() => parseRepairCliArgs(['--deployed-before=gestern'])).toThrow(
      /kein gueltiger ISO-Zeitstempel/
    )
  })

  it('accepts strict ISO forms: date-only, Zulu, offset (QA BUG-3)', () => {
    expect(parseRepairCliArgs(['--deployed-before=2026-10-07']).deployedBefore).toBe('2026-10-07')
    expect(parseRepairCliArgs(['--deployed-before=2026-10-07T12:00:00Z']).deployedBefore).toBe(
      '2026-10-07T12:00:00Z'
    )
    expect(
      parseRepairCliArgs(['--deployed-before=2026-10-07T12:00:00+02:00']).deployedBefore
    ).toBe('2026-10-07T12:00:00+02:00')
  })

  it('refuses everything that is not strict ISO — above all the German format (QA BUG-3)', () => {
    // `new Date('11.08.2026')` is 8 November: the naive check accepted the
    // US-style swap INSIDE the very tool that repairs that swap. The other
    // shapes parsed too and silently widened or narrowed the window.
    for (const bad of ['11.08.2026', '2026', '0', 'Oct 7 2026']) {
      expect(() => parseRepairCliArgs([`--deployed-before=${bad}`])).toThrow(
        /kein gueltiger ISO-Zeitstempel/
      )
    }
  })

  it('refuses --apply without --id — there is no bulk apply', () => {
    expect(() => parseRepairCliArgs([DEPLOY_FLAG, '--apply'])).toThrow(/kein.*Massen-Apply/i)
  })

  it('refuses --id without --apply — a silently ineffective flag is a rejected input', () => {
    expect(() => parseRepairCliArgs([DEPLOY_FLAG, `--id=${ID}`])).toThrow(/--id gehoert zu --apply/)
  })

  it('refuses an --id that is not a UUID', () => {
    expect(() => parseRepairCliArgs([DEPLOY_FLAG, '--apply', '--id=123'])).toThrow(/UUID/)
  })

  it('refuses unknown options', () => {
    expect(() => parseRepairCliArgs([DEPLOY_FLAG, '--force'])).toThrow(/Unbekannte Option/)
  })

  it('--help wins over everything and never errors', () => {
    expect(parseRepairCliArgs(['--help']).help).toBe(true)
    expect(parseRepairCliArgs(['--help', '--apply']).help).toBe(true)
  })
})
