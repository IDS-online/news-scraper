'use client'

import { useState } from 'react'
import { ExternalLink, Trash2, Calendar, Newspaper } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Article } from '@/hooks/use-articles'

interface ArticleGridCardProps {
  article: Article
  isAdmin: boolean
  onDelete?: (id: string, title: string) => void
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

export default function ArticleGridCard({
  article,
  isAdmin,
  onDelete,
}: ArticleGridCardProps) {
  const [imgError, setImgError] = useState(false)

  return (
    <Card className="group overflow-hidden border-ids-light bg-white hover:shadow-md transition-shadow flex flex-col">
      {/* Image area - dominant element (aspect-ratio 16:9) */}
      <div className="relative aspect-video bg-ids-ice flex items-center justify-center overflow-hidden">
        {article.image_url && !imgError ? (
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-ids-grey">
            <Newspaper className="h-8 w-8" />
            {article.source_name && (
              <span className="text-xs font-medium">{article.source_name}</span>
            )}
          </div>
        )}

        {/* Admin delete overlay */}
        {isAdmin && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 bg-white/80 hover:bg-destructive hover:text-white opacity-0 group-hover:opacity-100 transition-all shadow-sm"
            onClick={() => onDelete?.(article.id, article.title)}
            aria-label={`Artikel loeschen: ${article.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1">
        <h3
          className="text-sm font-bold text-ids-dark leading-snug line-clamp-2"
          title={article.title}
        >
          {article.title}
        </h3>

        {article.description && (
          <p className="text-xs text-ids-slate leading-relaxed line-clamp-3 mt-1 flex-1">
            {article.description}
          </p>
        )}

        {/* Footer: date + link */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-ids-light">
          {article.published_at && (
            <span className="text-[11px] text-ids-grey flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(article.published_at)}
            </span>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-ids-slate hover:text-ids-navy font-medium transition-colors"
            aria-label={`Originalseite oeffnen: ${article.title}`}
          >
            Lesen
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </Card>
  )
}
