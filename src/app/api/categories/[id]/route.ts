import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { updateCategorySchema } from '@/lib/validations/category'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * PUT /api/categories/[id]
 * Update a category. Admin only. Rate limited: 30 req/min.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId } = await requireAdmin()
    const { id } = await params

    const rl = checkRateLimit(`categories:write:${userId}`, { maxRequests: 30, windowSeconds: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Zu viele Anfragen' }, { status: 429, headers: rateLimitHeaders(rl) })
    }

    const body = await request.json()
    const parsed = updateCategorySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { data: category, error } = await supabase
      .from('categories')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating category:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Eine Kategorie mit diesem Namen existiert bereits' },
          { status: 409 }
        )
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Kategorie nicht gefunden' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Fehler beim Aktualisieren der Kategorie' }, { status: 500 })
    }

    return NextResponse.json({ category })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

/**
 * DELETE /api/categories/[id]
 * Delete a category. Admin only. Rate limited: 30 req/min.
 * ON DELETE SET NULL handles articles, ON DELETE CASCADE handles article_categories.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId } = await requireAdmin()
    const { id } = await params

    const rl = checkRateLimit(`categories:write:${userId}`, { maxRequests: 30, windowSeconds: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Zu viele Anfragen' }, { status: 429, headers: rateLimitHeaders(rl) })
    }

    // Check if category exists
    const { data: category, error: fetchError } = await supabase
      .from('categories')
      .select('id, name')
      .eq('id', id)
      .single()

    if (fetchError || !category) {
      return NextResponse.json({ error: 'Kategorie nicht gefunden' }, { status: 404 })
    }

    // Delete the category (ON DELETE SET NULL handles articles, ON DELETE CASCADE handles article_categories)
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting category:', deleteError)
      return NextResponse.json({ error: 'Fehler beim Löschen der Kategorie' }, { status: 500 })
    }

    return NextResponse.json({ message: `Kategorie '${category.name}' wurde gelöscht` })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
