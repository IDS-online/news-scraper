/**
 * NEWS-21: the run-wide time budget for the image fallback.
 *
 * Why this exists at all, and why run-wide rather than per source:
 *
 * `maxDuration = 60` (src/app/api/cron/scrape/route.ts) covers the WHOLE cron
 * invocation, and `runScheduledScrape()` awaits every due source sequentially
 * inside that one invocation. A per-source allowance of ~35 s would therefore
 * permit 6 × 35 s = 210 s inside a 60 s window, and Vercel would kill the
 * function mid-run.
 *
 * A kill is not a harmless timeout here: `releaseLock()` runs in a `finally`
 * block, a hard timeout does not run `finally`, and `acquireLock()` only grants
 * the lock when `scraping_in_progress = false` — there is no stale-lock
 * recovery anywhere in the codebase. A run killed during the fallback phase
 * leaves the source PERMANENTLY locked until someone edits the database by
 * hand. That is what this module prevents.
 *
 * The budget is therefore created once per entry point (`runScheduledScrape()`
 * before the source loop, `scrapeSourceById()` per manual invocation) and
 * simply answers "is there time left?". No timers, no callbacks, no aborting of
 * work already in flight: past the mark, no FURTHER fetch is started and the
 * remaining articles are inserted with `image_url: null`. Nothing fails and no
 * article is dropped — the backfill script
 * (`scripts/backfill-missing-images.ts`) is the standing recovery path for the
 * articles the budget clipped.
 */

/**
 * How much of the 60 s function window the image fallback may consume.
 *
 * ~20 s leaves ~40 s for the scrapes and database work the run cannot skip.
 * At the expected steady-state volume (~10–20 fallback fetches per DAY across
 * all sources, one per newly inserted image-less article) the budget is a
 * backstop that never triggers; it matters on the first run of a new source and
 * after a deploy or outage backlog.
 */
export const FALLBACK_BUDGET_MS = 20_000

export interface RunBudget {
  /** The allowance this budget was created with, in milliseconds. */
  readonly allowanceMs: number
  /** True while a further fallback fetch may be started. */
  hasTimeLeft(): boolean
  /** Milliseconds since the budget was created. */
  elapsedMs(): number
  /** Milliseconds left before the mark; never negative. */
  remainingMs(): number
}

/**
 * Create a budget that starts running now.
 *
 * @param allowanceMs how long fallback fetches may keep being started.
 *   `0` or a negative value yields a budget that is exhausted from the start —
 *   the shape the tests use to prove no fetch is attempted at all.
 * @param now injectable clock, so the deadline maths can be tested without
 *   fake timers.
 */
export function createRunBudget(
  allowanceMs: number = FALLBACK_BUDGET_MS,
  now: () => number = Date.now
): RunBudget {
  const startedAt = now()

  return {
    allowanceMs,
    elapsedMs() {
      return now() - startedAt
    },
    remainingMs() {
      return Math.max(0, allowanceMs - (now() - startedAt))
    },
    hasTimeLeft() {
      return now() - startedAt < allowanceMs
    },
  }
}

/**
 * A budget that never permits a fetch.
 *
 * For callers that want the scraping pipeline without the fallback at all
 * (and for tests asserting the "before the first fetch" check).
 */
export function createExhaustedBudget(): RunBudget {
  return createRunBudget(0)
}
