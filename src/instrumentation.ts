/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Startup guard: validate required environment variables up front so a
 * misconfigured deployment fails fast with a clear message rather than an
 * opaque 500 deep inside a request handler.
 */
export async function register() {
  // Only run in the Node.js server runtime — env vars aren't fully present in
  // the Edge runtime, and this check is server-side only.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('@/lib/env')
    validateEnv()
  }
}
