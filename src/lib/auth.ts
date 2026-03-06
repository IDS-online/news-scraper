import { createClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'

export type AuthResult = {
  supabase: SupabaseClient
  userId: string
  role: string
}

/**
 * Verify that the request is from an authenticated user.
 * Returns the Supabase client, userId, and role.
 * Throws an object with `status` and `error` if not authenticated.
 */
export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    throw { status: 401, error: 'Nicht authentifiziert' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    throw { status: 401, error: 'Profil nicht gefunden' }
  }

  return { supabase, userId: user.id, role: profile.role }
}

/**
 * Verify that the request is from an admin user.
 * Throws an object with `status` and `error` if not admin.
 */
export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireAuth()

  if (result.role !== 'admin') {
    throw { status: 403, error: 'Nicht berechtigt. Admin-Rolle erforderlich.' }
  }

  return result
}
