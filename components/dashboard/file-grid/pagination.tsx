import React from 'react'

import { PaginationInfo } from '@/types/components/file'

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

interface FileGridPaginationProps {
  paginationInfo: PaginationInfo
  setPage: (page: number) => void
}

export function FileGridPagination({
  paginationInfo,
  setPage,
}: FileGridPaginationProps) {
  if (paginationInfo.pageCount <= 1) {
    return null
  }

  return (
    <div className="flex justify-center mt-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/3 via-transparent to-accent/3 rounded-xl" />
        <div className="relative bg-background/40 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2 shadow-lg shadow-black/5">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    if (paginationInfo.page > 1) {
                      setPage(paginationInfo.page - 1)
                    }
                  }}
                  className={
                    paginationInfo.page <= 1
                      ? 'pointer-events-none opacity-50'
                      : ''
                  }
                />
              </PaginationItem>
              {Array.from({ length: paginationInfo.pageCount }).map((_, i) => {
                const pageNumber = i + 1
                if (
                  pageNumber === 1 ||
                  pageNumber === paginationInfo.pageCount ||
                  (pageNumber >= paginationInfo.page - 2 &&
                    pageNumber <= paginationInfo.page + 2)
                ) {
                  return (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          setPage(pageNumber)
                        }}
                        isActive={pageNumber === paginationInfo.page}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  )
                } else if (
                  (pageNumber === 2 && paginationInfo.page - 2 > 2) ||
                  (pageNumber === paginationInfo.pageCount - 1 &&
                    paginationInfo.page + 2 < paginationInfo.pageCount - 1)
                ) {
                  return (
                    <PaginationItem key={pageNumber}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )
                }
                return null
              })}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    if (paginationInfo.page < paginationInfo.pageCount) {
                      setPage(paginationInfo.page + 1)
                    }
                  }}
                  className={
                    paginationInfo.page >= paginationInfo.pageCount
                      ? 'pointer-events-none opacity-50'
                      : ''
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
    </div>
  )
}

export function PaginationSkeleton() {
  return (
    <div className="flex justify-center mt-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/3 via-transparent to-accent/3 rounded-xl" />
        <div className="relative bg-background/40 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-9 w-9 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-9 w-9 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-9 w-9 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-9 w-9 rounded-md bg-muted/60 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}
