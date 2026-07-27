import { describe, it, expect, afterEach } from 'vitest'
import { validateEnv } from '@/lib/env'

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

function setAllRequired() {
  for (const name of REQUIRED) process.env[name] = 'dummy-value'
}

function clearAllRequired() {
  for (const name of REQUIRED) delete process.env[name]
}

describe('validateEnv', () => {
  afterEach(() => {
    clearAllRequired()
  })

  it('passes when every required variable is set', () => {
    setAllRequired()
    expect(() => validateEnv()).not.toThrow()
  })

  it('throws listing the missing variable', () => {
    setAllRequired()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => validateEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('treats a whitespace-only value as missing', () => {
    setAllRequired()
    process.env.NEXT_PUBLIC_SUPABASE_URL = '   '
    expect(() => validateEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('lists every missing variable in a single error', () => {
    clearAllRequired()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'dummy-value'
    expect(() => validateEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    expect(() => validateEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
