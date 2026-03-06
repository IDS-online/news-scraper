import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const loginSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(1, 'Passwort erforderlich'),
})

export async function POST(request: NextRequest) {
  const body = await request.json()
  const parsed = loginSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { email, password } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Generic message — don't reveal which field is wrong
    return NextResponse.json(
      { error: 'E-Mail oder Passwort ist falsch' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    message: 'Login erfolgreich',
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  })
}
