'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ArticlePaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  isLoading: boolean
}

export default function ArticlePagination({
  page,
  totalPages,
  onPageChange,
  isLoading,
}: ArticlePaginationProps) {
  if (totalPages <= 1) return null

  // Build page numbers to display
  function getPageNumbers(): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      // Always show first page
      pages.push(1)

      const start = Math.max(2, page - 1)
      const end = Math.min(totalPages - 1, page + 1)

      if (start > 2) pages.push('ellipsis')

      for (let i = start; i <= end; i++) pages.push(i)

      if (end < totalPages - 1) pages.push('ellipsis')

      // Always show last page
      pages.push(totalPages)
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <nav
      role="navigation"
      aria-label="Seitennavigation"
      className="flex items-center justify-center gap-1 pt-4"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1 || isLoading}
        className="h-8 px-2 text-ids-slate hover:text-ids-dark"
        aria-label="Vorherige Seite"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline ml-1">Zurueck</span>
      </Button>

      <div className="flex items-center gap-0.5">
        {pageNumbers.map((item, idx) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-8 w-8 items-center justify-center text-ids-grey text-sm"
              aria-hidden
            >
              ...
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onPageChange(item)}
              disabled={isLoading}
              className={
                item === page
                  ? 'h-8 w-8 p-0 bg-ids-orange text-ids-dark font-bold hover:bg-ids-orange-real'
                  : 'h-8 w-8 p-0 text-ids-slate hover:text-ids-dark hover:bg-ids-ice'
              }
              aria-label={`Seite ${item}`}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </Button>
          )
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages || isLoading}
        className="h-8 px-2 text-ids-slate hover:text-ids-dark"
        aria-label="Naechste Seite"
      >
        <span className="hidden sm:inline mr-1">Weiter</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  )
}
