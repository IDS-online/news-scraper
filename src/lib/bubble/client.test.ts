import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildBulkUrl,
  bulkCreate,
  countStatusLines,
  getBubbleConfig,
  parseBulkResponse,
  type BubbleConfig,
} from './client'

const config: BubbleConfig = {
  baseUrl: 'https://example.bubbleapps.io',
  apiToken: 'token',
  dataType: 'newsscraped',
  useTestVersion: false,
}

describe('buildBulkUrl', () => {
  it('targets the live database by default', () => {
    expect(buildBulkUrl(config)).toBe(
      'https://example.bubbleapps.io/api/1.1/obj/newsscraped/bulk'
    )
  })

  it('inserts /version-test when the test version is selected', () => {
    expect(buildBulkUrl({ ...config, useTestVersion: true })).toBe(
      'https://example.bubbleapps.io/version-test/api/1.1/obj/newsscraped/bulk'
    )
  })
})

describe('getBubbleConfig', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.BUBBLE_API_BASE_URL
    delete process.env.BUBBLE_API_TOKEN
    delete process.env.BUBBLE_DATA_TYPE
    delete process.env.BUBBLE_USE_TEST_VERSION
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  it('returns null when a variable is missing', () => {
    process.env.BUBBLE_API_BASE_URL = 'https://example.bubbleapps.io'
    expect(getBubbleConfig()).toBeNull()
  })

  it('strips a trailing slash from the base URL', () => {
    process.env.BUBBLE_API_BASE_URL = 'https://example.bubbleapps.io/'
    process.env.BUBBLE_API_TOKEN = 'token'
    process.env.BUBBLE_DATA_TYPE = 'newsscraped'
    expect(getBubbleConfig()?.baseUrl).toBe('https://example.bubbleapps.io')
  })

  it('only enables the test version for the literal string "true"', () => {
    process.env.BUBBLE_API_BASE_URL = 'https://example.bubbleapps.io'
    process.env.BUBBLE_API_TOKEN = 'token'
    process.env.BUBBLE_DATA_TYPE = 'newsscraped'
    process.env.BUBBLE_USE_TEST_VERSION = 'yes'
    expect(getBubbleConfig()?.useTestVersion).toBe(false)
  })
})

describe('parseBulkResponse', () => {
  it('maps success lines to ids in input order', () => {
    const text = '{"status":"success","id":"a1"}\n{"status":"success","id":"b2"}'
    expect(parseBulkResponse(text)).toEqual([
      { success: true, id: 'a1' },
      { success: true, id: 'b2' },
    ])
  })

  it('keeps a failed line from shifting its neighbours', () => {
    const text =
      '{"status":"success","id":"a1"}\n{"status":"error","message":"missing field"}\n{"status":"success","id":"c3"}'
    const results = parseBulkResponse(text)
    expect(results[0]).toEqual({ success: true, id: 'a1' })
    expect(results[1]).toEqual({ success: false, error: 'missing field' })
    expect(results[2]).toEqual({ success: true, id: 'c3' })
  })

  it('returns exactly one verdict per response line, without padding', () => {
    expect(parseBulkResponse('{"status":"success","id":"a1"}')).toHaveLength(1)
  })

  it('does not report success when the id is missing', () => {
    expect(parseBulkResponse('{"status":"success"}')[0].success).toBe(false)
  })

  // NEWS-19 B-11: an unreadable line must never become an extra verdict — that
  // would shift every following verdict by one position.
  it('throws on a non-JSON line instead of inventing a verdict', () => {
    expect(() => parseBulkResponse('<html>gateway timeout</html>')).toThrow(
      'Unlesbare Antwortzeile'
    )
  })

  it('throws when an unreadable line sits between readable ones', () => {
    expect(() =>
      parseBulkResponse(
        '{"status":"success","id":"a1"}\n<!doctype html>\n{"status":"success","id":"b2"}'
      )
    ).toThrow('Unlesbare Antwortzeile')
  })

  it('never returns more verdicts than the body has non-empty lines', () => {
    const text = '{"status":"success","id":"a1"}\n\n{"status":"success","id":"b2"}\n'
    expect(parseBulkResponse(text)).toHaveLength(2)
  })
})

describe('countStatusLines', () => {
  it('counts success and error verdicts, ignoring blank lines', () => {
    const text = '{"status":"success","id":"1"}\n\n{"status":"error","message":"nope"}\n'
    expect(countStatusLines(text)).toBe(2)
  })

  it('does not count an HTML error page', () => {
    expect(countStatusLines('<html><body>504 Gateway Timeout</body></html>')).toBe(0)
  })

  it('does not count an empty body', () => {
    expect(countStatusLines('')).toBe(0)
  })

  it('does not count JSON that carries no per-record verdict', () => {
    expect(countStatusLines('{"foo":"bar"}\n[1,2]\n42')).toBe(0)
  })
})

describe('bulkCreate', () => {
  const records = [{ Headline_DE: 'a' }, { Headline_DE: 'b' }, { Headline_DE: 'c' }]

  function mockFetch(status: number, body: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: async () => body,
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns an empty result without calling Bubble for an empty input', async () => {
    const fetchMock = mockFetch(200, '')
    await expect(bulkCreate(config, [])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses a plain 200 response', async () => {
    mockFetch(
      200,
      '{"status":"success","id":"1"}\n{"status":"success","id":"2"}\n{"status":"success","id":"3"}'
    )

    await expect(bulkCreate(config, records)).resolves.toEqual([
      { success: true, id: '1' },
      { success: true, id: '2' },
      { success: true, id: '3' },
    ])
  })

  // NEWS-19 B-6: Bubble answers 400 as soon as one line fails, but creates the
  // rest. Throwing here lost the ids of the created records and duplicated them
  // on the next run.
  it('treats a 400 with readable status lines as a partial success', async () => {
    mockFetch(
      400,
      '{"status":"success","id":"1"}\n{"status":"error","message":"Date publishing ungültig"}\n{"status":"success","id":"3"}'
    )

    await expect(bulkCreate(config, records)).resolves.toEqual([
      { success: true, id: '1' },
      { success: false, error: 'Date publishing ungültig' },
      { success: true, id: '3' },
    ])
  })

  // NEWS-19 B-8: the result array is matched to the input by position. If a 400
  // body does not carry exactly one status line per submitted record, that
  // mapping cannot be trusted — an article that never reached Bubble would be
  // stamped as synced and never retried. The whole batch must fail instead.
  it('fails the whole batch when a 400 body has fewer status lines than records', async () => {
    mockFetch(400, '{"status":"success","id":"id-of-b"}\n{"status":"success","id":"id-of-c"}')

    await expect(bulkCreate(config, records)).rejects.toThrow(
      /Antwort nicht zuordenbar \(2 Statuszeilen für 3 Datensätze\)/
    )
  })

  it('fails the whole batch when a 400 body has more status lines than records', async () => {
    mockFetch(
      400,
      '{"status":"success","id":"1"}\n{"status":"success","id":"2"}\n{"status":"success","id":"3"}\n{"status":"success","id":"4"}'
    )

    await expect(bulkCreate(config, records)).rejects.toThrow(
      /Antwort nicht zuordenbar \(4 Statuszeilen für 3 Datensätze\)/
    )
  })

  it('logs the unmappable 400 body so the created records can be reconciled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(400, '{"status":"success","id":"id-of-b"}')

    await expect(bulkCreate(config, records)).rejects.toThrow('Bubble API 400')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('id-of-b'))
  })

  // NEWS-19 B-8: an HTTP 200 is no proof that the body is complete. A truncated
  // or over-long success body would shift every verdict, so it must fail the
  // whole batch exactly like an unmappable non-2xx body — nothing gets stamped.
  it('fails the whole batch when a 200 body has fewer status lines than records', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(200, '{"status":"success","id":"1"}\n{"status":"success","id":"2"}')

    await expect(bulkCreate(config, records)).rejects.toThrow(
      /Antwort nicht zuordenbar \(2 Statuszeilen für 3 Datensätze\)/
    )
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 200'))
  })

  it('fails the whole batch when a 200 body has more status lines than records', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(
      200,
      '{"status":"success","id":"1"}\n{"status":"success","id":"2"}\n{"status":"success","id":"3"}\n{"status":"success","id":"4"}'
    )

    await expect(bulkCreate(config, records)).rejects.toThrow(
      /Antwort nicht zuordenbar \(4 Statuszeilen für 3 Datensätze\)/
    )
  })

  it('logs the unmappable 200 body so the created records can be reconciled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(200, '{"status":"success","id":"id-of-a"}')

    await expect(bulkCreate(config, records)).rejects.toThrow('Bubble API 200')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('id-of-a'))
  })

  it('fails the whole batch when a 200 body is empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(200, '')

    await expect(bulkCreate(config, records)).rejects.toThrow(
      /Antwort nicht zuordenbar \(0 Statuszeilen für 3 Datensätze\)/
    )
  })

  it('still throws on a 401 without status lines', async () => {
    mockFetch(401, '{"statusCode":401,"body":{"reason":"MISSING_TOKEN"}}')

    await expect(bulkCreate(config, records)).rejects.toThrow('Bubble API 401')
  })

  it('still throws on a 5xx HTML error page', async () => {
    mockFetch(502, '<html><body>Bad Gateway</body></html>')

    await expect(bulkCreate(config, records)).rejects.toThrow('Bubble API 502')
  })

  it('rejects an input above the bulk limit before sending', async () => {
    const fetchMock = mockFetch(200, '')
    const tooMany = Array.from({ length: 1001 }, () => ({ Headline_DE: 'x' }))

    await expect(bulkCreate(config, tooMany)).rejects.toThrow('Bubble-Bulk-Limit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // NEWS-19 B-11: countStatusLines() counted only READABLE lines while
  // parseBulkResponse() mapped EVERY non-empty line. A body with one valid
  // verdict per record PLUS an unreadable line therefore passed the count check
  // and returned one verdict too many — the caller stamped an article with a
  // foreign bubble_id and then crashed on the missing batch entry. Both
  // functions now look at the same set of lines; an unreadable non-empty line
  // fails the whole batch.
  describe('unreadable extra lines (B-11)', () => {
    const two = [{ Headline_DE: 'a' }, { Headline_DE: 'b' }]
    const a = '{"status":"success","id":"id-of-a"}'
    const b = '{"status":"success","id":"id-of-b"}'

    it('fails the batch when an HTML prefix precedes the verdicts', async () => {
      mockFetch(400, `<!doctype html>\n${a}\n${b}`)

      await expect(bulkCreate(config, two)).rejects.toThrow(
        /Antwort nicht zuordenbar \(1 unlesbare von 3 Antwortzeilen für 2 Datensätze\)/
      )
    })

    it('fails the batch when an unreadable line sits between the verdicts', async () => {
      mockFetch(400, `${a}\nproxy error: upstream closed\n${b}`)

      await expect(bulkCreate(config, two)).rejects.toThrow('Antwort nicht zuordenbar')
    })

    it('fails the batch when an unreadable line trails the verdicts', async () => {
      mockFetch(200, `${a}\n${b}\n{"foo":"bar"}`)

      await expect(bulkCreate(config, two)).rejects.toThrow('Antwort nicht zuordenbar')
    })

    it('logs the full body of a padded response for reconciliation', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch(400, `<!doctype html>\n${a}\n${b}`)

      await expect(bulkCreate(config, two)).rejects.toThrow('Bubble API 400')
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('id-of-a'))
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unlesbare'))
    })

    it('still accepts a clean body of exactly one verdict per record', async () => {
      mockFetch(200, `${a}\n${b}`)

      await expect(bulkCreate(config, two)).resolves.toEqual([
        { success: true, id: 'id-of-a' },
        { success: true, id: 'id-of-b' },
      ])
    })
  })
})
