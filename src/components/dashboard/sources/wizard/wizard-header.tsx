'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Wand2 } from 'lucide-react'

interface WizardHeaderProps {
  currentStep: number
  totalSteps: number
  sourceName?: string
  sourceUrl?: string
}

export default function WizardHeader({
  currentStep,
  totalSteps,
  sourceName,
  sourceUrl,
}: WizardHeaderProps) {
  const stepLabels = ['URL eingeben', 'Felder auswaehlen', 'Vorschau']

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-ids-light">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
          <Link href="/dashboard/sources" aria-label="Zurueck zur Quellenliste">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-bold text-ids-dark flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-ids-orange" />
            Visueller Einrichtungsassistent
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {stepLabels.map((label, idx) => {
              const stepNum = idx + 1
              const isActive = stepNum === currentStep
              const isDone = stepNum < currentStep
              return (
                <div key={label} className="flex items-center gap-1.5">
                  {idx > 0 && (
                    <div
                      className={`w-4 h-px ${
                        isDone ? 'bg-ids-orange' : 'bg-ids-light'
                      }`}
                    />
                  )}
                  <Badge
                    variant={isActive ? 'default' : isDone ? 'secondary' : 'outline'}
                    className={`text-[11px] px-1.5 py-0 ${
                      isActive
                        ? 'bg-ids-orange text-ids-dark'
                        : isDone
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : ''
                    }`}
                  >
                    {stepNum}
                  </Badge>
                  <span
                    className={`text-xs hidden sm:inline ${
                      isActive
                        ? 'font-semibold text-ids-dark'
                        : isDone
                          ? 'text-green-700'
                          : 'text-ids-grey'
                    }`}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link
            href={`/dashboard/sources?action=new${sourceUrl ? `&url=${encodeURIComponent(sourceUrl)}` : ''}${sourceName ? `&name=${encodeURIComponent(sourceName)}` : ''}`}
          >
            Manuell einrichten
          </Link>
        </Button>
      </div>
    </div>
  )
}
