export interface Source {
  id: string
  name: string
  url: string
  type: 'rss' | 'html'
  language: string
  interval_minutes: number
  is_active: boolean
  slug: string | null
  default_category_id: string | null
  default_category: { id: string; name: string } | null
  retention_days: number | null
  selector_container: string | null
  selector_title: string | null
  selector_link: string | null
  selector_description: string | null
  selector_date: string | null
  selector_category: string | null
  scraping_in_progress: boolean
  last_scraped_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface SourcesResponse {
  sources: Source[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface Category {
  id: string
  name: string
}
