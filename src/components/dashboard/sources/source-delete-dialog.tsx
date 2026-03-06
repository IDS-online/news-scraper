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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { Source } from '@/types/source'

interface SourceDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: Source | null
  onSuccess: () => void
}

export default function SourceDeleteDialog({
  open,
  onOpenChange,
  source,
  onSuccess,
}: SourceDeleteDialogProps) {
  const [deleteArticles, setDeleteArticles] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!source) return
    setDeleting(true)
    setError(null)

    try {
      const params = deleteArticles ? '?deleteArticles=true' : ''
      const res = await fetch(`/api/sources/${source.id}${params}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Fehler beim Loeschen')
        return
      }

      setDeleteArticles(false)
      onSuccess()
      onOpenChange(false)
    } catch {
      setError('Netzwerkfehler. Bitte versuche es erneut.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quelle loeschen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Bist du sicher, dass du die Quelle{' '}
                <span className="font-semibold text-foreground">{source?.name}</span> loeschen
                moechtest? Diese Aktion kann nicht rueckgaengig gemacht werden.
              </p>

              <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <Checkbox
                  id="delete-articles"
                  checked={deleteArticles}
                  onCheckedChange={(v) => setDeleteArticles(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="delete-articles" className="text-sm font-medium cursor-pointer">
                    Zugehoerige Artikel ebenfalls loeschen
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Achtung: Alle Artikel dieser Quelle werden unwiderruflich entfernt.
                  </p>
                </div>
              </div>

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
            {deleteArticles ? 'Quelle & Artikel loeschen' : 'Quelle loeschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
