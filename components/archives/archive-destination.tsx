'use client'

import { useState } from 'react'

import { Folder, Inbox } from 'lucide-react'

import {
  FolderOption,
  folderListClassName,
} from '@/components/folders/folder-option'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { folderPath } from '@/lib/folders/navigation'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

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
      {/* The same list as the Move dialog; its height leaves half a row
          showing when it scrolls. */}
      <div className="rounded-xl border p-1">
        <div
          role="group"
          aria-label="Destination folder"
          ref={scrollFadeRef}
          className={cn(folderListClassName, 'max-h-36')}
          aria-busy={loading}
        >
          <FolderOption
            icon={<Inbox aria-hidden="true" />}
            label="Unfiled"
            selected={value === null}
            onSelect={() => onChange(null)}
          />
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
                <FolderOption
                  key={folder.id}
                  icon={<Folder aria-hidden="true" />}
                  label={folder.path}
                  selected={value === folder.id}
                  onSelect={() => onChange(folder.id)}
                />
              ))
            ))}
          {allowFolders && search && !loading && !error && !matching.length && (
            <p className="p-3 text-sm text-muted-foreground">
              No matching folders.
            </p>
          )}
        </div>
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
