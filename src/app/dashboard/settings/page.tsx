'use client'

import RetentionSettings from '@/components/dashboard/settings/retention-settings'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ids-dark">Einstellungen</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Systemweite Konfigurationen fuer Newsgrap3r.
        </p>
      </div>

      <RetentionSettings />
    </div>
  )
}
