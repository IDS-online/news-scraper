/**
 * Central environment-variable validation.
 *
 * Two tiers:
 *  - REQUIRED: the app cannot function without these. Missing → throw at startup.
 *  - OPTIONAL: needed only by specific features. Missing → warn, don't crash.
 *
 * Run once at server boot from instrumentation.ts, so a misconfigured deployment
 * fails fast with a clear message instead of an opaque 500 deep in a request
 * handler (the failure mode that hid the missing SUPABASE_SERVICE_ROLE_KEY).
 */

type EnvSpec = { name: string; hint: string }

const REQUIRED: EnvSpec[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', hint: 'Supabase project URL' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', hint: 'Supabase public anon key' },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    hint: 'Supabase service role key — server-side scraping, cron, retention',
  },
]

const OPTIONAL: EnvSpec[] = [
  { name: 'ANTHROPIC_API_KEY', hint: 'Claude API key — NEWS-11 auto-categorization' },
  {
    name: 'CRON_SECRET',
    hint: 'Secures /api/cron/* — required for scheduled scrape & retention',
  },
]

function isMissing(name: string): boolean {
  const value = process.env[name]
  return value === undefined || value.trim() === ''
}

/**
 * Validate environment variables.
 * Warns for missing optional vars; throws (listing all of them at once) if any
 * required var is missing.
 */
export function validateEnv(): void {
  for (const spec of OPTIONAL) {
    if (isMissing(spec.name)) {
      console.warn(`[env] Optional variable ${spec.name} is not set — ${spec.hint}`)
    }
  }

  const missing = REQUIRED.filter((spec) => isMissing(spec.name))
  if (missing.length > 0) {
    const lines = missing.map((spec) => `  - ${spec.name}: ${spec.hint}`).join('\n')
    throw new Error(
      `Missing required environment variable(s):\n${lines}\n` +
        `Set them in Vercel (or .env.local for local dev). See .env.local.example.`
    )
  }

  console.log('[env] Environment validation passed.')
}
