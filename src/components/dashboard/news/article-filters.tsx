'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ArticleFilters as FilterValues } from '@/hooks/use-articles'

interface Source {
  id: string
  name: string
}

interface ArticleFiltersProps {
  filters: FilterValues
  onFilterChange: (filters: Partial<Omit<FilterValues, 'page' | 'limit'>>) => void
  total: number
  isLoading: boolean
}

const LANGUAGES = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Francais' },
  { value: 'es', label: 'Espanol' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pt', label: 'Portugues' },
  { value: 'pl', label: 'Polski' },
]

export default function ArticleFilters({
  filters,
  onFilterChange,
  total,
  isLoading,
}: ArticleFiltersProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  // Fetch sources for the dropdown
  useEffect(() => {
    async function loadSources() {
      try {
        const res = await fetch('/api/sources?active=true')
        if (res.ok) {
          const json = await res.json()
          setSources(
            (json.sources ?? []).map((s: { id: string; name: string }) => ({
              id: s.id,
              name: s.name,
            }))
          )
        }
      } catch {
        // Silently fail - sources dropdown will be empty
      } finally {
        setSourcesLoading(false)
      }
    }
    loadSources()
  }, [])

  const hasActiveFilters = !!(filters.source_id || filters.language || filters.search)

  function clearFilters() {
    onFilterChange({
      source_id: undefined,
      language: undefined,
      search: undefined,
      from: undefined,
      to: undefined,
    })
  }

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ids-grey" />
          <Input
            type="text"
            placeholder="Artikel suchen..."
            value={filters.search ?? ''}
            onChange={(e) => onFilterChange({ search: e.target.value || undefined })}
            className="pl-9 h-9 bg-white border-ids-light text-sm"
            aria-label="Artikel nach Titel suchen"
          />
        </div>

        {/* Source filter */}
        <Select
          value={filters.source_id ?? '__all__'}
          onValueChange={(val) =>
            onFilterChange({ source_id: val === '__all__' ? undefined : val })
          }
          disabled={sourcesLoading}
        >
          <SelectTrigger className="h-9 w-full sm:w-[180px] bg-white border-ids-light text-sm" aria-label="Nach Quelle filtern">
            <SelectValue placeholder="Alle Quellen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Alle Quellen</SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Language filter */}
        <Select
          value={filters.language ?? '__all__'}
          onValueChange={(val) =>
            onFilterChange({ language: val === '__all__' ? undefined : val })
          }
        >
          <SelectTrigger className="h-9 w-full sm:w-[160px] bg-white border-ids-light text-sm" aria-label="Nach Sprache filtern">
            <SelectValue placeholder="Alle Sprachen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Alle Sprachen</SelectItem>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 text-ids-slate hover:text-ids-dark gap-1 shrink-0"
            aria-label="Filter zuruecksetzen"
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zuruecksetzen</span>
          </Button>
        )}
      </div>

      {/* Result count */}
      <div className="text-xs text-ids-grey">
        {isLoading ? (
          <span>Lade Artikel...</span>
        ) : (
          <span>
            {total === 0
              ? 'Keine Artikel gefunden'
              : `${total} ${total === 1 ? 'Artikel' : 'Artikel'} gefunden`}
          </span>
        )}
      </div>
    </div>
  )
}
