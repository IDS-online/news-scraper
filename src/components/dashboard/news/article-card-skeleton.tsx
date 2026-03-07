'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface ArticleCardSkeletonProps {
  variant?: 'list' | 'grid'
}

export default function ArticleCardSkeleton({ variant = 'list' }: ArticleCardSkeletonProps) {
  if (variant === 'grid') {
    return (
      <Card className="border-ids-light bg-white overflow-hidden">
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
    )
  }

  return (
    <Card className="border-ids-light bg-white">
      <CardContent className="p-4">
        <div className="flex gap-3">
          {/* Thumbnail skeleton */}
          <Skeleton className="h-[60px] w-[60px] rounded-md shrink-0" />
          <div className="flex flex-col gap-2 flex-1">
            {/* Badges row */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-10 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full ml-auto" />
            </div>
            {/* Title */}
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            {/* Description */}
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
