'use client'

import { useState } from 'react'
import { ExternalLink, Trash2, Calendar, Newspaper } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Article } from '@/hooks/use-articles'

interface ArticleListItemProps {
  article: Article
  isAdmin: boolean
  onDelete: (id: string, title: string) => void
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function ArticleListItem({
  article,
  isAdmin,
  onDelete,
}: ArticleListItemProps) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="flex items-start gap-3 p-3 border-b last:border-b-0 hover:bg-ids-offwhite transition-colors group">
      {/* Thumbnail */}
      <div className="shrink-0 w-[60px] h-[60px] rounded-md overflow-hidden bg-ids-ice flex items-center justify-center">
        {article.image_url && !imgError ? (
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <Newspaper className="h-5 w-5 text-ids-grey" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3
          className="text-sm font-bold text-ids-dark leading-snug line-clamp-1"
          title={article.title}
        >
          {article.title}
        </h3>
        {article.description && (
          <p className="text-xs text-ids-slate leading-relaxed line-clamp-2 mt-0.5">
            {article.description}
          </p>
        )}
        {article.published_at && (
          <span className="text-[11px] text-ids-grey flex items-center gap-1 mt-1">
            <Calendar className="h-3 w-3" />
            {formatDate(article.published_at)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-ids-slate hover:text-ids-navy"
          asChild
        >
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Originalseite oeffnen: ${article.title}`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-ids-grey hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(article.id, article.title)}
            aria-label={`Artikel loeschen: ${article.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
