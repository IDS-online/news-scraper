import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { createCategorySchema } from '@/lib/validations/category'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * GET /api/categories
 * List all categories with combined article count (articles.category_id + article_categories).
 * Available to all authenticated users. Rate limited: 60 req/min.
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, userId } = await requireAuth()

    const rl = checkRateLimit(`categories:${userId}`, { maxRequests: 60, windowSeconds: 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Anfragen' },
        { status: 429, headers: rateLimitHeaders(rl) }
      )
    }

    const [categoriesResult, countsResult] = await Promise.all([
      supabase.from('categories').select('*').order('name', { ascending: true }).limit(500),
      supabase.rpc('get_all_category_article_counts'),
    ])

    if (categoriesResult.error) {
      console.error('Error fetching categories:', categoriesResult.error)
      return NextResponse.json({ error: 'Fehler beim Laden der Kategorien' }, { status: 500 })
    }

    if (countsResult.error) {
      console.error('Error fetching article counts:', countsResult.error)
    }

    // Build a lookup map: category_id → article_count
    const countMap = new Map<string, number>()
    for (const row of countsResult.data ?? []) {
      countMap.set(row.category_id, Number(row.article_count))
    }

    const categoriesWithCount = (categoriesResult.data ?? []).map((category) => ({
      ...category,
      article_count: countMap.get(category.id) ?? 0,
    }))

    return NextResponse.json(
      { data: categoriesWithCount },
      { headers: rateLimitHeaders(rl) }
    )
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * POST /api/categories
 * Create a new category. Admin only. Rate limited: 30 req/min.
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, userId } = await requireAdmin()

    const rl = checkRateLimit(`categories:write:${userId}`, { maxRequests: 30, windowSeconds: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Zu viele Anfragen' }, { status: 429, headers: rateLimitHeaders(rl) })
    }

    const body = await request.json()
    const parsed = createCategorySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { data: category, error } = await supabase
      .from('categories')
      .insert(parsed.data)
      .select()
      .single()

    if (error) {
      console.error('Error creating category:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `Eine Kategorie mit dem Namen '${parsed.data.name}' existiert bereits` },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'Fehler beim Erstellen der Kategorie' }, { status: 500 })
    }

    return NextResponse.json({ category }, { status: 201 })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
