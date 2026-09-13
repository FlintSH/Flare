import { useEffect, useState } from 'react'

import { PaginationInfo } from '@/types/components/file'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface FileGridPaginationProps {
  paginationInfo: PaginationInfo
  setPage: (page: number) => void
}

export function FileGridPagination({
  paginationInfo: { page, pageCount },
  setPage,
}: FileGridPaginationProps) {
  const [pageInput, setPageInput] = useState(String(page))
  const [openJump, setOpenJump] = useState<number | null>(null)
  useEffect(() => setPageInput(String(page)), [page])
  if (pageCount <= 1) return null

  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b)

  return (
    <nav
      aria-label="File library pages"
      className="mx-auto flex w-fit max-w-full items-center gap-0.5 rounded-xl border border-border/60 bg-background/70 p-1 shadow-sm backdrop-blur-xl sm:gap-1 sm:p-2"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 px-0 sm:h-8 sm:w-auto sm:px-2"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">Previous</span>
      </Button>
      {pages.map((value, index) => (
        <div key={value} className="flex items-center gap-0.5 sm:gap-1">
          {index > 0 && value - pages[index - 1] > 1 && (
            <Popover
              open={openJump === index}
              onOpenChange={(open) => {
                setOpenJump(open ? index : null)
                if (open) setPageInput(String(page))
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  aria-label="Jump to page"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-3">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const requested = Number(pageInput)
                    if (
                      Number.isInteger(requested) &&
                      requested >= 1 &&
                      requested <= pageCount
                    ) {
                      setPage(requested)
                      setOpenJump(null)
                    }
                  }}
                >
                  <label htmlFor={`file-page-${index}`} className="text-sm">
                    Page
                  </label>
                  <Input
                    id={`file-page-${index}`}
                    type="number"
                    min={1}
                    max={pageCount}
                    required
                    step={1}
                    value={pageInput}
                    onChange={(event) => setPageInput(event.target.value)}
                    className="h-8 w-16"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8"
                    aria-label="Go to page"
                  >
                    Go
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant={value === page ? 'outline' : 'ghost'}
            size="icon"
            className="h-7 w-7 text-xs sm:h-8 sm:w-8 sm:text-sm"
            aria-current={value === page ? 'page' : undefined}
            aria-label={`Page ${value}`}
            onClick={() => setPage(value)}
          >
            {value}
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 px-0 sm:h-8 sm:w-auto sm:px-2"
        disabled={page >= pageCount}
        onClick={() => setPage(page + 1)}
        aria-label="Next page"
      >
        <span className="mr-1 hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  )
}

export function PaginationSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-[50px] w-64 animate-pulse rounded-xl border border-border/60 bg-background/70"
    />
  )
}
