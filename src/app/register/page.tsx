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
import { AlertCircle, CheckCircle2 } from 'lucide-react'

const registerSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
  passwordConfirmation: z.string(),
}).refine((data) => data.password === data.passwordConfirmation, {
  message: 'Passwörter stimmen nicht überein',
  path: ['passwordConfirmation'],
})

type RegisterForm = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  })

  async function onSubmit(data: RegisterForm) {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const body = await res.json()

      if (!res.ok) {
        setError(body.error ?? 'Registrierung fehlgeschlagen')
        return
      }

      setSuccess(true)
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
            <CardTitle className="text-xl text-ids-dark">Konto erstellen</CardTitle>
            <CardDescription className="text-ids-slate">
              Registrieren Sie sich mit Ihrer E-Mail-Adresse
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="text-center py-4 space-y-3">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-12 w-12 text-ids-orange" />
                </div>
                <p className="font-semibold text-ids-dark">Registrierung erfolgreich!</p>
                <p className="text-sm text-ids-slate">
                  Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link, den wir Ihnen gesendet haben.
                </p>
                <Link href="/login">
                  <Button className="mt-2 bg-ids-orange hover:bg-ids-orange-real text-ids-dark font-semibold rounded-lg">
                    Zur Anmeldung
                  </Button>
                </Link>
              </div>
            ) : (
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
                    autoComplete="new-password"
                    placeholder="Mindestens 8 Zeichen"
                    className="border-ids-light focus-visible:ring-ids-orange"
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-ids-pink text-xs">{errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="passwordConfirmation" className="text-ids-dark font-semibold text-sm">
                    Passwort bestätigen
                  </Label>
                  <Input
                    id="passwordConfirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="border-ids-light focus-visible:ring-ids-orange"
                    {...register('passwordConfirmation')}
                  />
                  {errors.passwordConfirmation && (
                    <p className="text-ids-pink text-xs">{errors.passwordConfirmation.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-ids-orange hover:bg-ids-orange-real text-ids-dark font-semibold rounded-lg h-11"
                >
                  {loading ? 'Registrieren…' : 'Konto erstellen'}
                </Button>
              </form>
            )}

            {!success && (
              <p className="text-center text-sm text-ids-slate mt-5">
                Bereits registriert?{' '}
                <Link href="/login" className="text-ids-dark font-semibold hover:text-ids-orange transition-colors">
                  Anmelden
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
