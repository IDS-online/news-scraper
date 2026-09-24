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
 * Resolves with one result per input record, in input order. Throws when the
 * request itself fails (network, timeout) and whenever the response — 2xx or
 * not — cannot be mapped positionally with certainty, i.e. does not carry
 * exactly one status line per submitted record. Per-record failures that arrive
 * alongside a complete body come back in the array.
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

  const text = await response.text().catch(() => '')

  // The whole result array is matched to the input BY POSITION. That only holds
  // if Bubble returns exactly one status line per submitted record.
  //
  // Bubble answers 400 as soon as ONE line is rejected — the other lines are
  // created regardless and their success lines are in this very body. Judging by
  // the status code alone threw those away and made the caller resend the
  // already-created records on the next run (NEWS-19, B-6). But it has never
  // been verified that such a body still contains the lines of the REJECTED
  // records; if it only carried the created ones, every verdict would shift by
  // one and articles that never reached Bubble would be stamped as synced —
  // permanent, invisible data loss (NEWS-19, B-8).
  //
  // A 2xx body is no safer: a truncated or padded success response would shift
  // the same way. So ANY body — 2xx or not — is only trusted when its
  // status-line count matches the submitted record count exactly. Anything else
  // fails the entire batch: nothing is stamped, the body is logged, and the
  // batch is retried. Resent records may duplicate in Bubble, which is
  // recoverable — a wrong stamp is not.
  // Both checks below look at the SAME set of lines — every non-empty line of the
  // body. Counting only the *readable* status lines while mapping *every*
  // non-empty line let a body with records.length valid verdicts plus one
  // unreadable line (HTML prefix, proxy notice, truncated remainder) pass the
  // count check and then produce one verdict too many, shifting the positional
  // mapping and stamping an article with a foreign bubble_id (NEWS-19, B-11).
  // An unreadable non-empty line is never skipped silently: it makes the whole
  // response unassignable, so the entire batch fails and nothing is stamped.
  const lines = splitResponseLines(text)
  const statusLineCount = countStatusLines(text)

  if (statusLineCount !== lines.length) {
    const unreadable = lines.length - statusLineCount
    console.error(
      `[Bubble] HTTP ${response.status}: ${unreadable} unlesbare von ${lines.length} Antwortzeilen (${records.length} eingereichte Datensätze) — Zuordnung nicht möglich, kompletter Batch gilt als fehlgeschlagen. Body: ${text.slice(0, 2000)}`
    )
    throw new Error(
      `Bubble API ${response.status}: Antwort nicht zuordenbar (${unreadable} unlesbare von ${lines.length} Antwortzeilen für ${records.length} Datensätze): ${text.slice(0, 500) || response.statusText}`
    )
  }

  if (statusLineCount !== records.length) {
    console.error(
      `[Bubble] HTTP ${response.status}: ${statusLineCount} Statuszeilen für ${records.length} eingereichte Datensätze — Zuordnung nicht möglich, kompletter Batch gilt als fehlgeschlagen. Body: ${text.slice(0, 2000)}`
    )
    throw new Error(
      `Bubble API ${response.status}: Antwort nicht zuordenbar (${statusLineCount} Statuszeilen für ${records.length} Datensätze): ${text.slice(0, 500) || response.statusText}`
    )
  }

  if (!response.ok) {
    console.warn(
      `[Bubble] HTTP ${response.status} mit vollständiger Bulk-Antwort (${statusLineCount} Zeilen) — Teil-Erfolg, Zeilen werden ausgewertet`
    )
  }

  return parseBulkResponse(text)
}

/** One parsed line of Bubble's bulk response, or null if it is not one. */
function parseStatusLine(
  line: string
): { status?: string; id?: string; message?: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const candidate = parsed as { status?: unknown; id?: unknown; message?: unknown }

  // A status line always carries at least one of these. Anything else (a bare
  // number, an unrelated error envelope) is not a per-record verdict.
  if (
    typeof candidate.status !== 'string' &&
    typeof candidate.id !== 'string' &&
    typeof candidate.message !== 'string'
  ) {
    return null
  }

  return candidate as { status?: string; id?: string; message?: string }
}

/**
 * How many lines of `text` are readable Bubble status lines.
 *
 * Exported for testing. Used to tell a partial success (HTTP 400 with per-record
 * verdicts) from a genuine transport failure (no verdicts at all).
 */
export function countStatusLines(text: string): number {
  return splitResponseLines(text).filter((line) => parseStatusLine(line) !== null).length
}

/**
 * The lines of a bulk response that carry meaning: every non-empty line.
 *
 * Single source of truth for countStatusLines() and parseBulkResponse(), so the
 * count check and the positional mapping can never disagree (NEWS-19, B-11).
 */
function splitResponseLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '')
}

/**
 * Parse Bubble's newline-delimited bulk response into one verdict per line.
 *
 * Exported for testing. Callers must have verified that the line count matches
 * the submitted record count (see bulkCreate) before mapping the result
 * positionally. Throws when a non-empty line is not a readable status line —
 * such a body cannot be mapped positionally at all (NEWS-19, B-11).
 */
export function parseBulkResponse(text: string): BubbleCreateResult[] {
  const lines = splitResponseLines(text)

  return lines.map((line) => {
    const parsed = parseStatusLine(line)
    if (!parsed) {
      // Not a per-record verdict, so it cannot be turned into one. Returning a
      // failure here would invent an extra result and shift every following
      // verdict by one position (NEWS-19, B-11).
      throw new Error(`Unlesbare Antwortzeile: ${line.slice(0, 200)}`)
    }
    if (parsed.status === 'success' && parsed.id) {
      return { success: true, id: parsed.id }
    }
    return { success: false, error: parsed.message ?? line.slice(0, 200) }
  })
}
