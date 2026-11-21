import type { Prisma } from '@prisma/client'
import * as z from 'zod'

import { prisma } from '@/lib/database/prisma'
import { findFile } from '@/lib/files/delivery'
import type { fileListItem } from '@/lib/files/gallery-navigation'
import { fileUrls } from '@/lib/files/urls'
import { listFolders } from '@/lib/folders/service'
import { UNFILED, UNTAGGED } from '@/lib/library/contract'
import { listTags } from '@/lib/tags/manage'
import { mbToBytes } from '@/lib/utils/size'

import type { AgentPrincipal } from '../auth'
import { compact } from '../results'
import { ToolError } from '../tool'

/** The word tools take in place of a folder or tag to mean "has none". */
export const NONE = 'none'

/** A file as lists and single lookups answer it. */
export const fileRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().describe('MIME type'),
  size_bytes: z.number(),
  uploaded_at: z.string(),
  visibility: z.enum(['public', 'private']),
  has_password: z.boolean().optional(),
  url: z
    .string()
    .describe('The share page; private files need the owner signed in'),
  folder: z.string().optional().describe('Folder path, such as Work/Reports'),
  tags: z.array(z.string()).optional(),
  views: z.number(),
  downloads: z.number(),
  expires_at: z.string().optional(),
  expiry_action: z.enum(['delete', 'make_private']).optional(),
})
export type FileRow = z.infer<typeof fileRowSchema>

type ListedFile = ReturnType<typeof fileListItem>

/** Recorded sizes are megabytes; agents get whole bytes. */
export const sizeBytes = (megabytes: number) => Math.round(mbToBytes(megabytes))

export function fileRow(
  file: ListedFile,
  origin: string,
  folders: ReadonlyMap<string, string>
): FileRow {
  return compact({
    id: file.id,
    name: file.name,
    type: file.mimeType,
    size_bytes: sizeBytes(file.size),
    uploaded_at: file.uploadedAt.toISOString(),
    visibility: file.visibility === 'PRIVATE' ? 'private' : 'public',
    has_password: file.hasPassword || undefined,
    url: fileUrls(file, { origin }).page,
    folder: file.folderId ? folders.get(file.folderId) : undefined,
    tags: file.tags.length ? file.tags.map((tag) => tag.name) : undefined,
    views: file.views,
    downloads: file.downloads,
    expires_at: file.expiresAt?.toISOString(),
    expiry_action: file.expiryAction
      ? file.expiryAction === 'DELETE'
        ? 'delete'
        : 'make_private'
      : undefined,
  }) as FileRow
}

export type FolderEntry = Awaited<ReturnType<typeof listFolders>>[number] & {
  /** The names from the top folder down, joined by `/`. */
  path: string
}

/** The account's folders, each with its full path. */
export async function accountFolders(userId: string): Promise<FolderEntry[]> {
  const folders = await listFolders(userId)
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathOf = (id: string, seen = new Set<string>()): string => {
    const folder = byId.get(id)!
    // A cycle cannot be saved, but a path must never loop on one.
    if (!folder.parentId || seen.has(id) || !byId.has(folder.parentId))
      return folder.name
    return `${pathOf(folder.parentId, seen.add(id))}/${folder.name}`
  }
  return folders
    .map((folder) => ({ ...folder, path: pathOf(folder.id) }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export const folderPathMap = (folders: readonly FolderEntry[]) =>
  new Map(folders.map((folder) => [folder.id, folder.path]))

const sameText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

/**
 * The folder an argument names: its ID, its full path, or its name when only
 * one folder has it. A name several folders share is refused with their
 * paths, so the caller can say which.
 */
export function pickFolder(
  folders: readonly FolderEntry[],
  value: string
): FolderEntry {
  const wanted = value.trim().replace(/^\/+|\/+$/g, '')
  const exact =
    folders.find((folder) => folder.id === value) ??
    folders.find((folder) => sameText(folder.path, wanted))
  if (exact) return exact
  const named = folders.filter((folder) => sameText(folder.name, wanted))
  if (named.length === 1) return named[0]
  if (named.length > 1)
    throw new ToolError(
      `Several folders are called "${value}": ${named
        .map((folder) => folder.path)
        .join(', ')}. Use the full path or the folder ID.`
    )
  throw new ToolError(
    `No folder matches "${value}". Call list_folders to see the folders and their paths.`
  )
}

/** The `folder` filter value `GET /api/files` takes for a tool's `folder` argument. */
export async function folderFilter(userId: string, value: string) {
  if (value.trim().toLowerCase() === NONE) return UNFILED
  return pickFolder(await accountFolders(userId), value).id
}

type TagEntry = Awaited<ReturnType<typeof listTags>>[number]

/** The tag a value names among `tags`, by ID or by name; names are unique per account. */
export function pickTagFrom(tags: readonly TagEntry[], value: string) {
  const tag =
    tags.find((candidate) => candidate.id === value) ??
    tags.find((candidate) => sameText(candidate.name, value.trim()))
  if (!tag)
    throw new ToolError(
      `No tag matches "${value}". Call list_tags to see the tags.`
    )
  return tag
}

/** The tag an argument names, by ID or by name. */
export async function pickTag(userId: string, value: string) {
  return pickTagFrom(await listTags(userId), value)
}

/** The tags several arguments name, read from the account once. */
export async function pickTags(userId: string, values: readonly string[]) {
  if (!values.length) return []
  const tags = await listTags(userId)
  return values.map((value) => pickTagFrom(tags, value))
}

export async function tagFilter(userId: string, value: string) {
  if (value.trim().toLowerCase() === NONE) return UNTAGGED
  return (await pickTag(userId, value)).id
}

/** How tools describe the `file` argument they share. */
export const fileReference = z
  .string()
  .min(1)
  .max(2048)
  .describe(
    'A file ID from search_files, its share URL, or its /user/name path'
  )

/**
 * The account's own file an argument names: an ID, a share URL, or a
 * `/user/name` path. Anyone else's file answers exactly like a missing one.
 * `select` must include `userId`.
 */
export async function ownFile<S extends Prisma.FileSelect & { userId: true }>(
  principal: AgentPrincipal,
  reference: string,
  select: S
): Promise<Prisma.FileGetPayload<{ select: S }>> {
  const value = reference.trim()
  let path: string | null = null
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname
    } catch {
      path = null
    }
  } else if (value.startsWith('/')) path = value
  let file: Prisma.FileGetPayload<{ select: S }> | null = null
  if (path !== null) {
    const [userUrlId, ...rest] = path.split('/').filter(Boolean)
    if (userUrlId && rest.length) {
      let filename = rest[0]
      try {
        filename = decodeURIComponent(rest[0])
      } catch {
        // A name that is not valid percent-encoding is looked up as written.
      }
      file = await findFile({ userUrlId, filename }, select)
    }
  } else file = await findFile({ id: value }, select)
  if (!file || (file as { userId: string }).userId !== principal.user.id)
    throw new ToolError(
      `No file of this account matches "${reference}". Use search_files to find it.`
    )
  return file
}

/** The files a batch tool names, by ID. Missing and foreign IDs are reported together. */
export async function ownFilesById(
  principal: AgentPrincipal,
  ids: readonly string[]
) {
  const unique = [...new Set(ids)]
  const files = await prisma.file.findMany({
    where: { id: { in: unique }, userId: principal.user.id },
    select: { id: true, name: true },
  })
  const found = new Map(files.map((file) => [file.id, file]))
  return { unique, found }
}

/** Up to 50 file IDs, the size every batch tool accepts. */
export const fileIds = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(50)
  .describe('File IDs from search_files, 1 to 50')
