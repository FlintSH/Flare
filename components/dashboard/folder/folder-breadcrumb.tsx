'use client'

import type { FolderBreadcrumbItem } from '@/types/components/folder'
import { ChevronRight, Home } from 'lucide-react'

import { cn } from '@/lib/utils'

interface FolderBreadcrumbProps {
  items: FolderBreadcrumbItem[]
  onNavigate: (folderId: string | null) => void
}

export function FolderBreadcrumb({ items, onNavigate }: FolderBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
        <span>All files</span>
      </button>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <div key={item.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                isLast
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {item.name}
            </button>
          </div>
        )
      })}
    </nav>
  )
}
