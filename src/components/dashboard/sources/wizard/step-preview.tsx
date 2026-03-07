'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Newspaper,
  Save,
} from 'lucide-react'

interface PreviewArticle {
  title: string
  url: string
  description: string | null
  image_url: string | null
  published_at: string | null
  source_category_raw: string | null
  language: string
}

interface StepPreviewProps {
  sourceUrl: string
  selectors: Record<string, string | null>
  onBack: () => void
  onSave: () => void
  saving: boolean
}

function formatPreviewDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function PreviewCard({ article }: { article: PreviewArticle }) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="flex gap-3 rounded-lg border border-ids-light bg-white p-3 hover:shadow-sm transition-shadow">
      <div className="shrink-0 w-16 h-16 rounded-md bg-ids-ice flex items-center justify-center overflow-hidden">
        {article.image_url && !imgError ? (
          <img
            src={article.image_url}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <Newspaper className="h-5 w-5 text-ids-grey" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h5 className="text-sm font-bold text-ids-dark leading-snug line-clamp-1" title={article.title}>
          {article.title}
        </h5>
        {article.description && (
          <p className="text-xs text-ids-slate leading-relaxed line-clamp-2 mt-0.5">
            {article.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {article.published_at && (
            <span className="text-[11px] text-ids-grey flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatPreviewDate(article.published_at)}
            </span>
          )}
          {article.source_category_raw && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {article.source_category_raw}
            </Badge>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ids-slate hover:text-ids-navy font-medium flex items-center gap-1 transition-colors"
            aria-label={`Originalseite oeffnen: ${article.title}`}
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate max-w-[200px]">
              {(() => {
                try {
                  return new URL(article.url).hostname
                } catch {
                  return article.url
                }
              })()}
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-ids-light bg-white p-3">
          <Skeleton className="w-16 h-16 rounded-md shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function StepPreview({
  sourceUrl,
  selectors,
  onBack,
  onSave,
  saving,
}: StepPreviewProps) {
  const [loading, setLoading] = useState(true)
  const [articles, setArticles] = useState<PreviewArticle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)

  const runPreview = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuggestion(null)
    setArticles([])

    try {
      const res = await fetch('/api/sources/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sourceUrl,
          selector_container: selectors.selector_container,
          selector_title: selectors.selector_title,
          selector_link: selectors.selector_link,
          selector_description: selectors.selector_description || undefined,
          selector_date: selectors.selector_date || undefined,
          selector_category: selectors.selector_category || undefined,
          selector_image: selectors.selector_image || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Fehler bei der Vorschau.')
        return
      }

      if (data.success && data.articles?.length > 0) {
        setArticles(data.articles)
      } else {
        setError(data.error || 'Keine Artikel gefunden.')
        setSuggestion(data.suggestion || null)
      }
    } catch {
      setError('Netzwerkfehler. Bitte die Verbindung ueberpruefen.')
    } finally {
      setLoading(false)
    }
  }, [sourceUrl, selectors])

  useEffect(() => {
    runPreview()
  }, [runPreview])

  const hasArticles = articles.length > 0

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-ids-dark">Scraping-Vorschau</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ergebnis des Test-Scrapes mit den ausgewaehlten Selektoren.
        </p>
      </div>

      {/* Selector summary */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(selectors)
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="font-semibold text-ids-dark">
                    {key.replace('selector_', '')}:
                  </span>{' '}
                  <code className="text-ids-slate bg-ids-ice px-1 py-0.5 rounded">{value}</code>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-ids-orange" />
            <p className="text-sm text-ids-slate">Artikel werden gescrapt...</p>
          </div>
          <PreviewSkeleton />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p>{error}</p>
            {suggestion && <p className="mt-1 text-xs opacity-80">{suggestion}</p>}
            <div className="flex items-center gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Zurueck zu Schritt 2
              </Button>
              <Button variant="outline" size="sm" onClick={runPreview}>
                Erneut versuchen
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Success state */}
      {!loading && hasArticles && (
        <>
          <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-4 py-2">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-medium">
              {articles.length} Artikel erfolgreich gescrapt
            </p>
          </div>

          <div className="space-y-2">
            {articles.map((article, idx) => (
              <PreviewCard key={`${article.url}-${idx}`} article={article} />
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Selektoren anpassen
            </Button>
            <Button onClick={onSave} disabled={saving} className="flex-1">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Wird gespeichert...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" />
                  Quelle speichern
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {/* Back button always visible when not loading */}
      {!loading && !hasArticles && !error && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">Keine Artikel gefunden.</p>
          <Button variant="outline" className="mt-3" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Zurueck zu Schritt 2
          </Button>
        </div>
      )}
    </div>
  )
}
