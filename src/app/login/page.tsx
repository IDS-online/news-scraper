'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(1, 'Passwort erforderlich'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginForm) {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const body = await res.json()
        setError(body.error ?? 'Anmeldung fehlgeschlagen')
        return
      }

      window.location.href = '/dashboard'
    } catch {
      setError('Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ids-offwhite flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-ids-dark">
            News<span className="text-ids-orange">grap3r</span>
          </h1>
          <p className="text-ids-slate mt-1 text-sm">News-Aggregator für interne Teams</p>
        </div>

        <Card className="border-0 shadow-md rounded-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-ids-dark">Anmelden</CardTitle>
            <CardDescription className="text-ids-slate">
              Melden Sie sich mit Ihrer E-Mail-Adresse an
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
              {error && (
                <Alert variant="destructive" className="border-ids-pink/30 bg-ids-pink/5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-ids-dark font-semibold text-sm">
                  E-Mail-Adresse
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@unternehmen.de"
                  className="border-ids-light focus-visible:ring-ids-orange"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-ids-pink text-xs">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-ids-dark font-semibold text-sm">
                  Passwort
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="border-ids-light focus-visible:ring-ids-orange"
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-ids-pink text-xs">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-ids-orange hover:bg-ids-orange-real text-ids-dark font-semibold rounded-lg h-11"
              >
                {loading ? 'Anmelden…' : 'Anmelden'}
              </Button>
            </form>

            <p className="text-center text-sm text-ids-slate mt-5">
              Noch kein Konto?{' '}
              <Link href="/register" className="text-ids-dark font-semibold hover:text-ids-orange transition-colors">
                Registrieren
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
