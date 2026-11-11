export function FileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-border/60 bg-panel shadow-sm"
    >
      <div className="aspect-[4/3] animate-pulse bg-muted/50" />
      <div className="border-t border-border/40 p-2.5 sm:p-3">
        <div className="flex h-[38px] items-center justify-between sm:h-5 gap-3">
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
