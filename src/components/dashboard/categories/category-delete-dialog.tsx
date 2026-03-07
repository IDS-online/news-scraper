'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2 } from 'lucide-react'
import type { Category } from './category-form-dialog'

interface CategoryDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: Category | null
  onSuccess: () => void
}

export default function CategoryDeleteDialog({
  open,
  onOpenChange,
  category,
  onSuccess,
}: CategoryDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!category) return
    setDeleting(true)
    setError(null)

    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Fehler beim Loeschen')
        return
      }

      onSuccess()
      onOpenChange(false)
    } catch {
      setError('Netzwerkfehler. Bitte versuche es erneut.')
    } finally {
      setDeleting(false)
    }
  }

  const articleCount = category?.article_count ?? 0

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kategorie loeschen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Bist du sicher, dass du die Kategorie{' '}
                <span className="font-semibold text-foreground">{category?.name}</span> loeschen
                moechtest?
              </p>

              {articleCount > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-medium">
                    {articleCount} {articleCount === 1 ? 'Artikel ist' : 'Artikel sind'} dieser
                    Kategorie zugeordnet.
                  </p>
                  <p className="mt-1 text-xs">
                    Die Artikel werden nicht geloescht, verlieren aber diese Kategorie-Zuordnung.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Kategorie loeschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
