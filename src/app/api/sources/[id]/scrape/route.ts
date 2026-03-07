import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { scrapeSourceById } from '@/lib/scraping/scheduler'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/sources/[id]/scrape
 *
 * Manually trigger a scrape for a specific source.
 * Admin only. Calls the same scheduler logic as the cron job.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    await requireAdmin()
    const { id } = await params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Ungueltige Quellen-ID' },
        { status: 400 }
      )
    }

    console.log(`[ManualScrape] Triggering scrape for source ${id}`)
    const result = await scrapeSourceById(id)
    console.log(`[ManualScrape] Result:`, JSON.stringify(result))

    if (result.skipped_reason) {
      return NextResponse.json(
        {
          message: result.skipped_reason,
          result,
        },
        { status: 409 }
      )
    }

    if (result.errors.length > 0 && result.articles_inserted === 0) {
      return NextResponse.json(
        {
          message: 'Scraping abgeschlossen mit Fehlern',
          result,
        },
        { status: 207 }
      )
    }

    return NextResponse.json({
      message: `Scraping abgeschlossen: ${result.articles_inserted} neue Artikel eingefuegt`,
      result,
    })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json(
        { error: authErr.error },
        { status: authErr.status }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ManualScrape] Unexpected error:', message)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
