'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import WizardHeader from './wizard-header'
import StepUrl from './step-url'
import StepFields from './step-fields'
import StepPreview from './step-preview'

type WizardStep = 1 | 2 | 3 | 4

export default function VisualSourceWizard() {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1 state
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fetchedHtml, setFetchedHtml] = useState<string | null>(null)

  // Step 2 state
  const [selectors, setSelectors] = useState<Record<string, string | null>>({
    selector_container: null,
    selector_title: null,
    selector_link: null,
    selector_description: null,
    selector_date: null,
    selector_image: null,
    selector_category: null,
  })

  // Step 4 state
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedSourceId, setSavedSourceId] = useState<string | null>(null)

  function handleWebsiteLoaded(html: string) {
    setFetchedHtml(html)
    setStep(2)
  }

  function handleSelectorChange(field: string, selector: string | null) {
    setSelectors((prev) => ({ ...prev, [field]: selector }))
  }

  function handleGoToPreview() {
    setStep(3)
  }

  function handleBackToFields() {
    setStep(2)
  }

  function handleBackToUrl() {
    setStep(1)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    try {
      // Generate a slug from the name
      const slug = sourceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        || 'source'

      const payload = {
        name: sourceName.trim() || new URL(sourceUrl).hostname,
        url: sourceUrl,
        type: 'html',
        language: 'auto',
        interval_minutes: 60,
        is_active: true,
        slug,
        selector_container: selectors.selector_container,
        selector_title: selectors.selector_title,
        selector_link: selectors.selector_link,
        selector_description: selectors.selector_description || null,
        selector_date: selectors.selector_date || null,
        selector_image: selectors.selector_image || null,
        selector_category: selectors.selector_category || null,
      }

      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setSaveError(data.error || 'Fehler beim Speichern der Quelle.')
        return
      }

      setSavedSourceId(data.data?.id || data.id || null)
      setStep(4)
    } catch {
      setSaveError('Netzwerkfehler. Bitte die Verbindung ueberpruefen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <WizardHeader
        currentStep={step <= 3 ? step : 3}
        totalSteps={3}
        sourceName={sourceName}
        sourceUrl={sourceUrl}
      />

      {/* Step 1: URL eingeben */}
      {step === 1 && (
        <StepUrl
          sourceName={sourceName}
          sourceUrl={sourceUrl}
          onSourceNameChange={setSourceName}
          onSourceUrlChange={setSourceUrl}
          onLoadWebsite={handleWebsiteLoaded}
        />
      )}

      {/* Step 2: Felder auswaehlen */}
      {step === 2 && fetchedHtml && (
        <StepFields
          html={fetchedHtml}
          selectors={selectors}
          onSelectorChange={handleSelectorChange}
          onNext={handleGoToPreview}
          onBack={handleBackToUrl}
        />
      )}

      {/* Step 3: Vorschau & Bestaetigung */}
      {step === 3 && (
        <StepPreview
          sourceUrl={sourceUrl}
          selectors={selectors}
          onBack={handleBackToFields}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Save error (shown in step 3) */}
      {saveError && step === 3 && (
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-destructive bg-destructive/5 rounded-lg px-4 py-2 text-sm">
            {saveError}
          </div>
        </div>
      )}

      {/* Step 4: Erfolg */}
      {step === 4 && (
        <div className="flex items-center justify-center min-h-[50vh]">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-2">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-ids-dark">Quelle gespeichert</h2>
              <p className="text-sm text-muted-foreground">
                Die Quelle <strong>{sourceName || 'Neue Quelle'}</strong> wurde erfolgreich
                angelegt und wird beim naechsten Scraping-Lauf automatisch abgerufen.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                <Button asChild>
                  <Link href="/dashboard/sources">Zur Quellenliste</Link>
                </Button>
                {savedSourceId && (
                  <Button variant="outline" asChild>
                    <Link href={`/dashboard/sources/${savedSourceId}/articles`}>
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      Artikel anzeigen
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
