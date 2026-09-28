import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyResync,
  assertJournalMatchesSupabaseTarget,
  assertResyncTargetIsTestBubble,
  buildJournal,
  loadNullImageArticles,
  loadResyncTargets,
  parseBackfillCliArgs,
  readJournalFile,
  runFill,
  writeJournalFile,
  type BackfillJournal,
  type JournalRow,
} from '@/lib/backfill/missing-images'

/** The (unexported) client type the core expects — satisfied by the stub below. */
type BackfillClient = Parameters<typeof runFill>[0]['supabase']

interface Row {
  id: string
  url: string
  title: string
  image_url: string | null
  bubble_id: string | null
  bubble_synced_at: string | null
  created_at: string
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    url: `https://www.example.com/news/${id}`,
    title: `Titel ${id}`,
    image_url: null,
    bubble_id: null,
    bubble_synced_at: null,
    created_at: `2026-09-0${id.length % 9 || 1}T00:00:00.000Z`,
    ...overrides,
  }
}

/**
 * Stateful stand-in for the Supabase client, answering exactly the chains the
 * backfill core performs — with real semantics, so the idempotency tests prove
 * behaviour rather than echo a canned answer:
 *
 *   select().is('image_url', null).order().range(a, b)        → candidate pages
 *   select().in('id', ids).not('bubble_synced_at', ...).limit → resync targets
 *   update({image_url}).eq('id').is('image_url', null).select → fill write
 *   update({bubble_*: null}).eq('id').eq('bubble_synced_at', s).select → resync write
 */
function mockBackfillSupabase(rows: Row[]) {
  const updates: { id: string; values: Record<string, unknown> }[] = []

  const client = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => ({
            range: async (from: number, to: number) => ({
              data: rows
                .filter((candidate) => candidate.image_url === null)
                .slice(from, to + 1)
                .map((candidate) => ({ ...candidate })),
              error: null,
            }),
          }),
        }),
        in: (_column: string, ids: string[]) => ({
          not: () => ({
            limit: async () => ({
              data: rows
                .filter(
                  (candidate) =>
                    ids.includes(candidate.id) && candidate.bubble_synced_at !== null
                )
                .map((candidate) => ({ ...candidate })),
              error: null,
            }),
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => ({
          // Fill write: only lands while the row is STILL image-less.
          is: () => ({
            select: async () => {
              const target = rows.find((candidate) => candidate.id === id)
              if (!target || target.image_url !== null) {
                return { data: [], error: null }
              }
              target.image_url = values.image_url as string
              updates.push({ id, values })
              return { data: [{ id }], error: null }
            },
          }),
          // Resync write: only lands while the stamp is unchanged.
          eq: (_stampColumn: string, stamp: string) => ({
            select: async () => {
              const target = rows.find(
                (candidate) => candidate.id === id && candidate.bubble_synced_at === stamp
              )
              if (!target) {
                return { data: [], error: null }
              }
              target.bubble_synced_at = null
              target.bubble_id = null
              updates.push({ id, values })
              return { data: [{ id }], error: null }
            },
          }),
        }),
      }),
    }),
  } as unknown as BackfillClient

  return { client, updates, rows }
}

function journalOf(rows: JournalRow[]): BackfillJournal {
  return {
    created_at: '2026-09-28T12:00:00.000Z',
    supabase_url: 'https://project.supabase.co',
    bubble_environment: 'test',
    rows,
  }
}

function journalRow(id: string, overrides: Partial<JournalRow> = {}): JournalRow {
  return {
    id,
    url: `https://www.example.com/news/${id}`,
    title: `Titel ${id}`,
    image_url: `https://cdn.example.com/${id}.jpg`,
    bubble_id: null,
    bubble_synced_at: null,
    ...overrides,
  }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.BUBBLE_API_BASE_URL = 'https://example.bubbleapps.io'
  process.env.BUBBLE_API_TOKEN = 'token'
  process.env.BUBBLE_DATA_TYPE = 'newsscraped'
  process.env.BUBBLE_USE_TEST_VERSION = 'true'
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...savedEnv }
})

// ---------------------------------------------------------------------------
// Fill phase
// ---------------------------------------------------------------------------

describe('runFill — dry run (default)', () => {
  it('writes NOTHING and reports what it would fill', async () => {
    const { client, updates, rows } = mockBackfillSupabase([row('a'), row('b')])
    const extract = vi.fn(async (url: string) => `${url}/og.jpg`)

    const report = await runFill({ supabase: client, apply: false, extract })

    expect(report).toMatchObject({ scanned: 2, found: 2, updated: 0, applied: false })
    expect(updates).toEqual([])
    expect(rows.every((candidate) => candidate.image_url === null)).toBe(true)
    expect(report.rows.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })
})

describe('runFill — apply', () => {
  it('updates exactly the rows with a usable find; misses and failures touch nothing', async () => {
    const { client, rows } = mockBackfillSupabase([row('a'), row('b'), row('c')])
    const extract = vi.fn(async (url: string) => {
      if (url.endsWith('/a')) return 'https://cdn.example.com/a.jpg'
      if (url.endsWith('/b')) return null // page has no og:/twitter: image
      throw new Error('ECONNRESET') // a custom extractor may throw; the chain never does
    })

    const report = await runFill({ supabase: client, apply: true, extract })

    expect(report).toMatchObject({ scanned: 3, found: 1, updated: 1, applied: true })
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toContain('/c')
    expect(rows.find((candidate) => candidate.id === 'a')?.image_url).toBe(
      'https://cdn.example.com/a.jpg'
    )
    expect(rows.find((candidate) => candidate.id === 'b')?.image_url).toBeNull()
    expect(rows.find((candidate) => candidate.id === 'c')?.image_url).toBeNull()
  })

  it('never selects — let alone touches — a row that already has an image', async () => {
    const filled = row('voll', { image_url: 'https://cdn.example.com/bestand.jpg' })
    const { client, rows } = mockBackfillSupabase([row('leer'), filled])
    const extract = vi.fn(async () => 'https://cdn.example.com/neu.jpg')

    const report = await runFill({ supabase: client, apply: true, extract })

    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract).toHaveBeenCalledWith('https://www.example.com/news/leer')
    expect(report.scanned).toBe(1)
    expect(rows.find((candidate) => candidate.id === 'voll')?.image_url).toBe(
      'https://cdn.example.com/bestand.jpg'
    )
  })

  it('is idempotent: a second run skips the rows the first one filled', async () => {
    const { client } = mockBackfillSupabase([row('a'), row('b')])
    const extract = vi.fn(async (url: string) => `${url}/og.jpg`)

    const first = await runFill({ supabase: client, apply: true, extract })
    expect(first.updated).toBe(2)

    extract.mockClear()
    const second = await runFill({ supabase: client, apply: true, extract })

    expect(extract).not.toHaveBeenCalled()
    expect(second).toMatchObject({ scanned: 0, found: 0, updated: 0 })
  })

  it('does not regress a row that gained an image between listing and write', async () => {
    // The race the .is('image_url', null) in the UPDATE's WHERE clause exists
    // for: a concurrent scheduler run (or operator) fills the row first.
    const { client, rows } = mockBackfillSupabase([row('a')])
    const extract = vi.fn(async () => {
      rows[0].image_url = 'https://cdn.example.com/vom-scheduler.jpg'
      return 'https://cdn.example.com/vom-backfill.jpg'
    })

    const report = await runFill({ supabase: client, apply: true, extract })

    expect(report).toMatchObject({ found: 1, updated: 0, skipped_already_filled: 1 })
    expect(rows[0].image_url).toBe('https://cdn.example.com/vom-scheduler.jpg')
    // Rows that were NOT written must not enter the journal either.
    expect(report.rows).toEqual([])
  })

  it('honours --limit', async () => {
    const { client } = mockBackfillSupabase([row('a'), row('b'), row('c')])
    const extract = vi.fn(async (url: string) => `${url}/og.jpg`)

    const report = await runFill({ supabase: client, apply: false, limit: 2, extract })

    expect(report.scanned).toBe(2)
    expect(extract).toHaveBeenCalledTimes(2)
  })
})

describe('loadNullImageArticles', () => {
  it('pages through the candidates until a short page ends the listing', async () => {
    const { client } = mockBackfillSupabase([row('a'), row('b'), row('c'), row('d'), row('e')])

    const articles = await loadNullImageArticles(client, 2)

    expect(articles.map((article) => article.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

// ---------------------------------------------------------------------------
// Resync guard — the hard environment gate
// ---------------------------------------------------------------------------

describe('assertResyncTargetIsTestBubble', () => {
  it('passes only for the Bubble development database (BUBBLE_USE_TEST_VERSION=true)', () => {
    expect(() => assertResyncTargetIsTestBubble()).not.toThrow()
  })

  it('aborts when BUBBLE_USE_TEST_VERSION is unset', () => {
    delete process.env.BUBBLE_USE_TEST_VERSION
    expect(() => assertResyncTargetIsTestBubble()).toThrow(/ENTWICKLUNGS-Datenbank/)
  })

  it('aborts when BUBBLE_USE_TEST_VERSION is "false" — the LIVE database', () => {
    process.env.BUBBLE_USE_TEST_VERSION = 'false'
    expect(() => assertResyncTargetIsTestBubble()).toThrow(/LIVE/)
  })

  it('aborts on any value that is not exactly "true"', () => {
    for (const value of ['TRUE', '1', 'yes', ' true']) {
      process.env.BUBBLE_USE_TEST_VERSION = value
      expect(() => assertResyncTargetIsTestBubble()).toThrow()
    }
  })

  it('aborts when Bubble is not configured at all', () => {
    delete process.env.BUBBLE_API_TOKEN
    expect(() => assertResyncTargetIsTestBubble()).toThrow(/nicht konfiguriert/)
  })

  it('offers no override: the message says so explicitly', () => {
    // The guard takes no flags and reads only the environment — asserting the
    // message keeps anyone from quietly adding a bypass switch later.
    process.env.BUBBLE_USE_TEST_VERSION = 'false'
    expect(() => assertResyncTargetIsTestBubble()).toThrow(/keinen Schalter/)
  })
})

describe('assertJournalMatchesSupabaseTarget (review B-4)', () => {
  it('passes when the journal was written against the current Supabase project', () => {
    expect(() => assertJournalMatchesSupabaseTarget(journalOf([]))).not.toThrow()
  })

  it('aborts when the journal stems from a DIFFERENT Supabase project', () => {
    const foreign = { ...journalOf([]), supabase_url: 'https://anderes-projekt.supabase.co' }
    expect(() => assertJournalMatchesSupabaseTarget(foreign)).toThrow(
      /anderen Supabase-Projekt/
    )
  })

  it('aborts when the current environment has no Supabase URL at all', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    expect(() => assertJournalMatchesSupabaseTarget(journalOf([]))).toThrow(
      /anderen Supabase-Projekt/
    )
  })
})

// ---------------------------------------------------------------------------
// CLI arguments (QA findings: --help, mode/flag consistency)
// ---------------------------------------------------------------------------

describe('parseBackfillCliArgs', () => {
  it('parses the documented fill and resync invocations', () => {
    expect(parseBackfillCliArgs([])).toMatchObject({ help: false, apply: false, resync: false })
    expect(parseBackfillCliArgs(['--apply', '--limit=10'])).toMatchObject({ apply: true, limit: 10 })
    expect(parseBackfillCliArgs(['--resync', '--list'])).toMatchObject({ resync: true, list: true })
    expect(
      parseBackfillCliArgs(['--resync', '--apply', '--journal=scripts/j.json'])
    ).toMatchObject({ resync: true, apply: true, journal: 'scripts/j.json' })
  })

  it('--help wins over everything and never errors', () => {
    expect(parseBackfillCliArgs(['--help']).help).toBe(true)
    // Even combined with otherwise-invalid input: asking for help must succeed.
    expect(parseBackfillCliArgs(['--help', '--unbekannt', '--limit=0']).help).toBe(true)
  })

  it('rejects unknown options', () => {
    expect(() => parseBackfillCliArgs(['--unbekannt'])).toThrow(/Unbekannte Option/)
  })

  it('rejects a non-positive or non-numeric --limit', () => {
    expect(() => parseBackfillCliArgs(['--limit=0'])).toThrow(/positive Zahl/)
    expect(() => parseBackfillCliArgs(['--limit=abc'])).toThrow(/positive Zahl/)
  })

  it('rejects --list without --resync', () => {
    expect(() => parseBackfillCliArgs(['--list'])).toThrow(/--list gehoert zu --resync/)
  })

  it('rejects --journal in fill mode instead of silently ignoring it', () => {
    // QA finding: the fill phase WRITES a journal — an operator passing one in
    // believed it would be read, and must be told it will not be.
    expect(() => parseBackfillCliArgs(['--apply', '--journal=scripts/j.json'])).toThrow(
      /--journal gehoert zu --resync/
    )
  })

  it('rejects --limit in resync mode instead of silently ignoring it', () => {
    // QA finding: the resync scope is always exactly the journal — a --limit
    // suggests a cap that does not exist.
    expect(() => parseBackfillCliArgs(['--resync', '--list', '--limit=5'])).toThrow(
      /--limit gehoert zur Fill-Phase/
    )
  })
})

// ---------------------------------------------------------------------------
// Resync phase
// ---------------------------------------------------------------------------

describe('loadResyncTargets', () => {
  it('returns exactly the journal rows that carry a sync stamp RIGHT NOW', async () => {
    const stamped = row('a', { bubble_id: 'bubble-a', bubble_synced_at: '2026-09-27T06:00:00Z', image_url: 'x' })
    const syncedSinceFill = row('b', { bubble_id: 'bubble-b', bubble_synced_at: '2026-09-28T06:00:00Z', image_url: 'x' })
    const clearedSinceFill = row('c', { image_url: 'x' })
    const notInJournal = row('d', { bubble_id: 'bubble-d', bubble_synced_at: '2026-09-27T06:00:00Z' })
    const { client } = mockBackfillSupabase([stamped, syncedSinceFill, clearedSinceFill, notInJournal])

    const journal = journalOf([
      journalRow('a', { bubble_id: 'bubble-a', bubble_synced_at: '2026-09-27T06:00:00Z' }),
      // Unstamped at fill time, synced (WITH image) afterwards — current stamp counts.
      journalRow('b'),
      // Stamped at fill time, cleared by hand since — must not be cleared twice.
      journalRow('c', { bubble_id: 'bubble-c', bubble_synced_at: '2026-09-27T06:00:00Z' }),
    ])

    const targets = await loadResyncTargets(client, journal)

    // Exactly the journal's currently-stamped rows: never row d (not filled by
    // this run), never row c (stamp already gone).
    expect(targets.map((target) => target.bubble_id).sort()).toEqual(['bubble-a', 'bubble-b'])
  })
})

describe('applyResync', () => {
  it('clears the stamps of the targets and skips rows whose stamp changed meanwhile', async () => {
    const a = row('a', { bubble_id: 'bubble-a', bubble_synced_at: '2026-09-27T06:00:00Z', image_url: 'x' })
    const b = row('b', { bubble_id: 'bubble-b', bubble_synced_at: '2026-09-28T09:00:00Z', image_url: 'x' })
    const { client, rows } = mockBackfillSupabase([a, b])

    const report = await applyResync(client, [
      { id: 'a', url: a.url, title: a.title, bubble_id: 'bubble-a', bubble_synced_at: '2026-09-27T06:00:00Z' },
      // Listed with an older stamp; the sync job restamped the row since.
      { id: 'b', url: b.url, title: b.title, bubble_id: 'bubble-b', bubble_synced_at: '2026-09-28T06:00:00Z' },
    ])

    expect(report).toMatchObject({ cleared: 1, skipped: 1, failures: [] })
    expect(rows.find((candidate) => candidate.id === 'a')).toMatchObject({
      bubble_id: null,
      bubble_synced_at: null,
    })
    expect(rows.find((candidate) => candidate.id === 'b')).toMatchObject({
      bubble_id: 'bubble-b',
      bubble_synced_at: '2026-09-28T09:00:00Z',
    })
  })
})

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

describe('journal', () => {
  it('buildJournal records the Bubble environment the fill ran against', () => {
    const journal = buildJournal([journalRow('a')], 'https://project.supabase.co')
    expect(journal.bubble_environment).toBe('test')
    expect(journal.rows).toHaveLength(1)

    process.env.BUBBLE_USE_TEST_VERSION = 'false'
    expect(buildJournal([], 'x').bubble_environment).toBe('live')

    delete process.env.BUBBLE_API_TOKEN
    expect(buildJournal([], 'x').bubble_environment).toBe('unconfigured')
  })

  it('writeJournalFile / readJournalFile round-trip', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'news21-journal-'))
    mkdirScripts(workdir)
    vi.spyOn(process, 'cwd').mockReturnValue(workdir)

    try {
      const journal = journalOf([journalRow('a', { bubble_id: 'bubble-a' })])
      const path = writeJournalFile(journal)

      expect(path).toContain('.image-backfill-journal-')
      expect(readJournalFile(path)).toEqual(journal)
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  })

  it('readJournalFile rejects a file without a rows array', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'news21-journal-'))
    mkdirScripts(workdir)
    vi.spyOn(process, 'cwd').mockReturnValue(workdir)

    try {
      const path = join(workdir, 'scripts', 'kaputt.json')
      writeFileSync(path, '{"created_at":"x"}', 'utf8')
      expect(() => readJournalFile(path)).toThrow(/rows/)
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  })
})

function mkdirScripts(workdir: string): void {
  mkdirSync(join(workdir, 'scripts'), { recursive: true })
}
