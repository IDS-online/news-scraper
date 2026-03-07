import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { detectFeeds } from '@/lib/scraping/feed-detector'
import { z } from 'zod'

const detectFeedsSchema = z.object({
  url: z.string().min(1, 'URL ist erforderlich').max(2048),
})

/**
 * POST /api/sources/detect-feeds
 * Detects valid RSS/Atom feeds for a given website URL.
 * Admin only. Rate limited: 10 req/min.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAdmin()

    const rl = checkRateLimit(`detect-feeds:${userId}`, { maxRequests: 10, windowSeconds: 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Anfragen' },
        { status: 429, headers: rateLimitHeaders(rl) }
      )
    }

    const body = await request.json()
    const parsed = detectFeedsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const feeds = await detectFeeds(parsed.data.url)

    return NextResponse.json(
      { feeds },
      { headers: rateLimitHeaders(rl) }
    )
  } catch (err: unknown) {
    // AbortController timeout
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Zeitüberschreitung bei der Feed-Erkennung (max. 10 Sekunden)' },
        { status: 408 }
      )
    }

    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
