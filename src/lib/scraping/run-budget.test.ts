import { describe, it, expect } from 'vitest'
import {
  FALLBACK_BUDGET_MS,
  createExhaustedBudget,
  createRunBudget,
} from '@/lib/scraping/run-budget'

/** A clock the test moves by hand, so no fake timers are needed. */
function clock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('createRunBudget', () => {
  it('has time left immediately after creation', () => {
    const budget = createRunBudget(20_000, clock().now)
    expect(budget.hasTimeLeft()).toBe(true)
    expect(budget.elapsedMs()).toBe(0)
    expect(budget.remainingMs()).toBe(20_000)
  })

  it('still has time left just before the mark', () => {
    const time = clock()
    const budget = createRunBudget(20_000, time.now)
    time.advance(19_999)
    expect(budget.hasTimeLeft()).toBe(true)
    expect(budget.remainingMs()).toBe(1)
  })

  it('is exhausted exactly at the mark', () => {
    const time = clock()
    const budget = createRunBudget(20_000, time.now)
    time.advance(20_000)
    expect(budget.hasTimeLeft()).toBe(false)
    expect(budget.remainingMs()).toBe(0)
  })

  it('never reports a negative remainder once overrun', () => {
    const time = clock()
    const budget = createRunBudget(20_000, time.now)
    time.advance(95_000)
    expect(budget.remainingMs()).toBe(0)
    expect(budget.elapsedMs()).toBe(95_000)
    expect(budget.hasTimeLeft()).toBe(false)
  })

  it('defaults to the documented allowance', () => {
    expect(createRunBudget().allowanceMs).toBe(FALLBACK_BUDGET_MS)
    // The allowance must leave room for the scrapes and DB work inside the
    // route's maxDuration = 60. A budget that grew past that silently would
    // reintroduce the "killed run leaves the source locked forever" defect.
    expect(FALLBACK_BUDGET_MS).toBeLessThan(60_000 / 2)
  })

  it('treats a zero allowance as exhausted from the start', () => {
    const budget = createRunBudget(0, clock().now)
    expect(budget.hasTimeLeft()).toBe(false)
  })

  it('createExhaustedBudget never permits a fetch', () => {
    expect(createExhaustedBudget().hasTimeLeft()).toBe(false)
  })
})
