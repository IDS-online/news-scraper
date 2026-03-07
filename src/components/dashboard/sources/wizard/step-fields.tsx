'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Check,
  Crosshair,
  RotateCcw,
  ArrowRight,
  Boxes,
  Type,
  LinkIcon,
  FileText,
  Calendar,
  Image,
  Tag,
} from 'lucide-react'

export interface SelectorField {
  key: string
  label: string
  required: boolean
  selector: string | null
  icon: React.ReactNode
  preview: string | null
}

interface StepFieldsProps {
  html: string
  selectors: Record<string, string | null>
  onSelectorChange: (field: string, selector: string | null) => void
  onNext: () => void
  onBack: () => void
}

const FIELD_DEFINITIONS: Omit<SelectorField, 'selector' | 'preview'>[] = [
  { key: 'selector_container', label: 'Container', required: true, icon: <Boxes className="h-4 w-4" /> },
  { key: 'selector_title', label: 'Titel', required: true, icon: <Type className="h-4 w-4" /> },
  { key: 'selector_link', label: 'Link', required: true, icon: <LinkIcon className="h-4 w-4" /> },
  { key: 'selector_description', label: 'Beschreibung', required: false, icon: <FileText className="h-4 w-4" /> },
  { key: 'selector_date', label: 'Datum', required: false, icon: <Calendar className="h-4 w-4" /> },
  { key: 'selector_image', label: 'Bild', required: false, icon: <Image className="h-4 w-4" /> },
  { key: 'selector_category', label: 'Kategorie', required: false, icon: <Tag className="h-4 w-4" /> },
]

export default function StepFields({
  html,
  selectors,
  onSelectorChange,
  onNext,
  onBack,
}: StepFieldsProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [activeFieldKey, setActiveFieldKey] = useState<string>('selector_container')
  const [previews, setPreviews] = useState<Record<string, string>>({})

  // Find the next unselected required field, or first unselected optional
  const findNextField = useCallback(
    (afterKey: string) => {
      const currentIdx = FIELD_DEFINITIONS.findIndex((f) => f.key === afterKey)
      // First look for next required
      for (let i = currentIdx + 1; i < FIELD_DEFINITIONS.length; i++) {
        if (FIELD_DEFINITIONS[i].required && !selectors[FIELD_DEFINITIONS[i].key]) {
          return FIELD_DEFINITIONS[i].key
        }
      }
      // Then look for any unselected required from the beginning
      for (let i = 0; i < FIELD_DEFINITIONS.length; i++) {
        if (FIELD_DEFINITIONS[i].required && !selectors[FIELD_DEFINITIONS[i].key]) {
          return FIELD_DEFINITIONS[i].key
        }
      }
      // Then look for next optional
      for (let i = currentIdx + 1; i < FIELD_DEFINITIONS.length; i++) {
        if (!selectors[FIELD_DEFINITIONS[i].key]) {
          return FIELD_DEFINITIONS[i].key
        }
      }
      // Stay on current
      return afterKey
    },
    [selectors]
  )

  // Listen for postMessage from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only accept messages from our iframe to prevent selector injection from other windows
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return
      if (event.data?.type === 'selector-picked' && event.data?.selector) {
        const { selector, textContent } = event.data
        onSelectorChange(activeFieldKey, selector)
        setPreviews((prev) => ({ ...prev, [activeFieldKey]: textContent || '' }))
        // Auto-advance to next field
        const nextKey = findNextField(activeFieldKey)
        setActiveFieldKey(nextKey)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [activeFieldKey, onSelectorChange, findNextField])

  function handleResetField(fieldKey: string) {
    onSelectorChange(fieldKey, null)
    setPreviews((prev) => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
    setActiveFieldKey(fieldKey)
  }

  function handleSelectField(fieldKey: string) {
    setActiveFieldKey(fieldKey)
  }

  const requiredFilled =
    selectors.selector_container && selectors.selector_title && selectors.selector_link

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-200px)] min-h-[500px]">
      {/* Left: iframe with rendered website */}
      <div className="flex-1 min-w-0 border border-ids-light rounded-lg overflow-hidden bg-white">
        <div className="bg-ids-ice px-3 py-1.5 border-b border-ids-light flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 text-ids-slate" />
          <p className="text-xs text-ids-slate font-medium">
            Klicke auf ein Element, um den Selektor fuer{' '}
            <strong className="text-ids-dark">
              {FIELD_DEFINITIONS.find((f) => f.key === activeFieldKey)?.label}
            </strong>{' '}
            auszuwaehlen
          </p>
        </div>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title="Webseiten-Vorschau zum Auswaehlen von Elementen"
        />
      </div>

      {/* Right: field selector sidebar */}
      <Card className="w-full lg:w-80 shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Felder auswaehlen</CardTitle>
          <p className="text-xs text-muted-foreground">
            Klicke links in der Webseite, um CSS-Selektoren zu generieren.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-380px)] min-h-[300px]">
            <div className="px-4 pb-4 space-y-2">
              {FIELD_DEFINITIONS.map((field) => {
                const isActive = activeFieldKey === field.key
                const isSelected = !!selectors[field.key]
                const previewText = previews[field.key]

                return (
                  <button
                    key={field.key}
                    type="button"
                    onClick={() => handleSelectField(field.key)}
                    className={`w-full text-left rounded-lg border p-3 transition-all ${
                      isActive
                        ? 'border-ids-orange bg-amber-50/50 ring-1 ring-ids-orange/30'
                        : isSelected
                          ? 'border-green-300 bg-green-50/30'
                          : 'border-ids-light hover:border-ids-grey/50'
                    }`}
                    aria-label={`Feld ${field.label} auswaehlen`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`shrink-0 ${
                            isActive
                              ? 'text-ids-orange'
                              : isSelected
                                ? 'text-green-600'
                                : 'text-ids-grey'
                          }`}
                        >
                          {isSelected ? <Check className="h-4 w-4" /> : field.icon}
                        </span>
                        <span className="text-sm font-semibold text-ids-dark">{field.label}</span>
                        <Badge
                          variant={field.required ? 'default' : 'outline'}
                          className={`text-[10px] px-1 py-0 ${
                            field.required ? 'bg-ids-orange/20 text-ids-dark border-ids-orange/30' : ''
                          }`}
                        >
                          {field.required ? 'Pflicht' : 'Optional'}
                        </Badge>
                      </div>
                      {isSelected && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleResetField(field.key)
                          }}
                          aria-label={`${field.label} neu waehlen`}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {isSelected && selectors[field.key] && (
                      <div className="mt-1.5 ml-6">
                        <code className="text-[11px] text-ids-slate bg-ids-ice px-1.5 py-0.5 rounded block truncate">
                          {selectors[field.key]}
                        </code>
                        {previewText && (
                          <p className="text-[11px] text-ids-grey mt-0.5 truncate">
                            {previewText}
                          </p>
                        )}
                      </div>
                    )}
                    {isActive && !isSelected && (
                      <p className="text-[11px] text-ids-orange mt-1 ml-6">
                        Klicke auf ein Element in der Webseite...
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-ids-light space-y-2">
            <Button className="w-full" onClick={onNext} disabled={!requiredFilled}>
              Weiter zur Vorschau
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
            <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
              Zurueck
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
