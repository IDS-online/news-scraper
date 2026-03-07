'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle, Globe, Info, Loader2 } from 'lucide-react'
import Link from 'next/link'

interface StepUrlProps {
  sourceName: string
  sourceUrl: string
  onSourceNameChange: (name: string) => void
  onSourceUrlChange: (url: string) => void
  onLoadWebsite: (html: string) => void
  onSpaWarning?: (warned: boolean) => void
}

export default function StepUrl({
  sourceName,
  sourceUrl,
  onSourceNameChange,
  onSourceUrlChange,
  onLoadWebsite,
  onSpaWarning,
}: StepUrlProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spaWarning, setSpaWarning] = useState(false)

  async function handleLoadWebsite() {
    if (!sourceUrl.trim()) return

    // Basic URL validation
    let normalizedUrl = sourceUrl.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl
      onSourceUrlChange(normalizedUrl)
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/sources/proxy-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Fehler beim Laden der Webseite.')
        return
      }

      if (data.error) {
        setError(data.error)
        return
      }

      if (!data.html) {
        setError('Kein HTML-Inhalt erhalten.')
        return
      }

      setSpaWarning(!!data.spaWarning)
      onSpaWarning?.(!!data.spaWarning)
      onLoadWebsite(data.html)
    } catch {
      setError('Netzwerkfehler. Bitte die Verbindung ueberpruefen.')
    } finally {
      setLoading(false)
    }
  }

  const canLoad = sourceUrl.trim().length > 0 && !loading

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-lg">
        <CardContent className="pt-6 space-y-5">
          <div className="text-center mb-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ids-ice mb-3">
              <Globe className="h-6 w-6 text-ids-slate" />
            </div>
            <h2 className="text-lg font-bold text-ids-dark">Webseite laden</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Gib die URL der Webseite ein, von der du Artikel scrapen moechtest.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-name">Quellen-Name</Label>
            <Input
              id="source-name"
              placeholder="z.B. Heise Online"
              value={sourceName}
              onChange={(e) => onSourceNameChange(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-url">URL der Webseite</Label>
            <Input
              id="source-url"
              type="url"
              placeholder="https://www.example.com/news"
              value={sourceUrl}
              onChange={(e) => onSourceUrlChange(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canLoad) handleLoadWebsite()
              }}
            />
          </div>

          {spaWarning && !error && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Die Seite benoetigt moeglicherweise JavaScript zum Laden des Inhalts (SPA). Die
                Vorschau koennte leer erscheinen. Alternativ{' '}
                <Link
                  href={`/dashboard/sources?action=new${sourceUrl ? `&url=${encodeURIComponent(sourceUrl)}` : ''}${sourceName ? `&name=${encodeURIComponent(sourceName)}` : ''}`}
                  className="underline font-medium"
                >
                  manuell einrichten
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p>{error}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadWebsite}
                    disabled={loading}
                  >
                    Erneut versuchen
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/dashboard/sources?action=new${sourceUrl ? `&url=${encodeURIComponent(sourceUrl)}` : ''}${sourceName ? `&name=${encodeURIComponent(sourceName)}` : ''}`}
                    >
                      Manuell einrichten
                    </Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full"
            onClick={handleLoadWebsite}
            disabled={!canLoad}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Webseite wird geladen...
              </>
            ) : (
              'Webseite laden'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
