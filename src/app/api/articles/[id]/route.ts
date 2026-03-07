import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/articles/[id]
 *
 * Get a single article by UUID.
 * Requires authentication (Bearer JWT).
 *
 * Response: { data: Article } or 404
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase, userId } = await requireAuth()
    const { id } = await params

    // Rate limiting: 120 requests per minute per user (higher for detail views)
    const rateResult = checkRateLimit(`articles:${userId}`, {
      maxRequests: 120,
      windowSeconds: 60,
    })

    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Anfragen. Bitte spaeter erneut versuchen.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: rateLimitHeaders(rateResult) }
      )
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Ungueltige Artikel-ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { data: article, error } = await supabase
      .from('articles')
      .select(
        `
        id,
        title,
        url,
        description,
        image_url,
        published_at,
        language,
        source_id,
        category_id,
        source_category_raw,
        categorization_status,
        created_at,
        source:sources!articles_source_id_fkey(id, name, slug),
        category:categories!articles_category_id_fkey(id, name)
        `
      )
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Artikel nicht gefunden', code: 'NOT_FOUND' },
          { status: 404 }
        )
      }
      console.error('Error fetching article:', error)
      return NextResponse.json(
        { error: 'Fehler beim Laden des Artikels', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    // Flatten source and category into the response
    const { source, category, ...rest } = article as Record<string, unknown>
    const sourceObj = source as { id: string; name: string; slug: string | null } | null
    const categoryObj = category as { id: string; name: string } | null

    const transformedArticle = {
      ...rest,
      source_name: sourceObj?.name ?? null,
      source_slug: sourceObj?.slug ?? null,
      category_name: categoryObj?.name ?? null,
    }

    return NextResponse.json(
      { data: transformedArticle },
      { headers: rateLimitHeaders(rateResult) }
    )
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json(
        { error: authErr.error, code: 'AUTH_ERROR' },
        { status: authErr.status }
      )
    }
    return NextResponse.json(
      { error: 'Interner Serverfehler', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/articles/[id]
 *
 * Delete a single article by UUID.
 * Requires admin role.
 *
 * Response: { message: string } or 404
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase, userId } = await requireAdmin()
    const { id } = await params

    // Rate limiting: 30 deletes per minute per user
    const rateResult = checkRateLimit(`articles-delete:${userId}`, {
      maxRequests: 30,
      windowSeconds: 60,
    })

    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Anfragen. Bitte spaeter erneut versuchen.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: rateLimitHeaders(rateResult) }
      )
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Ungueltige Artikel-ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Check if article exists
    const { data: existing } = await supabase
      .from('articles')
      .select('id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: 'Artikel nicht gefunden', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const { error } = await supabase
      .from('articles')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting article:', error)
      return NextResponse.json(
        { error: 'Fehler beim Loeschen des Artikels', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Artikel wurde geloescht' },
      { headers: rateLimitHeaders(rateResult) }
    )
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json(
        { error: authErr.error, code: 'AUTH_ERROR' },
        { status: authErr.status }
      )
    }
    return NextResponse.json(
      { error: 'Interner Serverfehler', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
