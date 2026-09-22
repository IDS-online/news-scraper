import { NextRequest, NextResponse } from 'next/server'
import { runBubbleSync } from '@/lib/bubble/sync'

// A backlog of up to 1000 articles is sent in batches of 100 — allow 60 seconds.
export const maxDuration = 60

/**
 * POST /api/cron/bubble-sync
 *
 * NEWS-19: pushes articles that are not in Bubble yet into the "News Scraped"
 * data type. Scheduled daily at 06:00 UTC via vercel.json — after the night's
 * scrape runs. Secured by CRON_SECRET, same as the other cron routes.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[BubbleSync] CRON_SECRET environment variable is not set')
    return NextResponse.json({ error: 'Server-Konfigurationsfehler' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    console.log('[BubbleSync] Starte Bubble-Sync...')
    const result = await runBubbleSync()
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[BubbleSync] Unerwarteter Fehler:', message)
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * GET /api/cron/bubble-sync
 *
 * Vercel Cron uses GET. Support both methods, like /api/cron/scrape.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
