import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { createSourceSchema } from '@/lib/validations/source'

const PAGE_SIZE = 25

/**
 * GET /api/sources
 * List all sources with pagination. Available to all authenticated users.
 * Query params: ?page=1&active=true&type=rss
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireAuth()

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const activeFilter = searchParams.get('active')
    const typeFilter = searchParams.get('type')
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('sources')
      .select('*, default_category:categories(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (activeFilter !== null) {
      query = query.eq('is_active', activeFilter === 'true')
    }

    if (typeFilter && (typeFilter === 'rss' || typeFilter === 'html')) {
      query = query.eq('type', typeFilter)
    }

    const { data: sources, error, count } = await query

    if (error) {
      console.error('Error fetching sources:', error)
      return NextResponse.json(
        { error: 'Fehler beim Laden der Quellen' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      sources,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
      },
    })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * POST /api/sources
 * Create a new source. Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin()

    const body = await request.json()
    const parsed = createSourceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const input = parsed.data

    // Nullify HTML selectors if type is RSS (they are irrelevant)
    const sourceData: Record<string, unknown> = {
      name: input.name,
      url: input.url,
      type: input.type,
      language: input.language,
      interval_minutes: input.interval_minutes,
      is_active: input.is_active,
      slug: input.slug ?? null,
      default_category_id: input.default_category_id ?? null,
      retention_days: input.retention_days ?? null,
      selector_container: input.type === 'html' ? (input.selector_container ?? null) : null,
      selector_title: input.type === 'html' ? (input.selector_title ?? null) : null,
      selector_link: input.type === 'html' ? (input.selector_link ?? null) : null,
      selector_description: input.type === 'html' ? (input.selector_description ?? null) : null,
      selector_date: input.type === 'html' ? (input.selector_date ?? null) : null,
      selector_category: input.selector_category ?? null,
    }

    const { data: source, error } = await supabase
      .from('sources')
      .insert(sourceData)
      .select('*, default_category:categories(id, name)')
      .single()

    if (error) {
      console.error('Error creating source:', error)

      // Handle unique constraint violations
      if (error.code === '23505') {
        if (error.message.includes('slug')) {
          return NextResponse.json(
            { error: `Slug '${input.slug}' ist bereits in Verwendung` },
            { status: 409 }
          )
        }
        return NextResponse.json(
          { error: 'Eindeutigkeitsverletzung' },
          { status: 409 }
        )
      }

      return NextResponse.json(
        { error: 'Fehler beim Erstellen der Quelle' },
        { status: 500 }
      )
    }

    return NextResponse.json({ source }, { status: 201 })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
