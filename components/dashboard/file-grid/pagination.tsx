import { useEffect, useState } from 'react'

import { PaginationInfo } from '@/types/components/file'
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FileGridPaginationProps {
  paginationInfo: PaginationInfo
  setPage: (page: number) => void
}

export function FileGridPagination({
  paginationInfo: { page, pageCount },
  setPage,
}: FileGridPaginationProps) {
  const [pageInput, setPageInput] = useState(String(page))
  useEffect(() => setPageInput(String(page)), [page])
  if (pageCount <= 1) return null

  return (
    <nav
      aria-label="File library pages"
      className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border bg-card p-3 sm:justify-between sm:px-5"
    >
      <form
        className="flex items-center gap-2 text-sm text-muted-foreground"
        onSubmit={(event) => {
          event.preventDefault()
          const requestedPage = Number(pageInput)
          if (
            Number.isInteger(requestedPage) &&
            requestedPage >= 1 &&
            requestedPage <= pageCount
          )
            setPage(requestedPage)
        }}
      >
        <label htmlFor="file-library-page">Page</label>
        <Input
          id="file-library-page"
          type="number"
          min={1}
          max={pageCount}
          step={1}
          required
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPageInput(String(page))
          }}
          className="h-9 w-16 rounded-lg text-center"
        />
        <span>of {pageCount.toLocaleString()}</span>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="rounded-lg"
          aria-label="Go to page"
        >
          Go
        </Button>
      </form>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => setPage(1)}
          className="h-9 w-9 rounded-lg"
        >
          <ChevronFirst className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          className="rounded-lg"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => setPage(page + 1)}
          className="rounded-lg"
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Last page"
          disabled={page >= pageCount}
          onClick={() => setPage(pageCount)}
          className="h-9 w-9 rounded-lg"
        >
          <ChevronLast className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  )
}

export function PaginationSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-[62px] animate-pulse rounded-2xl border bg-card"
    />
  )
}
