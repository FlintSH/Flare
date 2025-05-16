import React from 'react'

export function FileCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow">
      {/* Preview Section */}
      <div className="relative">
        <div className="relative aspect-square bg-muted animate-pulse rounded-t-xl overflow-hidden" />

        {/* Skeleton overlay for actions */}
        <div className="absolute inset-0 bg-black/50 opacity-0 transition-opacity flex flex-col items-center justify-center gap-3">
          <div className="h-8 w-16 bg-muted/20 rounded animate-pulse" />
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-8 w-8 bg-muted/20 rounded animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Status badge skeleton */}
        <div className="absolute bottom-2 left-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm">
            <div className="h-3 w-3 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="h-3 w-12 bg-muted-foreground/20 rounded animate-pulse" />
          </div>
        </div>

        {/* Upload time badge skeleton */}
        <div className="absolute bottom-2 right-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm">
            <div className="h-3 w-3 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="h-3 w-8 bg-muted-foreground/20 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* File info section skeleton */}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="h-[18px] w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-[18px] w-12 bg-muted rounded animate-pulse" />
        </div>
      </div>
    </div>
  )
}
