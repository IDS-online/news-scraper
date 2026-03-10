import { NextRequest, NextResponse } from 'next/server'
import { runScheduledScrape } from '@/lib/scraping/scheduler'

// Allow up to 60 seconds for scraping multiple sources
export const maxDuration = 60

/**
 * POST /api/cron/scrape
 *
 * Triggered by Vercel Cron Jobs every 15 minutes.
 * Secured by CRON_SECRET — Vercel sends this as the Authorization header.
 *
 * Finds all active sources that are due for scraping and processes them.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the CRON_SECRET
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[Cron] CRON_SECRET environment variable is not set')
      return NextResponse.json(
        { error: 'Server-Konfigurationsfehler' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting scheduled scrape run...')
    const results = await runScheduledScrape()

    const summary = {
      total_sources: results.length,
      total_articles_found: results.reduce((sum, r) => sum + r.articles_found, 0),
      total_articles_inserted: results.reduce((sum, r) => sum + r.articles_inserted, 0),
      sources_with_errors: results.filter((r) => r.errors.length > 0).length,
      sources_skipped: results.filter((r) => r.skipped_reason).length,
    }

    console.log('[Cron] Scrape run complete:', summary)

    return NextResponse.json({ summary, results })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Cron] Unexpected error:', message)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/cron/scrape
 *
 * Vercel Cron can also use GET. Support both methods.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
