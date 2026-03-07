'use client'

import { LayoutList, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ViewMode = 'list' | 'grid'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export default function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center border rounded-md" role="radiogroup" aria-label="Ansichtsmodus">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('list')}
        className={cn(
          'h-8 px-3 rounded-r-none border-r',
          mode === 'list'
            ? 'bg-ids-ice text-ids-dark'
            : 'text-ids-grey hover:text-ids-dark'
        )}
        aria-label="Listenansicht"
        aria-checked={mode === 'list'}
        role="radio"
      >
        <LayoutList className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('grid')}
        className={cn(
          'h-8 px-3 rounded-l-none',
          mode === 'grid'
            ? 'bg-ids-ice text-ids-dark'
            : 'text-ids-grey hover:text-ids-dark'
        )}
        aria-label="Kachelansicht"
        aria-checked={mode === 'grid'}
        role="radio"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  )
}
