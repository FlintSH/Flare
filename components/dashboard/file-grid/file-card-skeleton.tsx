import {
  fileCardActivityClassName,
  fileCardDetailsClassName,
  fileCardLabelsClassName,
  fileCardNameRowClassName,
  fileCardPreviewClassName,
} from '@/components/dashboard/file-card/layout'

export function FileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-auto flex-col overflow-hidden rounded-xl border border-border/60 bg-panel shadow-sm"
    >
      <div className={fileCardNameRowClassName}>
        <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-10 animate-pulse rounded bg-muted" />
      </div>
      <div
        className={`${fileCardPreviewClassName} shrink-0 animate-pulse bg-muted/50`}
      />
      <div className={fileCardDetailsClassName}>
        <div className={fileCardLabelsClassName}>
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        </div>
        <div className={`${fileCardActivityClassName} justify-end`}>
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
