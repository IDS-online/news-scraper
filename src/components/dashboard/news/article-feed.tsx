'use client'

import { Newspaper, AlertCircle, SearchX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useArticles } from '@/hooks/use-articles'
import ArticleCard from '@/components/dashboard/news/article-card'
import ArticleCardSkeleton from '@/components/dashboard/news/article-card-skeleton'
import ArticleFilters from '@/components/dashboard/news/article-filters'
import ArticlePagination from '@/components/dashboard/news/article-pagination'

export default function ArticleFeed() {
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

  const hasActiveFilters = !!(filters.source_id || filters.language || filters.search)

  return (
    <div className="space-y-4">
      {/* Page heading */}
      <div>
        <h1 className="text-xl font-bold text-ids-dark">News-Feed</h1>
        <p className="text-sm text-ids-slate mt-0.5">
          Aktuelle Artikel aus allen konfigurierten Quellen
        </p>
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

      {/* Loading state */}
      {isLoading && !error && (
        <div className="grid grid-cols-1 gap-3" role="status" aria-label="Artikel werden geladen">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
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

      {/* Article list */}
      {!isLoading && !error && articles.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

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
