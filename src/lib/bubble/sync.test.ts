import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { bulkCreate, createClient } = vi.hoisted(() => ({
  bulkCreate: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, bulkCreate }
})

vi.mock('@supabase/supabase-js', () => ({ createClient }))

import { runBubbleSync } from './sync'

interface ArticleRow {
  id: string
  title: string
  url: string
  description: string | null
  image_url: string | null
  language: string
  published_at: string
  source_category_raw: string | null
  sources: { name: string } | null
}

function article(id: string, overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id,
    title: `Titel ${id}`,
    url: `https://www.example.com/${id}`,
    description: null,
    image_url: null,
    language: 'de',
    published_at: '2026-09-23T06:00:00.000Z',
    source_category_raw: null,
    sources: { name: 'Example' },
    ...overrides,
  }
}

/**
 * Minimal stand-in for the Supabase client: records every stamp update and
 * hands back the rows the test configured.
 */
function mockSupabase(options: {
  rows: ArticleRow[]
  loadError?: { message: string }
  updateError?: (id: string) => { message: string } | null
}) {
  const updates: { id: string; values: Record<string, unknown> }[] = []

  const client = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => ({
            limit: async () => ({
              data: options.loadError ? null : options.rows,
              error: options.loadError ?? null,
            }),
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          updates.push({ id, values })
          return { data: null, error: options.updateError?.(id) ?? null }
        },
      }),
    }),
  }

  return { client, updates }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  process.env.BUBBLE_API_BASE_URL = 'https://example.bubbleapps.io'
  process.env.BUBBLE_API_TOKEN = 'token'
  process.env.BUBBLE_DATA_TYPE = 'newsscraped'
  process.env.BUBBLE_USE_TEST_VERSION = 'true'
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...savedEnv }
})

describe('runBubbleSync', () => {
  it('skips cleanly when Bubble is not configured', async () => {
    delete process.env.BUBBLE_API_TOKEN

    const result = await runBubbleSync()

    expect(result.skipped_reason).toContain('BUBBLE_API_TOKEN')
    expect(result.articles_pending).toBe(0)
    expect(bulkCreate).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('does nothing when no article is pending', async () => {
    const { client, updates } = mockSupabase({ rows: [] })
    createClient.mockReturnValue(client)

    const result = await runBubbleSync()

    expect(result).toMatchObject({
      articles_pending: 0,
      articles_synced: 0,
      articles_failed: 0,
    })
    expect(bulkCreate).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('stamps only the articles Bubble accepted', async () => {
    const { client, updates } = mockSupabase({
      rows: [article('a'), article('b'), article('c')],
    })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([
      { success: true, id: 'bubble-a' },
      { success: false, error: 'Date publishing ist ungültig' },
      { success: true, id: 'bubble-c' },
    ])

    const result = await runBubbleSync()

    expect(result.articles_pending).toBe(3)
    expect(result.articles_synced).toBe(2)
    expect(result.articles_failed).toBe(1)
    expect(result.errors).toEqual(['"Titel b": Date publishing ist ungültig'])

    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'c'])
    expect(updates.find((u) => u.id === 'a')?.values.bubble_id).toBe('bubble-a')
    expect(updates.find((u) => u.id === 'c')?.values.bubble_id).toBe('bubble-c')
    for (const update of updates) {
      expect(typeof update.values.bubble_synced_at).toBe('string')
    }
  })

  it('maps the article into the Bubble record shape', async () => {
    const { client } = mockSupabase({
      rows: [
        article('a', {
          description: 'Teaser',
          image_url: 'https://cdn.example.com/a.jpg',
        }),
      ],
    })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([{ success: true, id: 'bubble-a' }])

    await runBubbleSync()

    const [, records] = bulkCreate.mock.calls[0]
    expect(records).toEqual([
      {
        Headline_DE: 'Titel a',
        Subheadline_DE: 'Titel a',
        'Link Source URL': 'https://www.example.com/a',
        'Date publishing': '2026-09-23T06:00:00.000Z',
        Teaser_Text_DE: 'Teaser',
        Picture: 'https://cdn.example.com/a.jpg',
        'Picture URL': 'https://cdn.example.com/a.jpg',
        Publisher: 'example.com',
      },
    ])
  })

  it('fails a whole batch when the Bubble call throws, without stamping', async () => {
    const { client, updates } = mockSupabase({ rows: [article('a'), article('b')] })
    createClient.mockReturnValue(client)
    bulkCreate.mockRejectedValue(new Error('Bubble API 502: Bad Gateway'))

    const result = await runBubbleSync()

    expect(result.articles_synced).toBe(0)
    expect(result.articles_failed).toBe(2)
    expect(result.errors[0]).toContain('Bubble API 502')
    expect(updates).toEqual([])
  })

  it('reports an article that reached Bubble but could not be stamped', async () => {
    const { client } = mockSupabase({
      rows: [article('a')],
      updateError: () => ({ message: 'connection reset' }),
    })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([{ success: true, id: 'bubble-a' }])

    const result = await runBubbleSync()

    expect(result.articles_synced).toBe(0)
    expect(result.errors[0]).toContain('konnte aber nicht als synchronisiert markiert werden')
    expect(result.errors[0]).toContain('connection reset')
  })

  it('splits a backlog into batches of 100 and keeps stamping across them', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => article(`a${i}`))
    const { client, updates } = mockSupabase({ rows })
    createClient.mockReturnValue(client)
    bulkCreate.mockImplementation(async (_config, records: unknown[]) =>
      records.map((_, i) => ({ success: true, id: `bubble-${i}` }))
    )

    const result = await runBubbleSync()

    expect(bulkCreate).toHaveBeenCalledTimes(3)
    expect(bulkCreate.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 50])
    expect(result.articles_synced).toBe(250)
    expect(updates).toHaveLength(250)
  })

  it('throws when the articles cannot be loaded', async () => {
    const { client } = mockSupabase({ rows: [], loadError: { message: 'timeout' } })
    createClient.mockReturnValue(client)

    await expect(runBubbleSync()).rejects.toThrow('timeout')
  })

  // NEWS-19 B-11: guard rail. Should bulkCreate() ever hand back a different
  // number of verdicts than records submitted, the batch must fail — not stamp
  // articles with a foreign bubble_id and abort the run on the missing entry.
  it('fails the batch when Bubble returns more results than records, without stamping', async () => {
    const { client, updates } = mockSupabase({ rows: [article('a'), article('b')] })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([
      { success: true, id: 'id-of-a' },
      { success: true, id: 'id-of-b' },
      { success: true, id: 'id-of-ghost' },
    ])

    const result = await runBubbleSync()

    expect(updates).toEqual([])
    expect(result.articles_synced).toBe(0)
    expect(result.articles_failed).toBe(2)
    expect(result.errors[0]).toContain('3 Ergebnisse für 2 Datensätze')
  })

  it('fails the batch when Bubble returns fewer results than records', async () => {
    const { client, updates } = mockSupabase({ rows: [article('a'), article('b')] })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([{ success: true, id: 'id-of-a' }])

    const result = await runBubbleSync()

    expect(updates).toEqual([])
    expect(result.articles_failed).toBe(2)
  })

  it('keeps later batches running after a mismatching one', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => article(`a${i}`))
    const { client, updates } = mockSupabase({ rows })
    createClient.mockReturnValue(client)
    bulkCreate
      .mockResolvedValueOnce([{ success: true, id: 'id-of-a' }])
      .mockImplementationOnce(async (_config, records: unknown[]) =>
        records.map((_, i) => ({ success: true, id: `bubble-${i}` }))
      )

    const result = await runBubbleSync()

    expect(bulkCreate).toHaveBeenCalledTimes(2)
    expect(result.articles_failed).toBe(100)
    expect(result.articles_synced).toBe(50)
    expect(updates).toHaveLength(50)
  })

  it('normalises the embedded source relation returned as an array', async () => {
    const rows = [article('a', { sources: [{ name: 'Example' }] as never })]
    const { client } = mockSupabase({ rows })
    createClient.mockReturnValue(client)
    bulkCreate.mockResolvedValue([{ success: true, id: 'bubble-a' }])

    const result = await runBubbleSync()

    expect(result.articles_synced).toBe(1)
  })
})
