import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { z } from 'zod'

const updateSettingsSchema = z.object({
  retention_enabled: z.boolean(),
})

/**
 * GET /api/admin/settings
 * Read system settings. Admin only.
 */
export async function GET() {
  try {
    const { supabase } = await requireAdmin()

    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value, updated_at')

    if (error) {
      console.error('Error fetching system settings:', error)
      return NextResponse.json({ error: 'Fehler beim Laden der Einstellungen' }, { status: 500 })
    }

    // Convert rows to a key-value object
    const settings: Record<string, string> = {}
    for (const row of data ?? []) {
      settings[row.key] = row.value
    }

    // Fetch last retention run summary
    const { data: lastRun } = await supabase
      .from('retention_log')
      .select('run_at, deleted_count')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      settings: {
        retention_enabled: settings['retention_enabled'] === 'true',
      },
      last_retention_run: lastRun ?? null,
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
 * PUT /api/admin/settings
 * Update system settings. Admin only.
 */
export async function PUT(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin()

    const body = await request.json()
    const parsed = updateSettingsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validierungsfehler', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('system_settings')
      .update({ value: String(parsed.data.retention_enabled), updated_at: new Date().toISOString() })
      .eq('key', 'retention_enabled')

    if (error) {
      console.error('Error updating system settings:', error)
      return NextResponse.json({ error: 'Fehler beim Speichern der Einstellungen' }, { status: 500 })
    }

    return NextResponse.json({
      settings: { retention_enabled: parsed.data.retention_enabled },
    })
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    if (authErr.status && authErr.error) {
      return NextResponse.json({ error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
