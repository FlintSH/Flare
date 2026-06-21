'use client'

import { useMemo, useState } from 'react'

import { Check, Plus, Tag as TagIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

import type { Tag } from '@/types/components/tag'

interface TagPickerProps {
  tags: Tag[]
  selectedIds: string[]
  onToggle: (tagId: string) => void
  onCreate?: (name: string) => Promise<Tag | null>
  trigger?: React.ReactNode
  align?: 'start' | 'center' | 'end'
}

export function TagPicker({
  tags,
  selectedIds,
  onToggle,
  onCreate,
  trigger,
  align = 'start',
}: TagPickerProps) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const exactMatch = tags.some(
    (t) => t.name.toLowerCase() === search.trim().toLowerCase()
  )
  const canCreate = Boolean(onCreate) && search.trim().length > 0 && !exactMatch

  const handleCreate = async () => {
    if (!onCreate) return
    setCreating(true)
    const created = await onCreate(search.trim())
    setCreating(false)
    if (created) {
      onToggle(created.id)
      setSearch('')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <TagIcon className="h-4 w-4" />
            Tags
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <div className="p-2 border-b border-border/50">
          <Input
            autoFocus
            placeholder="Search or create..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault()
                handleCreate()
              }
            }}
            className="h-8"
          />
        </div>
        <div className="max-h-[240px] overflow-y-auto p-1">
          {filtered.map((tag) => {
            const selected = selectedIds.includes(tag.id)
            const classes = getColorClasses(tag.color)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggle(tag.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                  selected && 'bg-accent/60'
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn('h-2.5 w-2.5 rounded-full shrink-0', classes.dot)}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No tags found
            </p>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Create &ldquo;{search.trim()}&rdquo;
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
