import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { articlesQuerySchema } from '@/lib/validations/article'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * GET /api/articles
 *
 * List articles with pagination and filters.
 * Requires authentication (Bearer JWT).
 *
 * Query parameters:
 *   page       - Page number (default: 1, min: 1)
 *   limit      - Items per page (default: 20, max: 100)
 *   source_id  - Filter by source UUID
 *   category_id - Filter by category UUID
 *   language   - Filter by language code (e.g. "de", "en")
 *   from       - Filter articles published after this ISO 8601 date
 *   to         - Filter articles published before this ISO 8601 date
 *   search     - Full-text search on article title (ILIKE)
 *
 * Response: { data: Article[], total: number, page: number, limit: number }
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, userId } = await requireAuth()

    // Rate limiting: 60 requests per minute per user
    const rateResult = checkRateLimit(`articles:${userId}`, {
      maxRequests: 60,
      windowSeconds: 60,
    })

    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Anfragen. Bitte spaeter erneut versuchen.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: rateLimitHeaders(rateResult) }
      )
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url)
    const rawParams = {
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      source_id: searchParams.get('source_id') ?? undefined,
      category_id: searchParams.get('category_id') ?? undefined,
      language: searchParams.get('language') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    }

    const parsed = articlesQuerySchema.safeParse(rawParams)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Ungueltige Abfrageparameter',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { page, limit, source_id, category_id, language, from, to, search } = parsed.data

    // Calculate range for pagination
    const rangeFrom = (page - 1) * limit
    const rangeTo = rangeFrom + limit - 1

    // Build query with source join to include source_name
    let query = supabase
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
        `,
        { count: 'exact' }
      )
      .order('published_at', { ascending: false })
      .range(rangeFrom, rangeTo)

    // Apply filters
    if (source_id) {
      query = query.eq('source_id', source_id)
    }

    if (category_id) {
      query = query.eq('category_id', category_id)
    }

    if (language) {
      query = query.eq('language', language)
    }

    if (from) {
      query = query.gte('published_at', from)
    }

    if (to) {
      query = query.lte('published_at', to)
    }

    if (search) {
      // Use ILIKE for case-insensitive title search
      // Supabase handles parameterization, preventing SQL injection
      query = query.ilike('title', `%${search}%`)
    }

    const { data: articles, error, count } = await query

    if (error) {
      console.error('Error fetching articles:', error)
      return NextResponse.json(
        { error: 'Fehler beim Laden der Artikel', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    // Transform articles to flatten source_name into the response
    const transformedArticles = (articles ?? []).map((article) => {
      const { source, category, ...rest } = article as Record<string, unknown>
      const sourceObj = source as { id: string; name: string; slug: string | null } | null
      const categoryObj = category as { id: string; name: string } | null
      return {
        ...rest,
        source_name: sourceObj?.name ?? null,
        source_slug: sourceObj?.slug ?? null,
        category_name: categoryObj?.name ?? null,
      }
    })

    return NextResponse.json(
      {
        data: transformedArticles,
        total: count ?? 0,
        page,
        limit,
      },
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
