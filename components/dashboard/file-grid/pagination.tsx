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
                paginationInfo.page <= 1 ? 'pointer-events-none opacity-50' : ''
              }
            />
          </PaginationItem>
          {Array.from({ length: paginationInfo.pageCount }).map((_, i) => {
            const pageNumber = i + 1
            // Show first page, last page, and 2 pages around current page
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
              // Show ellipsis only when there's a gap
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
  )
}

// Add skeleton pagination component
export function PaginationSkeleton() {
  return (
    <div className="flex justify-center mt-8">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
      </div>
    </div>
  )
}
