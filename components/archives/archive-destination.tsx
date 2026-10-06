'use client'

import { useState } from 'react'

import { Check, Folder, Inbox } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { folderPath } from '@/lib/folders/navigation'
import { cn } from '@/lib/utils'

import { useFolders } from '@/hooks/use-folders'

export function ArchiveDestination({
  value,
  onChange,
  disabled,
  allowFolders,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled: boolean
  allowFolders: boolean
}) {
  const { folders, loading, error, reload } = useFolders()
  const [search, setSearch] = useState('')
  const matching = folders
    .map((folder) => ({ ...folder, path: folderPath(folders, folder.id) }))
    .filter((folder) =>
      folder.path.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.path.localeCompare(b.path))

  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">Save to</legend>
      {allowFolders && folders.length > 4 && (
        <Input
          aria-label="Find a destination folder"
          placeholder="Find a folder…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <div
        role="group"
        aria-label="Destination folder"
        className="max-h-36 overflow-y-auto rounded-xl border p-1"
        aria-busy={loading}
      >
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            value === null && 'bg-primary/10 text-primary'
          )}
        >
          <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Unfiled</span>
          {value === null && <Check className="h-4 w-4" aria-hidden="true" />}
        </button>
        {allowFolders &&
          (loading ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              Loading folders…
            </p>
          ) : error ? (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => void reload()}
            >
              Retry loading folders
            </Button>
          ) : (
            matching.map((folder) => (
              <button
                key={folder.id}
                type="button"
                aria-pressed={value === folder.id}
                onClick={() => onChange(folder.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                  value === folder.id && 'bg-primary/10 text-primary'
                )}
              >
                <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">
                  {folder.path}
                </span>
                {value === folder.id && (
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
              </button>
            ))
          ))}
        {allowFolders && search && !loading && !error && !matching.length && (
          <p className="p-3 text-sm text-muted-foreground">
            No matching folders.
          </p>
        )}
      </div>
      {!allowFolders && (
        <p className="text-xs text-muted-foreground">
          You can save to Unfiled. Saving inside a folder requires permission to
          manage folders.
        </p>
      )}
      {value &&
        !loading &&
        !error &&
        !folders.some((folder) => folder.id === value) && (
          <p role="alert" className="text-sm text-destructive">
            This folder is no longer available. Choose another destination.
          </p>
        )}
    </fieldset>
  )
}
