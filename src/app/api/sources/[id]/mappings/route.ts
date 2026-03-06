import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { sourceCategoryMappingsArraySchema } from '@/lib/validations/source'

type RouteParams = { params: Promise<{ id: string }> }

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/sources/[id]/mappings
 * List all category mappings for a source. Available to all authenticated users.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase } = await requireAuth()
    const { id } = await params

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Ungueltige Quellen-ID' }, { status: 400 })
    }

    const { data: mappings, error } = await supabase
      .from('source_category_mappings')
      .select(`
        id,
        source_category_raw,
        category_id,
        category:categories(id, name),
        created_at
      `)
      .eq('source_id', id)
      .order('source_category_raw', { ascending: true })

    if (error) {
      console.error('Error fetching mappings:', error)
      return NextResponse.json(
        { error: 'Fehler beim Laden der Kategorie-Mappings' },
        { status: 500 }
      )
    }

    return NextResponse.json({ mappings })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * PUT /api/sources/[id]/mappings
 * Replace all category mappings for a source (full sync). Admin only.
 * Accepts an array of { source_category_raw, category_id } objects.
 * Deletes existing mappings and inserts the new set.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { supabase } = await requireAdmin()
    const { id } = await params

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Ungueltige Quellen-ID' }, { status: 400 })
    }

    // Verify source exists
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('id')
      .eq('id', id)
      .single()

    if (sourceError || !source) {
      return NextResponse.json({ error: 'Quelle nicht gefunden' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = sourceCategoryMappingsArraySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const mappingsInput = parsed.data

    // Delete existing mappings for this source
    const { error: deleteError } = await supabase
      .from('source_category_mappings')
      .delete()
      .eq('source_id', id)

    if (deleteError) {
      console.error('Error deleting existing mappings:', deleteError)
      return NextResponse.json(
        { error: 'Fehler beim Aktualisieren der Kategorie-Mappings' },
        { status: 500 }
      )
    }

    // Insert new mappings (if any)
    if (mappingsInput.length > 0) {
      const rows = mappingsInput.map((m) => ({
        source_id: id,
        source_category_raw: m.source_category_raw,
        category_id: m.category_id,
      }))

      const { error: insertError } = await supabase
        .from('source_category_mappings')
        .insert(rows)

      if (insertError) {
        console.error('Error inserting mappings:', insertError)

        if (insertError.code === '23505') {
          return NextResponse.json(
            { error: 'Doppelte Quellen-Kategorie im Mapping' },
            { status: 409 }
          )
        }

        if (insertError.code === '23503') {
          return NextResponse.json(
            { error: 'Eine referenzierte Kategorie existiert nicht' },
            { status: 400 }
          )
        }

        return NextResponse.json(
          { error: 'Fehler beim Speichern der Kategorie-Mappings' },
          { status: 500 }
        )
      }
    }

    // Return the updated mappings
    const { data: mappings, error: fetchError } = await supabase
      .from('source_category_mappings')
      .select(`
        id,
        source_category_raw,
        category_id,
        category:categories(id, name),
        created_at
      `)
      .eq('source_id', id)
      .order('source_category_raw', { ascending: true })

    if (fetchError) {
      console.error('Error fetching updated mappings:', fetchError)
      return NextResponse.json(
        { error: 'Mappings gespeichert, aber Fehler beim Laden der aktualisierten Daten' },
        { status: 500 }
      )
    }

    return NextResponse.json({ mappings })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
