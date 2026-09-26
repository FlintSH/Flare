'use client'

import { useState } from 'react'

import { Check, Settings2, Tag } from 'lucide-react'

import { PermissionGate } from '@/components/roles/permission-gate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { cn } from '@/lib/utils'

import { useTags } from '@/hooks/use-tags'

export function TagFilter({
  value,
  onChange,
  onManage,
}: {
  value: string | null
  onChange: (value: string | null) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { tags, loading, error, reload } = useTags()
  const selected = tags.find((tag) => tag.id === value)
  const choose = (id: string | null) => {
    onChange(id)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label="Filter by tag"
          className={cn(
            'h-10 w-10 shrink-0 gap-2 rounded-lg bg-background/70 p-0 sm:w-auto sm:px-3',
            value && 'border-primary/40 bg-primary/5'
          )}
        >
          <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="hidden max-w-28 truncate sm:inline">
            {value === 'untagged' ? 'Untagged' : selected?.name || 'Tags'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <Input
          aria-label="Find a tag"
          placeholder="Find a tag…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mb-2 h-9"
        />
        <div
          className="max-h-64 overflow-y-auto"
          role="group"
          aria-label="Filter files by tag"
        >
          {[
            { id: null, name: 'All files' },
            { id: 'untagged', name: 'Untagged' },
            ...tags.filter((tag) =>
              tag.name.toLowerCase().includes(search.toLowerCase())
            ),
          ].map((tag) => (
            <button
              key={tag.id ?? 'all'}
              type="button"
              aria-pressed={value === tag.id}
              onClick={() => choose(tag.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Check
                className={cn(
                  'h-4 w-4 shrink-0',
                  value !== tag.id && 'invisible'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              {'fileCount' in tag && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tag.fileCount}
                </span>
              )}
            </button>
          ))}
          {loading && (
            <p className="p-2 text-sm text-muted-foreground">Loading tags…</p>
          )}
          {error && (
            <Button variant="ghost" onClick={() => void reload()}>
              Retry loading tags
            </Button>
          )}
          {!loading && !error && tags.length === 0 && (
            <p className="px-3 py-3 text-xs leading-5 text-muted-foreground">
              A little order, all in one place. Create a tag to group related
              files.
            </p>
          )}
          {search &&
            !tags.some((tag) =>
              tag.name.toLowerCase().includes(search.toLowerCase())
            ) && (
              <p className="p-2 text-sm text-muted-foreground">
                No matching tags.
              </p>
            )}
        </div>
        <div className="mt-2 border-t pt-2">
          <PermissionGate permission="tags.manage">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false)
                onManage()
              }}
            >
              <Settings2 className="h-4 w-4" />
              {tags.length ? 'Manage tags' : 'Create your first tag'}
            </Button>
          </PermissionGate>
        </div>
      </PopoverContent>
    </Popover>
  )
}
