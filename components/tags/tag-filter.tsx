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

import { UNTAGGED } from '@/lib/library/contract'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

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
            'h-10 min-w-0 justify-start gap-2 rounded-lg bg-background/70 px-3 data-[state=open]:bg-accent sm:w-auto',
            value && 'border-primary bg-primary/10 [&_svg]:text-foreground'
          )}
        >
          <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="max-w-28 truncate">
            {value === UNTAGGED ? 'Untagged' : selected?.name || 'Tags'}
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
        {/* Rows match the toolbar's other lists (32px, check on the left).
            The height leaves half a row showing when the list scrolls. */}
        <div
          ref={scrollFadeRef}
          className="scroll-fade max-h-60 overflow-y-auto overscroll-contain"
          role="group"
          aria-label="Filter files by tag"
        >
          {[
            { id: null, name: 'All files' },
            { id: UNTAGGED, name: 'Untagged' },
            ...tags.filter((tag) =>
              tag.name.toLowerCase().includes(search.toLowerCase())
            ),
          ].map((tag) => (
            <button
              data-flare-control
              key={tag.id ?? 'all'}
              type="button"
              aria-pressed={value === tag.id}
              onClick={() => choose(tag.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
            {/* On the options' columns: icon over the checks, label over
                the names. */}
            <Button
              variant="ghost"
              className="h-8 w-full justify-start px-2 font-normal"
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
