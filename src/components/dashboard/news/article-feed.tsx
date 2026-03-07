'use client'

import { useState, useEffect } from 'react'
import { Newspaper, AlertCircle, SearchX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useArticles } from '@/hooks/use-articles'
import ArticleCard from '@/components/dashboard/news/article-card'
import ArticleCardSkeleton from '@/components/dashboard/news/article-card-skeleton'
import ArticleFilters from '@/components/dashboard/news/article-filters'
import ArticlePagination from '@/components/dashboard/news/article-pagination'
import ViewToggle, { type ViewMode } from '@/components/dashboard/sources/articles/view-toggle'
import ArticleGridCard from '@/components/dashboard/sources/articles/article-grid-card'

const VIEW_MODE_KEY = 'newsgrap3r-view-mode'

export default function ArticleFeed() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')

  const {
    articles,
    total,
    page,
    totalPages,
    isLoading,
    error,
    setPage,
    setFilters,
    filters,
    refetch,
  } = useArticles()

  // Restore view mode from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY)
      if (stored === 'list' || stored === 'grid') {
        setViewMode(stored)
      }
    } catch {
      // localStorage may not be available
    }
  }, [])

  // Persist view mode to localStorage
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // silently fail
    }
  }

  const hasActiveFilters = !!(filters.source_id || filters.language || filters.search || filters.category_id || filters.from || filters.to)

  return (
    <div className="space-y-4">
      {/* Page heading with view toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ids-dark">News-Feed</h1>
          <p className="text-sm text-ids-slate mt-0.5">
            Aktuelle Artikel aus allen konfigurierten Quellen
          </p>
        </div>
        <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
      </div>

      {/* Filters */}
      <ArticleFilters
        filters={filters}
        onFilterChange={setFilters}
        total={total}
        isLoading={isLoading}
      />

      {/* Error state */}
      {error && (
        <Alert variant="destructive" className="border-ids-pink/30 bg-ids-pink/5">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="shrink-0 h-7 text-xs"
            >
              Erneut versuchen
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading state - adapts to current view mode */}
      {isLoading && !error && (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
              : 'grid grid-cols-1 gap-3'
          }
          role="status"
          aria-label="Artikel werden geladen"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <ArticleCardSkeleton key={i} variant={viewMode} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && articles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          {hasActiveFilters ? (
            <>
              <div className="rounded-full bg-ids-ice p-4">
                <SearchX className="h-8 w-8 text-ids-slate" />
              </div>
              <h2 className="text-base font-bold text-ids-dark">
                Keine Artikel gefunden
              </h2>
              <p className="text-sm text-ids-slate max-w-sm">
                Fuer die aktuellen Filter wurden keine Artikel gefunden. Versuche andere Filtereinstellungen.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setFilters({
                    source_id: undefined,
                    language: undefined,
                    search: undefined,
                    category_id: undefined,
                    from: undefined,
                    to: undefined,
                  })
                }
                className="mt-2"
              >
                Filter zuruecksetzen
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-full bg-ids-ice p-4">
                <Newspaper className="h-8 w-8 text-ids-slate" />
              </div>
              <h2 className="text-base font-bold text-ids-dark">
                Noch keine Artikel vorhanden
              </h2>
              <p className="text-sm text-ids-slate max-w-sm">
                Sobald Quellen konfiguriert und gescraped werden, erscheinen hier die Artikel.
              </p>
            </>
          )}
        </div>
      )}

      {/* Article list / grid */}
      {!isLoading && !error && articles.length > 0 && (
        <>
          {viewMode === 'list' ? (
            <div className="grid grid-cols-1 gap-3">
              {articles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((article) => (
                <ArticleGridCard
                  key={article.id}
                  article={article}
                  isAdmin={false}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          <ArticlePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  )
}
