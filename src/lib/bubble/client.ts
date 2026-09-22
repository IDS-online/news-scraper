/**
 * NEWS-19: thin client for the Bubble Data API.
 *
 * Only the bulk-create endpoint is used. Bubble's bulk format is unusual and
 * easy to get wrong, so it is encapsulated here:
 *  - Body is newline-delimited JSON (one object per line), content-type text/plain.
 *  - The response is newline-delimited too, one status line per submitted line,
 *    in the same order — and a line can fail while its neighbours succeed.
 *  - HTTP 200 therefore does NOT mean every record was created.
 */

import type { BubbleRecord } from './mapping'

/** Bubble rejects bulk requests above 1000 lines. */
export const BUBBLE_BULK_LIMIT = 1000

const REQUEST_TIMEOUT_MS = 30_000

export interface BubbleConfig {
  /** e.g. https://myapp.bubbleapps.io — no trailing slash, no /api path. */
  baseUrl: string
  apiToken: string
  /** API name of the data type, e.g. "newsscraped". */
  dataType: string
  /** true → write to the development database (/version-test). */
  useTestVersion: boolean
}

/** Outcome of one submitted record, positionally matched to the input. */
export interface BubbleCreateResult {
  success: boolean
  /** Bubble's unique id — present only on success. */
  id?: string
  error?: string
}

/**
 * Read the Bubble configuration from the environment.
 * Returns null when the integration is not configured, so callers can skip the
 * sync cleanly instead of crashing a cron run.
 */
export function getBubbleConfig(): BubbleConfig | null {
  const baseUrl = process.env.BUBBLE_API_BASE_URL?.trim()
  const apiToken = process.env.BUBBLE_API_TOKEN?.trim()
  const dataType = process.env.BUBBLE_DATA_TYPE?.trim()

  if (!baseUrl || !apiToken || !dataType) return null

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiToken,
    dataType,
    useTestVersion: process.env.BUBBLE_USE_TEST_VERSION === 'true',
  }
}

/** Build the bulk endpoint URL for the configured data type. */
export function buildBulkUrl(config: BubbleConfig): string {
  const versionPath = config.useTestVersion ? '/version-test' : ''
  return `${config.baseUrl}${versionPath}/api/1.1/obj/${config.dataType}/bulk`
}

/**
 * Create up to BUBBLE_BULK_LIMIT records in one call.
 *
 * Resolves with one result per input record, in input order. Throws only when
 * the request itself fails (network, timeout, non-2xx) — per-record failures
 * come back inside the result array.
 */
export async function bulkCreate(
  config: BubbleConfig,
  records: BubbleRecord[]
): Promise<BubbleCreateResult[]> {
  if (records.length === 0) return []
  if (records.length > BUBBLE_BULK_LIMIT) {
    throw new Error(
      `Bubble-Bulk-Limit überschritten: ${records.length} > ${BUBBLE_BULK_LIMIT}`
    )
  }

  const body = records.map((record) => JSON.stringify(record)).join('\n')

  const response = await fetch(buildBulkUrl(config), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'text/plain',
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Bubble API ${response.status}: ${detail || response.statusText}`)
  }

  return parseBulkResponse(await response.text(), records.length)
}

/**
 * Parse Bubble's newline-delimited bulk response.
 *
 * Exported for testing. A line Bubble did not return (truncated response) is
 * reported as a failure rather than silently dropped — otherwise the caller
 * would mark an unsent article as synced.
 */
export function parseBulkResponse(
  text: string,
  expectedCount: number
): BubbleCreateResult[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '')

  const results: BubbleCreateResult[] = lines.map((line) => {
    try {
      const parsed = JSON.parse(line) as {
        status?: string
        id?: string
        message?: string
      }
      if (parsed.status === 'success' && parsed.id) {
        return { success: true, id: parsed.id }
      }
      return { success: false, error: parsed.message ?? line.slice(0, 200) }
    } catch {
      return { success: false, error: `Unlesbare Antwortzeile: ${line.slice(0, 200)}` }
    }
  })

  while (results.length < expectedCount) {
    results.push({ success: false, error: 'Keine Antwortzeile von Bubble erhalten' })
  }

  return results.slice(0, expectedCount)
}
