'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Calendar, ExternalLink, Eye, Loader2, Newspaper, Plus, Rss, Search, Trash2 } from 'lucide-react'
import type { Source, Category } from '@/types/source'
import SelectorAssistant from '@/components/dashboard/sources/selector-assistant'

interface DetectedFeed {
  url: string
  title: string
  type: 'rss' | 'atom'
  item_count: number
  requires_auth: boolean
}

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-Detect' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Francais' },
  { value: 'es', label: 'Espanol' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Portugues' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'ru', label: 'Russkij' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
]

interface SourceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: Source | null
  categories: Category[]
  onSuccess: () => void
  initialName?: string
  initialUrl?: string
}

interface FormData {
  name: string
  url: string
  type: 'rss' | 'html'
  language: string
  interval_minutes: number
  is_active: boolean
  slug: string
  default_category_id: string
  retention_days: string
  selector_container: string
  selector_title: string
  selector_link: string
  selector_description: string
  selector_date: string
  selector_category: string
  selector_image: string
}

interface PreviewArticle {
  title: string
  url: string
  description: string | null
  image_url: string | null
  published_at: string | null
  source_category_raw: string | null
  language: string
}

interface MappingRow {
  key: string // client-side key for React rendering
  source_category_raw: string
  category_id: string
}

const EMPTY_FORM: FormData = {
  name: '',
  url: '',
  type: 'rss',
  language: 'auto',
  interval_minutes: 15,
  is_active: true,
  slug: '',
  default_category_id: '',
  retention_days: '',
  selector_container: '',
  selector_title: '',
  selector_link: '',
  selector_description: '',
  selector_date: '',
  selector_category: '',
  selector_image: '',
}

/**
 * Generate a URL-safe slug from a source name.
 * Converts German Umlauts (ae, oe, ue, ss), lowercases,
 * replaces spaces with hyphens, and strips non-allowed characters.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

let mappingKeyCounter = 0
function nextMappingKey(): string {
  mappingKeyCounter += 1
  return `mapping-${mappingKeyCounter}`
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
    <div className="flex gap-3 rounded-lg border border-ids-light bg-white p-2.5 hover:shadow-sm transition-shadow">
      {/* Thumbnail */}
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

      {/* Content */}
      <div className="min-w-0 flex-1">
        <h5 className="text-sm font-bold text-ids-dark leading-snug line-clamp-1" title={article.title}>
          {article.title}
        </h5>
        {article.description && (
          <p className="text-xs text-ids-slate leading-relaxed line-clamp-2 mt-0.5">
            {article.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1">
          {article.published_at && (
            <span className="text-[11px] text-ids-grey flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatPreviewDate(article.published_at)}
            </span>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ids-slate hover:text-ids-navy font-medium flex items-center gap-1 transition-colors"
            aria-label={`Originalseite oeffnen: ${article.title}`}
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate max-w-[200px]">{new URL(article.url).hostname}</span>
          </a>
        </div>
      </div>
    </div>
  )
}

export default function SourceFormDialog({
  open,
  onOpenChange,
  source,
  categories,
  onSuccess,
  initialName,
  initialUrl,
}: SourceFormDialogProps) {
  const isEditing = source !== null
  const [form, setForm] = useState<FormData>(() =>
    initialName || initialUrl
      ? { ...EMPTY_FORM, name: initialName ?? '', url: initialUrl ?? '', type: 'html' }
      : EMPTY_FORM
  )
  const [mappings, setMappings] = useState<MappingRow[]>([])
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  // Feed detection state
  const [detectedFeeds, setDetectedFeeds] = useState<DetectedFeed[]>([])
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detectAttempted, setDetectAttempted] = useState(false)

  // HTML scraping preview state
  const [previewPassed, setPreviewPassed] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewArticles, setPreviewArticles] = useState<PreviewArticle[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewSuggestion, setPreviewSuggestion] = useState<string | null>(null)

  // Fetch existing mappings when editing a source
  const fetchMappings = useCallback(async (sourceId: string) => {
    setLoadingMappings(true)
    try {
      const res = await fetch(`/api/sources/${sourceId}/mappings`)
      if (res.ok) {
        const data = await res.json()
        const loaded: MappingRow[] = (data.mappings ?? []).map(
          (m: { source_category_raw: string; category_id: string }) => ({
            key: nextMappingKey(),
            source_category_raw: m.source_category_raw,
            category_id: m.category_id,
          })
        )
        setMappings(loaded)
      }
    } catch {
      // Mappings are non-critical; form still works without them
    } finally {
      setLoadingMappings(false)
    }
  }, [])

  // Populate form when source changes
  useEffect(() => {
    if (source) {
      setForm({
        name: source.name,
        url: source.url,
        type: source.type,
        language: source.language,
        interval_minutes: source.interval_minutes,
        is_active: source.is_active,
        slug: source.slug ?? '',
        default_category_id: source.default_category_id ?? '',
        retention_days: source.retention_days?.toString() ?? '',
        selector_container: source.selector_container ?? '',
        selector_title: source.selector_title ?? '',
        selector_link: source.selector_link ?? '',
        selector_description: source.selector_description ?? '',
        selector_date: source.selector_date ?? '',
        selector_category: source.selector_category ?? '',
        selector_image: source.selector_image ?? '',
      })
      setSlugManuallyEdited(true) // Don't auto-generate when editing
      fetchMappings(source.id)
    } else {
      setForm(EMPTY_FORM)
      setMappings([])
      setSlugManuallyEdited(false)
    }
    setError(null)
    setFieldErrors({})
    setDetectedFeeds([])
    setDetecting(false)
    setDetectError(null)
    setDetectAttempted(false)
    setPreviewPassed(false)
    setPreviewLoading(false)
    setPreviewArticles([])
    setPreviewError(null)
    setPreviewSuggestion(null)
  }, [source, open, fetchMappings])

  // Fields that invalidate a previous preview result when changed
  const PREVIEW_SENSITIVE_FIELDS: (keyof FormData)[] = [
    'url',
    'selector_container',
    'selector_title',
    'selector_link',
    'selector_description',
    'selector_date',
    'selector_image',
    'selector_category',
  ]

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }

      // Auto-generate slug from name unless manually edited
      if (key === 'name' && !slugManuallyEdited) {
        next.slug = generateSlug(value as string)
      }

      return next
    })

    // Reset preview when selector/URL fields change
    if (PREVIEW_SENSITIVE_FIELDS.includes(key) && previewPassed) {
      setPreviewPassed(false)
      setPreviewArticles([])
      setPreviewError(null)
      setPreviewSuggestion(null)
    }
  }

  function handleSlugChange(value: string) {
    setSlugManuallyEdited(true)
    setForm((prev) => ({ ...prev, slug: value }))
  }

  // Feed detection
  async function handleDetectFeeds() {
    const urlValue = form.url.trim()
    if (!urlValue) {
      setDetectError('Bitte zuerst eine URL eingeben.')
      return
    }

    setDetecting(true)
    setDetectError(null)
    setDetectedFeeds([])
    setDetectAttempted(true)

    try {
      const res = await fetch('/api/sources/detect-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlValue }),
      })

      const data = await res.json()

      if (!res.ok) {
        setDetectError(data.error || 'Fehler bei der Feed-Erkennung.')
        return
      }

      const feeds: DetectedFeed[] = data.feeds ?? []
      setDetectedFeeds(feeds)

      if (feeds.length === 0) {
        setDetectError('Keine Feeds gefunden — bitte URL manuell eingeben')
      }
    } catch {
      setDetectError('Netzwerkfehler bei der Feed-Erkennung.')
    } finally {
      setDetecting(false)
    }
  }

  function selectDetectedFeed(feed: DetectedFeed) {
    updateField('url', feed.url)
    updateField('type', 'rss')
    setDetectedFeeds([])
    setDetectError(null)
    setDetectAttempted(false)
  }

  // HTML scraping preview
  async function handlePreview() {
    const url = form.url.trim()
    if (!url) return
    if (!form.selector_container || !form.selector_title || !form.selector_link) return

    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewSuggestion(null)
    setPreviewArticles([])
    setPreviewPassed(false)

    try {
      const res = await fetch('/api/sources/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          selector_container: form.selector_container,
          selector_title: form.selector_title,
          selector_link: form.selector_link,
          selector_description: form.selector_description || null,
          selector_date: form.selector_date || null,
          selector_category: form.selector_category || null,
          selector_image: form.selector_image || null,
          language: form.language !== 'auto' ? form.language : null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setPreviewError(data.error || 'Fehler bei der Vorschau.')
        return
      }

      if (data.success && data.articles?.length > 0) {
        setPreviewArticles(data.articles)
        setPreviewPassed(true)
      } else {
        setPreviewError(data.error || 'Keine Artikel gefunden.')
        setPreviewSuggestion(data.suggestion || null)
      }
    } catch {
      setPreviewError('Netzwerkfehler. Bitte versuche es erneut.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const isPreviewButtonDisabled =
    previewLoading ||
    !form.url.trim() ||
    !form.selector_container.trim() ||
    !form.selector_title.trim() ||
    !form.selector_link.trim()

  function getPreviewButtonTooltip(): string | undefined {
    if (!form.url.trim()) return 'Bitte zuerst eine URL eingeben'
    if (!form.selector_container.trim() || !form.selector_title.trim() || !form.selector_link.trim()) {
      return 'Container-, Titel- und Link-Selektor sind Pflichtfelder fuer die Vorschau'
    }
    return undefined
  }

  // Category mapping management
  function addMappingRow() {
    setMappings((prev) => [
      ...prev,
      { key: nextMappingKey(), source_category_raw: '', category_id: '' },
    ])
  }

  function updateMappingRow(key: string, field: 'source_category_raw' | 'category_id', value: string) {
    setMappings((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    )
  }

  function removeMappingRow(key: string) {
    setMappings((prev) => prev.filter((row) => row.key !== key))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors({})

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        url: form.url,
        type: form.type,
        language: form.language,
        interval_minutes: form.interval_minutes,
        is_active: form.is_active,
        slug: form.slug || null,
        default_category_id: form.default_category_id || null,
        retention_days: form.retention_days ? parseInt(form.retention_days, 10) : null,
        selector_container: form.selector_container || null,
        selector_title: form.selector_title || null,
        selector_link: form.selector_link || null,
        selector_description: form.selector_description || null,
        selector_date: form.selector_date || null,
        selector_category: form.selector_category || null,
        selector_image: form.selector_image || null,
      }

      const url = isEditing ? `/api/sources/${source.id}` : '/api/sources'
      const method = isEditing ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.details) {
          setFieldErrors(data.details)
        }
        setError(data.error || 'Ein Fehler ist aufgetreten')
        return
      }

      // Save category mappings (only non-empty rows)
      const sourceId = isEditing ? source.id : data.source?.id
      if (sourceId) {
        const validMappings = mappings
          .filter((m) => m.source_category_raw.trim() && m.category_id)
          .map((m) => ({
            source_category_raw: m.source_category_raw.trim(),
            category_id: m.category_id,
          }))

        const mappingsRes = await fetch(`/api/sources/${sourceId}/mappings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validMappings),
        })

        if (!mappingsRes.ok) {
          const mappingsData = await mappingsRes.json()
          setError(mappingsData.error || 'Quelle gespeichert, aber Fehler beim Speichern der Kategorie-Mappings')
          // Source was saved, so still trigger success for the list refresh
          onSuccess()
          return
        }
      }

      onSuccess()
      onOpenChange(false)
    } catch {
      setError('Netzwerkfehler. Bitte versuche es erneut.')
    } finally {
      setSaving(false)
    }
  }

  function getFieldError(field: string): string | undefined {
    return fieldErrors[field]?.[0]
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Quelle bearbeiten' : 'Neue Quelle anlegen'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Passe die Einstellungen dieser News-Quelle an.'
              : 'Konfiguriere eine neue News-Quelle fuer den Scraper.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Basic fields */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
              Grundeinstellungen
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="source-name"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="z.B. Spiegel Online"
                  aria-invalid={!!getFieldError('name')}
                />
                {getFieldError('name') && (
                  <p className="text-xs text-destructive">{getFieldError('name')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="source-type">
                  Typ <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => updateField('type', v as 'rss' | 'html')}
                >
                  <SelectTrigger id="source-type" aria-label="Quellentyp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rss">RSS / Atom Feed</SelectItem>
                    <SelectItem value="html">HTML Scraping</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="source-url">
                URL <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="source-url"
                  type="url"
                  value={form.url}
                  onChange={(e) => updateField('url', e.target.value)}
                  placeholder={!isEditing ? 'https://example.com (oder Feed-URL direkt)' : 'https://example.com/feed.xml'}
                  aria-invalid={!!getFieldError('url')}
                  className="flex-1"
                />
                {!isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={handleDetectFeeds}
                    disabled={detecting || !form.url.trim()}
                    aria-label="Feeds erkennen"
                    className="shrink-0"
                  >
                    {detecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4 mr-2" />
                    )}
                    Feeds erkennen
                  </Button>
                )}
              </div>
              {getFieldError('url') && (
                <p className="text-xs text-destructive">{getFieldError('url')}</p>
              )}
              {!isEditing && !detectAttempted && !detecting && (
                <p className="text-xs text-muted-foreground">
                  Gib eine Website-URL ein und klicke &quot;Feeds erkennen&quot; um RSS/Atom Feeds automatisch zu finden.
                </p>
              )}

              {/* Feed detection error */}
              {detectError && (
                <Alert variant={detectedFeeds.length === 0 && detectAttempted ? 'destructive' : 'default'} className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{detectError}</AlertDescription>
                </Alert>
              )}

              {/* Detected feeds list */}
              {detectedFeeds.length > 0 && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {detectedFeeds.length} Feed{detectedFeeds.length !== 1 ? 's' : ''} gefunden — waehle einen aus:
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
                    {detectedFeeds.map((feed) => (
                      <button
                        key={feed.url}
                        type="button"
                        onClick={() => selectDetectedFeed(feed)}
                        className="w-full text-left rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-accent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Feed auswaehlen: ${feed.title || feed.url}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Rss className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="font-medium truncate">
                                {feed.title || 'Unbekannter Feed'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5 pl-5.5">
                              {feed.url}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="secondary" className="text-[10px] uppercase">
                              {feed.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {feed.item_count} Artikel
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-language">Sprache</Label>
                <Select
                  value={form.language}
                  onValueChange={(v) => updateField('language', v)}
                >
                  <SelectTrigger id="source-language" aria-label="Sprache">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="source-interval">
                  Intervall (Min.) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="source-interval"
                  type="number"
                  min={5}
                  value={form.interval_minutes}
                  onChange={(e) =>
                    updateField('interval_minutes', parseInt(e.target.value, 10) || 5)
                  }
                  aria-invalid={!!getFieldError('interval_minutes')}
                />
                {getFieldError('interval_minutes') && (
                  <p className="text-xs text-destructive">
                    {getFieldError('interval_minutes')}
                  </p>
                )}
              </div>

              <div className="flex items-end gap-3 pb-1">
                <div className="space-y-2">
                  <Label htmlFor="source-active">Aktiv</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="source-active"
                      checked={form.is_active}
                      onCheckedChange={(v) => updateField('is_active', v)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {form.is_active ? 'Ja' : 'Nein'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Extended fields (slug, category, retention) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
              Erweiterte Einstellungen
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-slug">
                  Slug <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="source-slug"
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="z.B. spiegel-online"
                  maxLength={80}
                  aria-invalid={!!getFieldError('slug')}
                  aria-describedby="slug-hint"
                />
                <p id="slug-hint" className="text-xs text-muted-foreground">
                  Nur Kleinbuchstaben, Zahlen und Bindestriche. Wird automatisch aus dem Namen generiert.
                </p>
                {getFieldError('slug') && (
                  <p className="text-xs text-destructive">{getFieldError('slug')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="source-category">Basis-Kategorie</Label>
                <Select
                  value={form.default_category_id}
                  onValueChange={(v) => updateField('default_category_id', v === 'none' ? '' : v)}
                >
                  <SelectTrigger id="source-category" aria-label="Basis-Kategorie">
                    <SelectValue placeholder="Keine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="source-retention">Retention (Tage)</Label>
                <div className="flex items-center gap-2 mb-1.5">
                  <Checkbox
                    id="source-retention-never"
                    checked={form.retention_days === ''}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        updateField('retention_days', '')
                      } else {
                        updateField('retention_days', '30')
                      }
                    }}
                    aria-label="Nie automatisch loeschen"
                  />
                  <Label
                    htmlFor="source-retention-never"
                    className="text-sm font-normal text-muted-foreground cursor-pointer"
                  >
                    Nie loeschen
                  </Label>
                </div>
                <Input
                  id="source-retention"
                  type="number"
                  min={7}
                  value={form.retention_days}
                  onChange={(e) => updateField('retention_days', e.target.value)}
                  placeholder="z.B. 30, 90 oder 365"
                  disabled={form.retention_days === ''}
                  aria-invalid={!!getFieldError('retention_days')}
                  aria-describedby="retention-hint"
                />
                <p id="retention-hint" className="text-xs text-muted-foreground">
                  Mindestens 7 Tage. Leer = Artikel werden nie automatisch geloescht.
                </p>
                {getFieldError('retention_days') && (
                  <p className="text-xs text-destructive">
                    {getFieldError('retention_days')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* CSS selectors (only for HTML type) */}
          {form.type === 'html' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
                CSS-Selektoren (HTML Scraping)
              </h3>
              <p className="text-xs text-muted-foreground">
                Definiere die CSS-Selektoren, mit denen Artikel aus der HTML-Seite extrahiert werden.
              </p>

              <SelectorAssistant
                key={`assistant-${open}-${form.type}`}
                onApply={(field, selector) => updateField(field, selector)}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sel-container">Artikel-Container</Label>
                  <Input
                    id="sel-container"
                    value={form.selector_container}
                    onChange={(e) => updateField('selector_container', e.target.value)}
                    placeholder="z.B. article.news-item"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-title">Titel</Label>
                  <Input
                    id="sel-title"
                    value={form.selector_title}
                    onChange={(e) => updateField('selector_title', e.target.value)}
                    placeholder="z.B. h2.title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-link">Link</Label>
                  <Input
                    id="sel-link"
                    value={form.selector_link}
                    onChange={(e) => updateField('selector_link', e.target.value)}
                    placeholder="z.B. a.article-link"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-description">Beschreibung / Teaser</Label>
                  <Input
                    id="sel-description"
                    value={form.selector_description}
                    onChange={(e) => updateField('selector_description', e.target.value)}
                    placeholder="z.B. p.teaser"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-date">Datum (optional)</Label>
                  <Input
                    id="sel-date"
                    value={form.selector_date}
                    onChange={(e) => updateField('selector_date', e.target.value)}
                    placeholder="z.B. time.published"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-category">Kategorie (optional)</Label>
                  <Input
                    id="sel-category"
                    value={form.selector_category}
                    onChange={(e) => updateField('selector_category', e.target.value)}
                    placeholder="z.B. span.category"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sel-image">Bild (optional)</Label>
                  <Input
                    id="sel-image"
                    value={form.selector_image}
                    onChange={(e) => updateField('selector_image', e.target.value)}
                    placeholder="z.B. img.teaserbild"
                  />
                </div>
              </div>

              {/* Preview button and results */}
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-ids-dark">Scraping-Vorschau</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Teste die Konfiguration, bevor du die Quelle speicherst.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={handlePreview}
                    disabled={isPreviewButtonDisabled}
                    title={getPreviewButtonTooltip()}
                    aria-label="Scraping testen"
                    className="shrink-0"
                  >
                    {previewLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4 mr-2" />
                    )}
                    Scraping testen
                  </Button>
                </div>

                {/* Preview loading indicator */}
                {previewLoading && (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    <span className="text-sm">Seite wird abgerufen und geparst...</span>
                  </div>
                )}

                {/* Preview error */}
                {previewError && !previewLoading && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p>{previewError}</p>
                      {previewSuggestion && (
                        <p className="mt-1 text-xs opacity-80">{previewSuggestion}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Config changed notice */}
                {!previewPassed && !previewLoading && !previewError && previewArticles.length === 0 && !isEditing && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {form.url.trim() && form.selector_container.trim() && form.selector_title.trim() && form.selector_link.trim()
                      ? 'Klicke "Scraping testen" um die Konfiguration zu ueberpruefen.'
                      : 'Fuege URL und Selektoren hinzu, um die Vorschau zu starten.'}
                  </p>
                )}

                {/* Preview success: article cards */}
                {previewPassed && previewArticles.length > 0 && !previewLoading && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-green-700">
                      {previewArticles.length} Artikel erfolgreich gescrapt:
                    </p>
                    <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto rounded-md border border-ids-light p-2">
                      {previewArticles.map((article, idx) => (
                        <PreviewCard key={`${article.url}-${idx}`} article={article} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Category selector for RSS */}
          {form.type === 'rss' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
                RSS Kategorie-Einstellungen
              </h3>
              <div className="space-y-2">
                <Label htmlFor="sel-category-rss">Kategorie-Selektor (optional)</Label>
                <Input
                  id="sel-category-rss"
                  value={form.selector_category}
                  onChange={(e) => updateField('selector_category', e.target.value)}
                  placeholder="z.B. category"
                />
                <p className="text-xs text-muted-foreground">
                  RSS-Feld oder XPath, aus dem die Kategorie gelesen wird.
                </p>
              </div>
            </div>
          )}

          {/* Category Mapping Table */}
          <div className="space-y-4">
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
                  Kategorie-Mapping
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Ordne Quellen-Kategorien (z.B. aus RSS &lt;category&gt;) deinen Kategorien zu.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addMappingRow}
                aria-label="Mapping-Zeile hinzufuegen"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Zeile
              </Button>
            </div>

            {loadingMappings && (
              <p className="text-xs text-muted-foreground">Mappings werden geladen...</p>
            )}

            {mappings.length === 0 && !loadingMappings && (
              <p className="text-xs text-muted-foreground py-3 text-center">
                Keine Kategorie-Mappings definiert. Klicke &quot;Zeile&quot; um ein Mapping hinzuzufuegen.
              </p>
            )}

            {mappings.length > 0 && (
              <div className="space-y-2">
                {/* Header row (hidden on mobile, shown sm+) */}
                <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_40px] gap-2 px-1">
                  <span className="text-xs font-medium text-muted-foreground">Quellen-Kategorie</span>
                  <span className="text-xs font-medium text-muted-foreground">Unsere Kategorie</span>
                  <span className="sr-only">Entfernen</span>
                </div>

                {mappings.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_40px] gap-2 items-start rounded-md border p-2 sm:border-0 sm:p-0"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs sm:sr-only" htmlFor={`mapping-raw-${row.key}`}>
                        Quellen-Kategorie
                      </Label>
                      <Input
                        id={`mapping-raw-${row.key}`}
                        value={row.source_category_raw}
                        onChange={(e) =>
                          updateMappingRow(row.key, 'source_category_raw', e.target.value)
                        }
                        placeholder="z.B. Tech, Wirtschaft"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs sm:sr-only" htmlFor={`mapping-cat-${row.key}`}>
                        Unsere Kategorie
                      </Label>
                      <Select
                        value={row.category_id}
                        onValueChange={(v) => updateMappingRow(row.key, 'category_id', v)}
                      >
                        <SelectTrigger
                          id={`mapping-cat-${row.key}`}
                          className="h-9 text-sm"
                          aria-label="Kategorie zuordnen"
                        >
                          <SelectValue placeholder="Kategorie waehlen" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end sm:justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        onClick={() => removeMappingRow(row.key)}
                        aria-label={`Mapping "${row.source_category_raw || 'leer'}" entfernen`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={saving || (form.type === 'html' && !isEditing && !previewPassed)}
              title={
                form.type === 'html' && !isEditing && !previewPassed
                  ? 'Bitte zuerst die Scraping-Vorschau erfolgreich ausfuehren'
                  : undefined
              }
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Speichern' : 'Quelle anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
