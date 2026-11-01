export function FileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-border/60 bg-background/70 shadow-sm"
    >
      <div className="aspect-square animate-pulse bg-muted/50" />
      <div className="border-t border-border/40 p-3">
        <div className="flex h-5 items-center justify-between gap-3">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-10 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-1 flex h-5 items-center justify-end">
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
