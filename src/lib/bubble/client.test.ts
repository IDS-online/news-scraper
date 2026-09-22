import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildBulkUrl,
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
    expect(parseBulkResponse(text, 2)).toEqual([
      { success: true, id: 'a1' },
      { success: true, id: 'b2' },
    ])
  })

  it('keeps a failed line from shifting its neighbours', () => {
    const text =
      '{"status":"success","id":"a1"}\n{"status":"error","message":"missing field"}\n{"status":"success","id":"c3"}'
    const results = parseBulkResponse(text, 3)
    expect(results[0]).toEqual({ success: true, id: 'a1' })
    expect(results[1]).toEqual({ success: false, error: 'missing field' })
    expect(results[2]).toEqual({ success: true, id: 'c3' })
  })

  it('treats a truncated response as failures, never as success', () => {
    const results = parseBulkResponse('{"status":"success","id":"a1"}', 3)
    expect(results).toHaveLength(3)
    expect(results[1].success).toBe(false)
    expect(results[2].success).toBe(false)
  })

  it('does not report success when the id is missing', () => {
    expect(parseBulkResponse('{"status":"success"}', 1)[0].success).toBe(false)
  })

  it('survives a non-JSON line', () => {
    const results = parseBulkResponse('<html>gateway timeout</html>', 1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Unlesbare Antwortzeile')
  })
})
