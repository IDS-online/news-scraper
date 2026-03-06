'use client'

import { useState, useEffect } from 'react'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { Source, Category } from '@/types/source'

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
}

export default function SourceFormDialog({
  open,
  onOpenChange,
  source,
  categories,
  onSuccess,
}: SourceFormDialogProps) {
  const isEditing = source !== null
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

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
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setError(null)
    setFieldErrors({})
  }, [source, open])

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
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
              <Input
                id="source-url"
                type="url"
                value={form.url}
                onChange={(e) => updateField('url', e.target.value)}
                placeholder="https://example.com/feed.xml"
                aria-invalid={!!getFieldError('url')}
              />
              {getFieldError('url') && (
                <p className="text-xs text-destructive">{getFieldError('url')}</p>
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
                <Label htmlFor="source-slug">Slug</Label>
                <Input
                  id="source-slug"
                  value={form.slug}
                  onChange={(e) => updateField('slug', e.target.value)}
                  placeholder="z.B. spiegel-online"
                  aria-invalid={!!getFieldError('slug')}
                />
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
                <Input
                  id="source-retention"
                  type="number"
                  min={1}
                  value={form.retention_days}
                  onChange={(e) => updateField('retention_days', e.target.value)}
                  placeholder="z.B. 30"
                  aria-invalid={!!getFieldError('retention_days')}
                />
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
              </div>
            </div>
          )}

          {/* Category selector for RSS (selector_category can apply to RSS too) */}
          {form.type === 'rss' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-ids-slate uppercase tracking-wide">
                Kategorie-Mapping
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Speichern' : 'Quelle anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
