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

interface ArticleDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  articleId: string | null
  articleTitle: string | null
  onSuccess: (deletedId: string) => void
}

export default function ArticleDeleteDialog({
  open,
  onOpenChange,
  articleId,
  articleTitle,
  onSuccess,
}: ArticleDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!articleId) return

    setDeleting(true)
    setError(null)

    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Fehler ${res.status}`)
      }

      onSuccess(articleId)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Artikel loeschen?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Diese Aktion kann nicht rueckgaengig gemacht werden.
            </span>
            {articleTitle && (
              <span className="block font-medium text-foreground truncate">
                &quot;{articleTitle}&quot;
              </span>
            )}
            {error && (
              <span className="block text-destructive text-sm">{error}</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? 'Loeschen...' : 'Loeschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
