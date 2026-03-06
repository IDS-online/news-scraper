/**
 * Simple in-memory rate limiter for API routes.
 *
 * Uses a sliding window approach. NOT suitable for multi-instance deployments —
 * for production at scale, use Redis or Upstash Rate Limit.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries periodically (every 60 seconds)
const CLEANUP_INTERVAL_MS = 60_000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Allow the process to exit even if the timer is running
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref()
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests in the window */
  maxRequests: number
  /** Window size in seconds */
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Check and consume a rate limit token for the given key.
 *
 * @param key - Unique identifier for the client (e.g., user ID or IP)
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed, remaining quota, and reset time
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  startCleanup()

  const now = Date.now()
  const entry = store.get(key)

  // No existing entry or window expired — start fresh
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + config.windowSeconds * 1000
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt }
  }

  // Window is still active
  if (entry.count < config.maxRequests) {
    entry.count++
    return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt }
  }

  // Rate limit exceeded
  return { allowed: false, remaining: 0, resetAt: entry.resetAt }
}

/**
 * Create rate limit headers for the response.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.remaining + (result.allowed ? 0 : 0)),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  }
}
