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
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  RefreshCw,
  Tags,
} from 'lucide-react'
import CategoryFormDialog from './category-form-dialog'
import CategoryDeleteDialog from './category-delete-dialog'
import type { Category } from './category-form-dialog'

interface CategoryListProps {
  isAdmin: boolean
}

function CategoryTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  )
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export default function CategoryList({ isAdmin }: CategoryListProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialogs
  const [formOpen, setFormOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/categories')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Fehler beim Laden der Kategorien')
      }

      const data = await res.json()
      setCategories(data.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  function handleCreate() {
    setEditingCategory(null)
    setFormOpen(true)
  }

  function handleEdit(category: Category) {
    setEditingCategory(category)
    setFormOpen(true)
  }

  function handleDelete(category: Category) {
    setDeletingCategory(category)
    setDeleteDialogOpen(true)
  }

  function handleFormSuccess() {
    fetchCategories()
  }

  function handleDeleteSuccess() {
    fetchCategories()
  }

  const totalArticles = categories.reduce((sum, cat) => sum + cat.article_count, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ids-dark flex items-center gap-2">
            <Tags className="h-6 w-6 text-ids-slate" />
            Kategorien
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {categories.length} {categories.length === 1 ? 'Kategorie' : 'Kategorien'}
            {!loading && categories.length > 0 && (
              <span> &middot; {totalArticles} {totalArticles === 1 ? 'Artikel' : 'Artikel'} zugeordnet</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCategories}
            disabled={loading}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              Neue Kategorie
            </Button>
          )}
        </div>
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
                onClick={fetchCategories}
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
            <CategoryTableSkeleton />
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && categories.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-ids-ice p-5 mb-4">
              <Tags className="h-10 w-10 text-ids-slate" />
            </div>
            <h2 className="text-lg font-bold text-ids-dark">Keine Kategorien vorhanden</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {isAdmin
                ? 'Lege eine erste Kategorie an, damit Artikel automatisch klassifiziert werden koennen.'
                : 'Es wurden noch keine Kategorien definiert.'}
            </p>
            {isAdmin && (
              <Button className="mt-4" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Erste Kategorie anlegen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data table */}
      {!loading && !error && categories.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="sr-only">Kategorien-Tabelle</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]">Name</TableHead>
                      <TableHead className="min-w-[250px]">Beschreibung</TableHead>
                      <TableHead className="text-right">Artikel</TableHead>
                      {isAdmin && (
                        <TableHead className="text-right">Aktionen</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell>
                          <span className="font-medium text-sm">{category.name}</span>
                        </TableCell>
                        <TableCell>
                          {category.description.length > 80 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm text-muted-foreground cursor-default">
                                  {truncate(category.description, 80)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-md">
                                <p className="text-xs whitespace-pre-wrap">{category.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {category.description}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {category.article_count}
                          </Badge>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEdit(category)}
                                aria-label={`${category.name} bearbeiten`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(category)}
                                aria-label={`${category.name} loeschen`}
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
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {isAdmin && (
        <>
          <CategoryFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            category={editingCategory}
            onSuccess={handleFormSuccess}
          />
          <CategoryDeleteDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            category={deletingCategory}
            onSuccess={handleDeleteSuccess}
          />
        </>
      )}
    </div>
  )
}
