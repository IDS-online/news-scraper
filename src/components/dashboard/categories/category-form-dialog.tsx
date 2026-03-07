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
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2 } from 'lucide-react'

export interface Category {
  id: string
  name: string
  description: string
  article_count: number
  created_at: string
  updated_at: string
}

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: Category | null
  onSuccess: () => void
}

interface FormData {
  name: string
  description: string
}

const EMPTY_FORM: FormData = {
  name: '',
  description: '',
}

export default function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSuccess,
}: CategoryFormDialogProps) {
  const isEditing = category !== null
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (category) {
      setForm({
        name: category.name,
        description: category.description,
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setError(null)
    setFieldErrors({})
  }, [category, open])

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors({})

    try {
      const payload = {
        name: form.name,
        description: form.description,
      }

      const url = isEditing ? `/api/categories/${category.id}` : '/api/categories'
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

  const descriptionLength = form.description.length
  const descriptionTooShort = descriptionLength > 0 && descriptionLength < 20

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Kategorie bearbeiten' : 'Neue Kategorie anlegen'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Passe Name oder Beschreibung dieser Kategorie an.'
              : 'Erstelle eine neue Kategorie zur Klassifizierung von Artikeln.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="category-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="category-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="z.B. Dentaltechnik"
              maxLength={100}
              aria-invalid={!!getFieldError('name')}
            />
            {getFieldError('name') && (
              <p className="text-xs text-destructive">{getFieldError('name')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-description">
              Beschreibung <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="category-description"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Beschreibe die Kategorie moeglichst praezise. Diese Beschreibung wird fuer die automatische KI-Kategorisierung verwendet."
              rows={4}
              aria-invalid={!!getFieldError('description') || descriptionTooShort}
            />
            <div className="flex items-center justify-between">
              <div>
                {getFieldError('description') && (
                  <p className="text-xs text-destructive">{getFieldError('description')}</p>
                )}
                {descriptionTooShort && !getFieldError('description') && (
                  <p className="text-xs text-amber-600">
                    Mindestens 20 Zeichen erforderlich ({descriptionLength}/20)
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {descriptionLength} Zeichen
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Tipp: Beschreibe Themen, Unterthemen und typische Begriffe, damit die KI-Kategorisierung moeglichst treffsicher arbeitet.
            </p>
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
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Speichern' : 'Kategorie anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
