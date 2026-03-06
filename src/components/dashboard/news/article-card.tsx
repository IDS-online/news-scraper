'use client'

import { ExternalLink, Globe, Calendar } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Article } from '@/hooks/use-articles'

interface ArticleCardProps {
  article: Article
}

/** Map language codes to display labels */
const LANGUAGE_LABELS: Record<string, string> = {
  de: 'DE',
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  pt: 'PT',
  nl: 'NL',
  pl: 'PL',
  ru: 'RU',
  ja: 'JA',
  zh: 'ZH',
  ko: 'KO',
  ar: 'AR',
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

function getRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Gerade eben'
    if (diffMins < 60) return `vor ${diffMins} Min.`
    if (diffHours < 24) return `vor ${diffHours} Std.`
    if (diffDays < 7) return `vor ${diffDays} ${diffDays === 1 ? 'Tag' : 'Tagen'}`
    return formatDate(dateStr)
  } catch {
    return ''
  }
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const languageLabel = article.language
    ? LANGUAGE_LABELS[article.language.toLowerCase()] ?? article.language.toUpperCase()
    : null

  return (
    <Card className="group transition-shadow hover:shadow-md border-ids-light bg-white">
      <CardContent className="p-4">
        <div className="flex flex-col gap-2">
          {/* Top row: source + language + category + time */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {article.source_name && (
              <Badge
                variant="secondary"
                className="bg-ids-ice text-ids-navy font-semibold text-[11px] px-2 py-0.5"
              >
                {article.source_name}
              </Badge>
            )}
            {languageLabel && (
              <Badge
                variant="outline"
                className="text-ids-slate border-ids-light text-[11px] px-1.5 py-0.5 gap-1"
              >
                <Globe className="h-3 w-3" />
                {languageLabel}
              </Badge>
            )}
            {article.category_name && (
              <Badge
                className="bg-ids-orange/15 text-ids-dark border-ids-orange/30 border text-[11px] px-2 py-0.5 font-medium"
              >
                {article.category_name}
              </Badge>
            )}
            {article.published_at && (
              <span className="text-ids-grey ml-auto flex items-center gap-1 shrink-0">
                <Calendar className="h-3 w-3" />
                <span title={formatDate(article.published_at)}>
                  {getRelativeTime(article.published_at)}
                </span>
              </span>
            )}
          </div>

          {/* Title */}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group/link flex items-start gap-2"
            aria-label={`Artikel lesen: ${article.title}`}
          >
            <h3 className="text-sm font-bold text-ids-dark leading-snug line-clamp-2 group-hover/link:text-ids-navy transition-colors">
              {article.title}
            </h3>
            <ExternalLink className="h-3.5 w-3.5 text-ids-grey shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
          </a>

          {/* Description */}
          {article.description && (
            <p className="text-xs text-ids-slate leading-relaxed line-clamp-2">
              {article.description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
