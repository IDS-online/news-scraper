import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { updateSourceSchema } from '@/lib/validations/source'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/sources/[id]
 * Get a single source by ID. Available to all authenticated users.
 * Includes category mappings in the response.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase } = await requireAuth()
    const { id } = await params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ error: 'Ungueltige Quellen-ID' }, { status: 400 })
    }

    // Fetch source with default category and category mappings in one query
    const { data: source, error } = await supabase
      .from('sources')
      .select(`
        *,
        default_category:categories(id, name),
        category_mappings:source_category_mappings(
          id,
          source_category_raw,
          category_id,
          category:categories(id, name)
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Quelle nicht gefunden' }, { status: 404 })
      }
      console.error('Error fetching source:', error)
      return NextResponse.json(
        { error: 'Fehler beim Laden der Quelle' },
        { status: 500 }
      )
    }

    return NextResponse.json({ source })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * PUT /api/sources/[id]
 * Update a source. Admin only.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase } = await requireAdmin()
    const { id } = await params

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ error: 'Ungueltige Quellen-ID' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = updateSourceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const input = parsed.data

    // If type is changing to RSS, clear HTML-specific selectors
    // (selector_category is kept since it can apply to RSS too for NEWS-10)
    if (input.type === 'rss') {
      input.selector_container = null
      input.selector_title = null
      input.selector_link = null
      input.selector_description = null
      input.selector_date = null
    }

    const { data: source, error } = await supabase
      .from('sources')
      .update(input)
      .eq('id', id)
      .select('*, default_category:categories(id, name)')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Quelle nicht gefunden' }, { status: 404 })
      }

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

      console.error('Error updating source:', error)
      return NextResponse.json(
        { error: 'Fehler beim Aktualisieren der Quelle' },
        { status: 500 }
      )
    }

    return NextResponse.json({ source })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * DELETE /api/sources/[id]
 * Delete a source. Admin only.
 *
 * Two modes:
 * - DELETE /api/sources/[id] — deletes the source only (articles remain, lose source_id reference)
 * - DELETE /api/sources/[id]?deleteArticles=true — deletes the source AND all associated articles
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase } = await requireAdmin()
    const { id } = await params

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ error: 'Ungueltige Quellen-ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const deleteArticles = searchParams.get('deleteArticles') === 'true'

    // If deleteArticles=true, delete associated articles first
    if (deleteArticles) {
      const { error: articlesError } = await supabase
        .from('articles')
        .delete()
        .eq('source_id', id)

      if (articlesError) {
        console.error('Error deleting articles for source:', articlesError)
        return NextResponse.json(
          { error: 'Fehler beim Loeschen der zugehoerigen Artikel' },
          { status: 500 }
        )
      }
    }

    // Delete the source (source_category_mappings cascade automatically)
    // First check if source exists
    const { data: existing } = await supabase
      .from('sources')
      .select('id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Quelle nicht gefunden' }, { status: 404 })
    }

    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting source:', error)
      return NextResponse.json(
        { error: 'Fehler beim Loeschen der Quelle' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: deleteArticles
        ? 'Quelle und zugehoerige Artikel wurden geloescht'
        : 'Quelle wurde geloescht',
    })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
