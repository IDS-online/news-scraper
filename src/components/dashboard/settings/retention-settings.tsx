'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Clock, Trash2, Loader2 } from 'lucide-react'

interface SettingsData {
  settings: {
    retention_enabled: boolean
  }
  last_retention_run: {
    run_at: string
    deleted_count: number
  } | null
}

export default function RetentionSettings() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const fetchSettings = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/api/admin/settings')
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Fehler beim Laden der Einstellungen')
      }
      const result: SettingsData = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  async function handleToggle(newValue: boolean) {
    // If enabling, show confirmation dialog first
    if (newValue && !data?.settings.retention_enabled) {
      setShowConfirmDialog(true)
      return
    }

    await updateRetention(newValue)
  }

  async function updateRetention(newValue: boolean) {
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_enabled: newValue }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Fehler beim Speichern')
      }

      // Refresh all data
      await fetchSettings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setSaving(false)
    }
  }

  function handleConfirmEnable() {
    setShowConfirmDialog(false)
    updateRetention(true)
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Loading state
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }

  // Error state (no data loaded at all)
  if (error && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Automatische Artikel-Loeschung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const { settings, last_retention_run } = data

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Automatische Artikel-Loeschung
              </CardTitle>
              <CardDescription>
                Wenn aktiviert, werden Artikel automatisch nach der pro Quelle konfigurierten
                Aufbewahrungsfrist geloescht. Der Loeschlauf erfolgt taeglich um 03:00 UTC.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Error banner (non-fatal, data already loaded) */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Global toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label
                htmlFor="retention-toggle"
                className="text-sm font-medium cursor-pointer"
              >
                Automatische Loeschung
              </Label>
              <p className="text-xs text-muted-foreground">
                Aktiviert oder deaktiviert den taeglichen Loeschlauf fuer alle Quellen.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                id="retention-toggle"
                checked={settings.retention_enabled}
                onCheckedChange={handleToggle}
                disabled={saving}
                aria-label="Automatische Artikel-Loeschung ein- oder ausschalten"
              />
              <Badge
                variant={settings.retention_enabled ? 'default' : 'secondary'}
                className={
                  settings.retention_enabled
                    ? 'bg-green-100 text-green-800 hover:bg-green-100'
                    : ''
                }
              >
                {settings.retention_enabled ? 'Aktiviert' : 'Deaktiviert'}
              </Badge>
            </div>
          </div>

          {/* Last run info */}
          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Letzter Loeschlauf
            </h3>
            {last_retention_run ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Zeitpunkt</p>
                  <p className="text-sm font-medium">
                    {formatDate(last_retention_run.run_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Geloeschte Artikel</p>
                  <p className="text-sm font-medium">
                    {last_retention_run.deleted_count.toLocaleString('de-DE')} Artikel
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Es wurde noch kein Loeschlauf ausgefuehrt.
              </p>
            )}
          </div>

          {/* Info hint */}
          <div className="rounded-lg bg-ids-ice p-4">
            <p className="text-xs text-ids-slate">
              <strong>Hinweis:</strong> Die Aufbewahrungsfrist wird pro Quelle in den
              Quellen-Einstellungen konfiguriert. Quellen ohne konfigurierte Frist oder mit
              der Option &quot;Nie loeschen&quot; sind vom automatischen Loeschlauf ausgenommen.
              Die Mindestfrist betraegt 7 Tage.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Automatische Loeschung aktivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Dadurch werden Artikel unwiderruflich geloescht, sobald sie die
              konfigurierte Aufbewahrungsfrist ueberschreiten. Dieser Vorgang kann
              nicht rueckgaengig gemacht werden. Sind Sie sicher?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmEnable}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ja, aktivieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
