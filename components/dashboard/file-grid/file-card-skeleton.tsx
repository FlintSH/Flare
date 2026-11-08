import {
  fileCardActivityClassName,
  fileCardDetailsClassName,
  fileCardLabelsClassName,
  fileCardNameRowClassName,
  fileCardPreviewClassName,
  fileListClassName,
  fileListFactsClassName,
  fileListLabelsClassName,
  fileListManageClassName,
  fileListNameClassName,
} from '@/components/dashboard/file-card/layout'

import type { LibraryView } from '@/lib/library/view'

export function FileCardSkeleton({ view = 'gallery' }: { view?: LibraryView }) {
  if (view === 'list')
    return (
      <div
        aria-hidden="true"
        data-file-skeleton=""
        data-file-view="list"
        className={`${fileListClassName} overflow-hidden rounded-xl border border-border/60 bg-panel shadow-sm`}
      >
        <div className="col-start-1 row-start-1 h-[64px] w-[64px] animate-pulse rounded-md bg-muted/50" />
        <div className={fileListNameClassName}>
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
        <div className={fileListFactsClassName}>
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
        <div className={fileListLabelsClassName}>
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
        <div className={fileListManageClassName}>
          <div className="h-[44px] w-[44px] animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    )
  return (
    <div
      aria-hidden="true"
      data-file-skeleton=""
      data-file-view="gallery"
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
