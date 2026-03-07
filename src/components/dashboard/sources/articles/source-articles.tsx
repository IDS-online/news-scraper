'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Newspaper, Rss, Globe, RefreshCw } from 'lucide-react'
import { useArticles } from '@/hooks/use-articles'
import type { Article } from '@/hooks/use-articles'
import ViewToggle, { type ViewMode } from './view-toggle'
import ArticleListItem from './article-list-item'
import ArticleGridCard from './article-grid-card'
import ArticleDeleteDialog from './article-delete-dialog'
import ArticlePagination from '@/components/dashboard/news/article-pagination'

const VIEW_MODE_KEY = 'newsgrap3r-view-mode'
const ARTICLES_PER_PAGE = 50

interface SourceArticlesProps {
  sourceId: string
  isAdmin: boolean
}

interface SourceInfo {
  id: string
  name: string
  type: 'rss' | 'html'
  language: string
  is_active: boolean
  last_scraped_at: string | null
  url: string
}

function SourceDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-48" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-[60px] w-[60px] rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="aspect-video w-full" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex justify-between pt-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

export default function SourceArticles({ sourceId, isAdmin }: SourceArticlesProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState<string | null>(null)

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingArticleId, setDeletingArticleId] = useState<string | null>(null)
  const [deletingArticleTitle, setDeletingArticleTitle] = useState<string | null>(null)

  // Read view mode from localStorage on mount
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

  // Save view mode to localStorage
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // silently fail
    }
  }

  // Fetch source info
  const fetchSource = useCallback(async () => {
    setSourceLoading(true)
    setSourceError(null)

    try {
      const res = await fetch(`/api/sources/${sourceId}`)
      if (!res.ok) {
        if (res.status === 404) {
          setSourceError('Quelle nicht gefunden')
          return
        }
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Fehler ${res.status}`)
      }

      const data = await res.json()
      setSource({
        id: data.source.id,
        name: data.source.name,
        type: data.source.type,
        language: data.source.language,
        is_active: data.source.is_active,
        last_scraped_at: data.source.last_scraped_at,
        url: data.source.url,
      })
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setSourceLoading(false)
    }
  }, [sourceId])

  useEffect(() => {
    fetchSource()
  }, [fetchSource])

  // Use the existing articles hook with source_id filter
  const {
    articles,
    total,
    page,
    totalPages,
    isLoading: articlesLoading,
    error: articlesError,
    setPage,
    refetch,
  } = useArticles({
    source_id: sourceId,
    limit: ARTICLES_PER_PAGE,
  })

  // Handle article deletion
  function handleDeleteRequest(articleId: string, title: string) {
    setDeletingArticleId(articleId)
    setDeletingArticleTitle(title)
    setDeleteDialogOpen(true)
  }

  function handleDeleteSuccess(deletedId: string) {
    // Refetch to update the list after deletion
    refetch()
    // Reset dialog state
    setDeletingArticleId(null)
    setDeletingArticleTitle(null)
  }

  // Source loading state
  if (sourceLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Quelle wird geladen">
        <SourceDetailSkeleton />
      </div>
    )
  }

  // Source error state
  if (sourceError) {
    return (
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard/news">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard/sources">Quellen</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Fehler</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-bold text-ids-dark">{sourceError}</h2>
            <p className="text-sm text-ids-slate">
              Die Quelle konnte nicht geladen werden.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={fetchSource}>
                Erneut versuchen
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/sources">Zurueck zu Quellen</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!source) return null

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard/news">Dashboard</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard/sources">Quellen</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{source.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header with source info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ids-dark">{source.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant="secondary" className="gap-1 text-xs font-medium">
              {source.type === 'rss' ? (
                <Rss className="h-3 w-3" />
              ) : (
                <Globe className="h-3 w-3" />
              )}
              {source.type.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {source.language.toUpperCase()}
            </Badge>
            {!source.is_active && (
              <Badge variant="secondary" className="text-xs text-ids-grey">
                Inaktiv
              </Badge>
            )}
            <span className="text-sm text-ids-slate">
              {total} {total === 1 ? 'Artikel' : 'Artikel'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={articlesLoading}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={`h-4 w-4 ${articlesLoading ? 'animate-spin' : ''}`} />
          </Button>
          <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
        </div>
      </div>

      {/* Articles error state */}
      {articlesError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">{articlesError}</p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                onClick={refetch}
              >
                Erneut versuchen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Articles loading state */}
      {articlesLoading && !articlesError && (
        <div role="status" aria-label="Artikel werden geladen">
          {viewMode === 'list' ? (
            <Card>
              <CardContent className="p-0">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 border-b last:border-b-0">
                    <Skeleton className="h-[60px] w-[60px] rounded-md shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <GridSkeleton />
          )}
        </div>
      )}

      {/* Empty state */}
      {!articlesLoading && !articlesError && articles.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="rounded-full bg-ids-ice p-5">
              <Newspaper className="h-10 w-10 text-ids-slate" />
            </div>
            <h2 className="text-lg font-bold text-ids-dark">
              Noch keine Artikel fuer diese Quelle
            </h2>
            <p className="text-sm text-ids-slate max-w-sm">
              {source.is_active
                ? 'Die Quelle ist aktiv. Artikel erscheinen hier nach dem naechsten Scraping-Durchlauf.'
                : 'Die Quelle ist derzeit inaktiv. Aktiviere sie, damit Artikel gescraped werden.'}
            </p>
            {isAdmin && (
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <Link href="/dashboard/sources">Quellen verwalten</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Articles list/grid */}
      {!articlesLoading && !articlesError && articles.length > 0 && (
        <>
          {viewMode === 'list' ? (
            <Card>
              <CardContent className="p-0">
                {articles.map((article: Article) => (
                  <ArticleListItem
                    key={article.id}
                    article={article}
                    isAdmin={isAdmin}
                    onDelete={handleDeleteRequest}
                  />
                ))}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((article: Article) => (
                <ArticleGridCard
                  key={article.id}
                  article={article}
                  isAdmin={isAdmin}
                  onDelete={handleDeleteRequest}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          <ArticlePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            isLoading={articlesLoading}
          />
        </>
      )}

      {/* Delete dialog */}
      {isAdmin && (
        <ArticleDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          articleId={deletingArticleId}
          articleTitle={deletingArticleTitle}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  )
}
