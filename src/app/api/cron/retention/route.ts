import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/cron/retention
 * Daily retention job — deletes articles older than each source's retention_days.
 * Secured by CRON_SECRET header. Uses service role key to bypass RLS.
 * Scheduled: daily at 03:00 UTC via vercel.json.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    console.error('[Retention] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })

  // Check global retention switch
  const { data: setting, error: settingError } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'retention_enabled')
    .single()

  if (settingError) {
    console.error('[Retention] Failed to read system_settings:', settingError)
    return NextResponse.json({ error: 'Fehler beim Laden der Einstellungen' }, { status: 500 })
  }

  if (setting.value !== 'true') {
    console.log('[Retention] Retention is disabled — skipping.')
    return NextResponse.json({ skipped: true, reason: 'retention_disabled' })
  }

  // Fetch all active sources that have a retention_days value set
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, name, retention_days')
    .not('retention_days', 'is', null)
    .gte('retention_days', 7)

  if (sourcesError) {
    console.error('[Retention] Failed to load sources:', sourcesError)
    return NextResponse.json({ error: 'Fehler beim Laden der Quellen' }, { status: 500 })
  }

  if (!sources || sources.length === 0) {
    console.log('[Retention] No sources with retention policy configured.')
    return NextResponse.json({ processed: 0, total_deleted: 0, log: [] })
  }

  const log: Array<{ source_id: string; source_name: string; deleted_count: number }> = []
  let total_deleted = 0

  for (const source of sources) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - source.retention_days)

    // Delete all articles from this source older than the cutoff
    const { count, error: deleteError } = await supabase
      .from('articles')
      .delete({ count: 'exact' })
      .eq('source_id', source.id)
      .lt('published_at', cutoff.toISOString())

    if (deleteError) {
      console.error(`[Retention] Error deleting articles for source ${source.id}:`, deleteError)
      log.push({ source_id: source.id, source_name: source.name, deleted_count: 0 })
      continue
    }

    const deleted = count ?? 0
    total_deleted += deleted
    log.push({ source_id: source.id, source_name: source.name, deleted_count: deleted })

    // Record in retention_log (only if something was deleted or for audit purposes)
    if (deleted > 0) {
      await supabase.from('retention_log').insert({
        source_id: source.id,
        source_name: source.name,
        deleted_count: deleted,
      })
    }
  }

  console.log(`[Retention] Done. Processed ${sources.length} sources, deleted ${total_deleted} articles.`)

  return NextResponse.json({
    processed: sources.length,
    total_deleted,
    log,
  })
}
