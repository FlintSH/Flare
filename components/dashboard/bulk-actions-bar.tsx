'use client'

import type { Tag } from '@/types/components/tag'
import { Download, FolderInput, Tag as TagIcon, Trash2, X } from 'lucide-react'

import { TagPicker } from '@/components/dashboard/tag/tag-picker'
import { Button } from '@/components/ui/button'

interface BulkActionsBarProps {
  count: number
  tags: Tag[]
  onClear: () => void
  onMove: () => void
  onAddTags: (tagIds: string[]) => void
  onCreateTag: (name: string) => Promise<Tag | null>
  onDownload: () => void
  onDelete: () => void
}

export function BulkActionsBar({
  count,
  tags,
  onClear,
  onMove,
  onAddTags,
  onCreateTag,
  onDownload,
  onDelete,
}: BulkActionsBarProps) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-8 left-0 right-0 flex justify-center z-50 px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 bg-background/90 backdrop-blur-md border rounded-full shadow-lg">
        <div className="flex items-center gap-2 pl-1 pr-2">
          <span className="flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            {count}
          </span>
          <span className="text-sm font-medium hidden sm:inline">selected</span>
        </div>

        <div className="h-5 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onMove}
          className="rounded-full gap-1.5"
        >
          <FolderInput className="h-4 w-4" />
          <span className="hidden sm:inline">Move</span>
        </Button>

        <TagPicker
          tags={tags}
          selectedIds={[]}
          onToggle={(tagId) => onAddTags([tagId])}
          onCreate={onCreateTag}
          align="center"
          trigger={
            <Button variant="ghost" size="sm" className="rounded-full gap-1.5">
              <TagIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Tag</span>
            </Button>
          }
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={onDownload}
          className="rounded-full gap-1.5"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Download</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="rounded-full gap-1.5 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">Delete</span>
        </Button>

        <div className="h-5 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="rounded-full h-8 w-8"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
