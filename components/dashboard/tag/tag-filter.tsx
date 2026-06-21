'use client'

import { Check, Settings2, Tag as TagIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

import type { Tag } from '@/types/components/tag'

interface TagFilterProps {
  tags: Tag[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onManage?: () => void
}

export function TagFilter({
  tags,
  selectedIds,
  onChange,
  onManage,
}: TagFilterProps) {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((t) => t !== id)
        : [...selectedIds, id]
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[120px] flex items-center justify-between bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
        >
          <span>Tags</span>
          {selectedIds.length > 0 ? (
            <span className="ml-2 rounded-full bg-primary w-5 h-5 flex items-center justify-center text-[10px] font-medium text-primary-foreground">
              {selectedIds.length}
            </span>
          ) : (
            <TagIcon className="ml-2 h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 max-h-[400px] overflow-y-auto"
      >
        <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
        {tags.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No tags yet
          </div>
        )}
        {tags.map((tag) => {
          const classes = getColorClasses(tag.color)
          const selected = selectedIds.includes(tag.id)
          return (
            <DropdownMenuItem
              key={tag.id}
              onClick={() => toggle(tag.id)}
              onSelect={(e) => e.preventDefault()}
              className={cn(
                'flex items-center justify-between',
                selected && 'bg-accent'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', classes.dot)} />
                <span className="truncate">{tag.name}</span>
                <span className="text-xs text-muted-foreground">
                  {tag.fileCount}
                </span>
              </div>
              {selected && <Check className="ml-2 h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          )
        })}
        {onManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage}>
              <Settings2 className="mr-2 h-4 w-4" />
              Manage tags
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
