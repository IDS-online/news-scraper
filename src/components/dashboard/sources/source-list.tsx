'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Plus,
  Pencil,
  Trash2,
  Rss,
  Globe,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Settings,
} from 'lucide-react'
import SourceFormDialog from './source-form-dialog'
import SourceDeleteDialog from './source-delete-dialog'
import type { Source, SourcesResponse, Category } from '@/types/source'

interface SourceListProps {
  isAdmin: boolean
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SourceTypeIcon({ type }: { type: 'rss' | 'html' }) {
  if (type === 'rss') {
    return (
      <Badge variant="secondary" className="gap-1 text-xs font-medium">
        <Rss className="h-3 w-3" />
        RSS
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs font-medium">
      <Globe className="h-3 w-3" />
      HTML
    </Badge>
  )
}

function SourceTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  )
}

export default function SourceList({ isAdmin }: SourceListProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  // Dialogs
  const [formOpen, setFormOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<Source | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingSource, setDeletingSource] = useState<Source | null>(null)

  // Track toggle-in-progress per source ID
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const fetchSources = useCallback(
    async (page = 1) => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ page: page.toString() })
        if (activeFilter !== 'all') params.set('active', activeFilter)
        if (typeFilter !== 'all') params.set('type', typeFilter)

        const res = await fetch(`/api/sources?${params.toString()}`)
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Fehler beim Laden')
        }

        const data: SourcesResponse = await res.json()
        setSources(data.sources)
        setPagination({
          page: data.pagination.page,
          totalPages: data.pagination.totalPages,
          total: data.pagination.total,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      } finally {
        setLoading(false)
      }
    },
    [activeFilter, typeFilter]
  )

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories')
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories ?? [])
      }
    } catch {
      // categories are optional, don't block UI
    }
  }, [])

  useEffect(() => {
    fetchSources(1)
  }, [fetchSources])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  async function handleToggleActive(source: Source) {
    setTogglingIds((prev) => new Set(prev).add(source.id))

    try {
      const res = await fetch(`/api/sources/${source.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !source.is_active }),
      })

      if (res.ok) {
        setSources((prev) =>
          prev.map((s) => (s.id === source.id ? { ...s, is_active: !s.is_active } : s))
        )
      }
    } catch {
      // silently fail, user can retry
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(source.id)
        return next
      })
    }
  }

  function handleEdit(source: Source) {
    setEditingSource(source)
    setFormOpen(true)
  }

  function handleDelete(source: Source) {
    setDeletingSource(source)
    setDeleteDialogOpen(true)
  }

  function handleCreate() {
    setEditingSource(null)
    setFormOpen(true)
  }

  function handleFormSuccess() {
    fetchSources(pagination.page)
  }

  function handleDeleteSuccess() {
    fetchSources(pagination.page)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ids-dark flex items-center gap-2">
            <Settings className="h-6 w-6 text-ids-slate" />
            Quellen-Verwaltung
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pagination.total} {pagination.total === 1 ? 'Quelle' : 'Quellen'} konfiguriert
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSources(pagination.page)}
            disabled={loading}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              Neue Quelle
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-[140px]" aria-label="Status-Filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="true">Aktiv</SelectItem>
            <SelectItem value="false">Inaktiv</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]" aria-label="Typ-Filter">
            <SelectValue placeholder="Typ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            <SelectItem value="rss">RSS</SelectItem>
            <SelectItem value="html">HTML</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">{error}</p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                onClick={() => fetchSources(pagination.page)}
              >
                Erneut versuchen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && !error && (
        <Card>
          <CardContent className="py-6">
            <SourceTableSkeleton />
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && sources.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-ids-ice p-5 mb-4">
              <Rss className="h-10 w-10 text-ids-slate" />
            </div>
            <h2 className="text-lg font-bold text-ids-dark">Keine Quellen vorhanden</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {isAdmin
                ? 'Lege eine erste News-Quelle an, damit der Scraper Artikel sammeln kann.'
                : 'Es wurden noch keine News-Quellen konfiguriert.'}
            </p>
            {isAdmin && (
              <Button className="mt-4" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Erste Quelle anlegen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data table */}
      {!loading && !error && sources.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="sr-only">Quellen-Tabelle</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Name</TableHead>
                      <TableHead className="min-w-[200px] hidden lg:table-cell">URL</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead className="hidden md:table-cell">Sprache</TableHead>
                      <TableHead className="hidden md:table-cell">Intervall</TableHead>
                      <TableHead>Aktiv</TableHead>
                      <TableHead className="hidden lg:table-cell">Letzter Scrape</TableHead>
                      {isAdmin && <TableHead className="text-right">Aktionen</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((source) => (
                      <TableRow key={source.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-sm truncate max-w-[220px]">
                              {source.name}
                            </p>
                            {source.slug && (
                              <p className="text-xs text-muted-foreground">/{source.slug}</p>
                            )}
                            {source.last_error && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 text-destructive">
                                    <AlertCircle className="h-3 w-3" />
                                    <span className="text-xs">Fehler</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs">
                                  <p className="text-xs">{source.last_error}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-foreground truncate block max-w-[280px] underline-offset-2 hover:underline"
                              >
                                {source.url}
                              </a>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-md">
                              <p className="text-xs break-all">{source.url}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <SourceTypeIcon type={source.type} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm uppercase">{source.language}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm">{source.interval_minutes} Min.</span>
                        </TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <Switch
                              checked={source.is_active}
                              onCheckedChange={() => handleToggleActive(source)}
                              disabled={togglingIds.has(source.id)}
                              aria-label={`${source.name} ${source.is_active ? 'deaktivieren' : 'aktivieren'}`}
                            />
                          ) : (
                            <Badge
                              variant={source.is_active ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {source.is_active ? 'Aktiv' : 'Inaktiv'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {formatDate(source.last_scraped_at)}
                          </span>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEdit(source)}
                                aria-label={`${source.name} bearbeiten`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(source)}
                                aria-label={`${source.name} loeschen`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Seite {pagination.page} von {pagination.totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => fetchSources(pagination.page - 1)}
                    disabled={pagination.page <= 1 || loading}
                    aria-label="Vorherige Seite"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => fetchSources(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages || loading}
                    aria-label="Naechste Seite"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {isAdmin && (
        <>
          <SourceFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            source={editingSource}
            categories={categories}
            onSuccess={handleFormSuccess}
          />
          <SourceDeleteDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            source={deletingSource}
            onSuccess={handleDeleteSuccess}
          />
        </>
      )}
    </div>
  )
}
