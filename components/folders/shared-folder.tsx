'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Folder,
  FolderOpen,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react'

import { FileTypeIcon } from '@/components/file/file-type-icon'
import { SealedThumbnail } from '@/components/file/sealed-thumbnail'
import { Button } from '@/components/ui/button'

import type { OpenedFile } from '@/lib/e2ee/client/files'
import {
  type OpenedFolder,
  openChildFolder,
  openFolderFile,
  openFolderWithKey,
} from '@/lib/e2ee/client/folders'
import { isE2eeError } from '@/lib/e2ee/errors'
import { parseFolderFragment } from '@/lib/e2ee/link'
import { normalizedType, safeFileName } from '@/lib/files/safe-render'
import { sharedFolderUrl } from '@/lib/files/urls'
import type {
  SharedFolderFile,
  SharedFolderListing,
  SharedFolderNode,
} from '@/lib/folders/shared'
import { nameKey } from '@/lib/library/names'
import { cn, formatFileSize } from '@/lib/utils'

/**
 * A shared folder page (docs/e2ee-spec.md, section 9.4.3). The server sends
 * the list. For a folder that has keys, this browser opens the names and
 * the file keys with the folder private key that the link carries after
 * `#`, and walks down to a folder below with the parent stanzas. That key
 * never leaves the browser.
 *
 * Plain files and encrypted files share one list. A plain file needs no
 * key and always shows. An encrypted file shows only when the key opens it.
 */

type KeyProblem =
  /** The link has no part after `#`. */
  | 'missing'
  /** The part after `#` is not a key, or not the key of this folder. */
  | 'wrong'
  /** A link of a later protocol version. */
  | 'update'
  /** The owner's browser has not finished the keys of this folder. */
  | 'pending'

type Opened =
  | { status: 'plain' }
  | { status: 'opening' }
  | { status: 'problem'; problem: KeyProblem }
  | { status: 'open'; trail: OpenedFolder[] }

const PROBLEMS: Record<KeyProblem, { title: string; text: string }> = {
  missing: {
    title: 'This link is missing its key',
    text: 'The part of the link after # opens this folder, and it is not here. Ask the person who shared the folder for the full link.',
  },
  wrong: {
    title: 'This link does not open this folder',
    text: 'The key in this link is not the key of this folder. The link may have been cut, or the owner made a new link. Ask for the current link.',
  },
  update: {
    title: 'This link needs a newer version of Flare',
    text: 'The link was made by a newer version. Ask the person who runs this site to update it.',
  },
  pending: {
    title: 'This folder is not ready yet',
    text: 'Its owner changed this folder and their browser has not finished updating its keys. Try again later.',
  },
}

function openTrail(listing: SharedFolderListing, fragment: string): Opened {
  if (!listing.root.keys) return { status: 'plain' }
  const parsed = parseFolderFragment(fragment)
  if (parsed.kind === 'missing')
    return { status: 'problem', problem: 'missing' }
  if (parsed.kind === 'unknown_version')
    return { status: 'problem', problem: 'update' }
  if (parsed.kind === 'malformed')
    return { status: 'problem', problem: 'wrong' }
  try {
    const trail = [
      openFolderWithKey(listing.root.keys, parsed.folderPrivateKey),
    ]
    for (const next of listing.trail.slice(1)) {
      if (!next.keys?.parentFolderStanza)
        return { status: 'problem', problem: 'pending' }
      trail.push(openChildFolder(trail[trail.length - 1], next.keys))
    }
    return { status: 'open', trail }
  } catch (error) {
    return {
      status: 'problem',
      problem:
        isE2eeError(error) && error.reason === 'unknown_version'
          ? 'update'
          : 'wrong',
    }
  }
}

interface Tile {
  id: string
  name: string
  href: string
  /** A plain image's address, shown as its preview. */
  image: string | null
  icon: { name: string; mimeType: string } | null
  hasPassword: boolean
  size: number | null
  /** An encrypted file this browser has the key of. */
  opened: OpenedFile | null
}

function fileTiles(
  files: readonly SharedFolderFile[],
  folder: OpenedFolder | null
): Tile[] {
  return files.flatMap((file): Tile[] => {
    if (!file.encrypted)
      return [
        {
          id: file.id,
          name: file.name,
          href: file.href,
          image: file.mimeType?.startsWith('image/') ? file.rawUrl : null,
          icon: { name: file.name, mimeType: file.mimeType ?? '' },
          hasPassword: file.hasPassword,
          size: file.size,
          opened: null,
        },
      ]
    if (!folder) return []
    try {
      const result = openFolderFile(folder, file)
      if (result.kind === 'password')
        return [
          {
            id: file.id,
            name: 'Password-protected file',
            href: `${file.href}#${result.fragment}`,
            image: null,
            icon: null,
            hasPassword: true,
            size: null,
            opened: null,
          },
        ]
      const name = safeFileName(result.opened.name)
      return [
        {
          id: file.id,
          name,
          href: `${file.href}#${result.fragment}`,
          image: null,
          icon: { name, mimeType: result.opened.type },
          hasPassword: false,
          size: file.size,
          opened: result.opened,
        },
      ]
    } catch {
      // A stanza that this key does not open: the file is not shown.
      return []
    }
  })
}

function childFolders(
  folders: readonly SharedFolderNode[],
  parent: OpenedFolder | null
): { id: string; name: string }[] {
  return folders
    .flatMap((folder) => {
      if (!folder.keys) return [{ id: folder.id, name: folder.name ?? '' }]
      if (!parent || !folder.keys.parentFolderStanza) return []
      try {
        return [
          { id: folder.id, name: openChildFolder(parent, folder.keys).name },
        ]
      } catch {
        return []
      }
    })
    .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)))
}

const tileClassName =
  'group flex h-full flex-col overflow-hidden rounded-xl border bg-muted/30 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const iconClassName =
  'h-8 w-8 text-muted-foreground min-[480px]:h-10 min-[480px]:w-10'

export function SharedFolder({
  listing,
  showFilename,
  showSize,
}: {
  listing: SharedFolderListing
  showFilename: boolean
  showSize: boolean
}) {
  // The part after `#` exists only in the browser. Until this has read it,
  // a folder that has keys shows as opening.
  const [fragment, setFragment] = useState<string | null>(null)
  useEffect(() => {
    const read = () => setFragment(window.location.hash)
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  const opened = useMemo<Opened>(
    () =>
      !listing.root.keys
        ? { status: 'plain' }
        : fragment === null
          ? { status: 'opening' }
          : openTrail(listing, fragment),
    [listing, fragment]
  )
  const openFolder =
    opened.status === 'open' ? opened.trail[opened.trail.length - 1] : null
  const tiles = useMemo(
    () => fileTiles(listing.files, openFolder),
    [listing.files, openFolder]
  )
  const folders = useMemo(
    () =>
      opened.status === 'opening'
        ? []
        : childFolders(listing.folders, openFolder),
    [listing.folders, openFolder, opened.status]
  )

  const here = listing.trail[listing.trail.length - 1]
  const names = listing.trail.map((entry, index) =>
    opened.status === 'open'
      ? opened.trail[index].name
      : (entry.name ?? 'Shared folder')
  )
  const hash = fragment ?? ''
  const address = (folder: SharedFolderNode, page = 1) =>
    `${sharedFolderUrl(listing.token, {
      page,
      folder: folder.id === listing.root.id ? null : folder.id,
    })}${hash}`
  const problem = opened.status === 'problem' ? PROBLEMS[opened.problem] : null
  // What the key did not open is not counted: the visitor cannot see it.
  const hidden = listing.files.length - tiles.length
  const total = listing.total - hidden

  let body: ReactNode
  if (opened.status === 'opening')
    body = (
      <p
        role="status"
        className="px-6 py-20 text-center text-sm text-muted-foreground"
      >
        Opening folder…
      </p>
    )
  else if (!tiles.length && !folders.length && !problem)
    body = (
      <div className="px-6 py-20 text-center">
        <FolderOpen
          className="mx-auto mb-4 h-10 w-10 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="font-medium">No shared files yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Files will appear here when they’re ready to share.
        </p>
      </div>
    )
  else
    body = (
      <>
        {folders.length > 0 && (
          <ul
            aria-label="Folders"
            className="grid grid-cols-1 gap-3 px-6 pt-6 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          >
            {folders.map((folder) => (
              <li key={folder.id} className="min-w-0">
                <Link
                  href={address({ id: folder.id, name: null, keys: null })}
                  prefetch={false}
                  data-shared-subfolder=""
                  className="group flex items-center gap-3 rounded-xl border bg-muted/30 px-3.5 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Folder
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {tiles.length > 0 && (
          <ul
            aria-label="Files"
            className="grid grid-cols-1 gap-4 p-6 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          >
            {tiles.map((file) => {
              const type = file.opened ? normalizedType(file.opened.type) : ''
              const preview =
                Boolean(file.image) ||
                type.startsWith('image/') ||
                type.startsWith('video/')
              return (
                <li key={file.id} className="min-w-0">
                  <a
                    href={file.href}
                    data-shared-file={file.id}
                    className={tileClassName}
                  >
                    {/* Previews keep one shape where tiles share a row; a
                        lone icon gets a short band on single-column phones. */}
                    <div
                      className={cn(
                        'relative flex items-center justify-center overflow-hidden border-b',
                        preview
                          ? 'aspect-[4/3] bg-muted/50'
                          : 'h-24 bg-muted min-[480px]:aspect-[4/3] min-[480px]:h-auto dark:bg-muted/80'
                      )}
                    >
                      {file.image ? (
                        // Raw routes apply file access checks again if visibility changes.
                        <img
                          src={file.image}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : file.hasPassword ? (
                        <Lock className={iconClassName} aria-hidden="true" />
                      ) : file.opened && preview ? (
                        <SealedThumbnail
                          fileId={file.id}
                          opened={file.opened}
                          className="h-full w-full object-cover"
                          fallback={
                            <FileTypeIcon
                              file={file.icon!}
                              className={iconClassName}
                            />
                          }
                        />
                      ) : (
                        <FileTypeIcon
                          file={file.icon ?? { name: '', mimeType: '' }}
                          className={iconClassName}
                        />
                      )}
                    </div>
                    <div className="space-y-1.5 p-3.5">
                      <h2
                        className="truncate text-sm font-medium"
                        title={showFilename ? file.name : undefined}
                      >
                        {showFilename || file.hasPassword
                          ? file.name
                          : 'Shared file'}
                      </h2>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {file.hasPassword ? (
                          <>
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Password required
                          </>
                        ) : showSize && file.size !== null ? (
                          formatFileSize(file.size)
                        ) : (
                          'Open file'
                        )}
                        <ArrowRight
                          className="ml-auto h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </p>
                    </div>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </>
    )

  return (
    <>
      <div className="flex items-start gap-4 border-b border-border/60 p-6 sm:gap-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-muted/30 text-foreground sm:h-14 sm:w-14">
          <FolderOpen className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">
            Shared folder
            {opened.status === 'open' && (
              <ShieldCheck
                className="h-3.5 w-3.5"
                aria-label="End-to-end encrypted"
              />
            )}
          </p>
          {listing.trail.length > 1 && (
            <nav
              aria-label="Folder path"
              className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
            >
              {listing.trail.slice(0, -1).map((entry, index) => (
                <span
                  key={entry.id}
                  className="flex min-w-0 items-center gap-1"
                >
                  <Link
                    href={address(entry)}
                    prefetch={false}
                    className="max-w-[12rem] truncate rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {names[index]}
                  </Link>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                </span>
              ))}
            </nav>
          )}
          <h1
            className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"
            data-shared-folder-name=""
          >
            {names[names.length - 1]}
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            {opened.status === 'opening'
              ? 'Opening folder…'
              : problem && !total
                ? // A count of what the key did not open would read as an empty folder.
                  'This folder is encrypted.'
                : `${total} ${total === 1 ? 'file' : 'files'} · Open a file to preview or download it.`}
          </p>
        </div>
      </div>
      {problem && (
        <div
          role="alert"
          data-shared-folder-problem={
            opened.status === 'problem' ? opened.problem : undefined
          }
          className="flex items-start gap-3 border-b border-border/60 bg-muted/30 px-6 py-5"
        >
          <KeyRound
            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h2 className="text-sm font-medium">{problem.title}</h2>
            <p className="max-w-prose text-pretty text-sm text-muted-foreground">
              {problem.text}
              {tiles.length > 0 &&
                ' The files below are not encrypted, so they open without it.'}
            </p>
          </div>
        </div>
      )}
      {body}
      {listing.pageCount > 1 && (
        <nav
          aria-label="Shared folder pages"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4"
        >
          <p className="text-sm text-muted-foreground">
            Page {listing.page} of {listing.pageCount}
          </p>
          <div className="flex gap-2">
            {listing.page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={address(here, listing.page - 1)} prefetch={false}>
                  <ArrowLeft aria-hidden="true" />
                  Previous
                </Link>
              </Button>
            )}
            {listing.page < listing.pageCount && (
              <Button asChild size="sm" variant="outline">
                <Link href={address(here, listing.page + 1)} prefetch={false}>
                  Next
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </>
  )
}
