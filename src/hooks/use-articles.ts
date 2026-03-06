'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface Article {
  id: string
  title: string
  url: string
  description: string | null
  image_url: string | null
  published_at: string | null
  language: string | null
  source_id: string
  category_id: string | null
  source_name: string | null
  source_slug: string | null
  category_name: string | null
  source_category_raw: string | null
  categorization_status: string | null
  created_at: string
}

export interface ArticlesResponse {
  data: Article[]
  total: number
  page: number
  limit: number
}

export interface ArticleFilters {
  source_id?: string
  language?: string
  search?: string
  from?: string
  to?: string
  page: number
  limit: number
}

interface UseArticlesReturn {
  articles: Article[]
  total: number
  page: number
  totalPages: number
  isLoading: boolean
  error: string | null
  setPage: (page: number) => void
  setFilters: (filters: Partial<Omit<ArticleFilters, 'page' | 'limit'>>) => void
  filters: ArticleFilters
  refetch: () => void
}

const DEFAULT_LIMIT = 20
const DEBOUNCE_MS = 300

export function useArticles(initialFilters?: Partial<ArticleFilters>): UseArticlesReturn {
  const [filters, setFiltersState] = useState<ArticleFilters>({
    page: initialFilters?.page ?? 1,
    limit: initialFilters?.limit ?? DEFAULT_LIMIT,
    source_id: initialFilters?.source_id,
    language: initialFilters?.language,
    search: initialFilters?.search,
    from: initialFilters?.from,
    to: initialFilters?.to,
  })

  const [articles, setArticles] = useState<Article[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounce timer ref for search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the actual search value that has been debounced
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search)

  // Abort controller for in-flight requests
  const abortRef = useRef<AbortController | null>(null)

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [filters.search])

  const fetchArticles = useCallback(async () => {
    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('page', String(filters.page))
    params.set('limit', String(filters.limit))
    if (filters.source_id) params.set('source_id', filters.source_id)
    if (filters.language) params.set('language', filters.language)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)

    try {
      const res = await fetch(`/api/articles?${params.toString()}`, {
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Fehler ${res.status}`)
      }

      const json: ArticlesResponse = await res.json()
      setArticles(json.data)
      setTotal(json.total)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return // Ignore aborted requests
      }
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Laden der Artikel')
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [filters.page, filters.limit, filters.source_id, filters.language, debouncedSearch, filters.from, filters.to])

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  const setPage = useCallback((page: number) => {
    setFiltersState((prev) => ({ ...prev, page }))
  }, [])

  const setFilters = useCallback((newFilters: Partial<Omit<ArticleFilters, 'page' | 'limit'>>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
      page: 1, // Reset to first page on filter change
    }))
  }, [])

  const totalPages = Math.ceil(total / filters.limit)

  return {
    articles,
    total,
    page: filters.page,
    totalPages,
    isLoading,
    error,
    setPage,
    setFilters,
    filters,
    refetch: fetchArticles,
  }
}
