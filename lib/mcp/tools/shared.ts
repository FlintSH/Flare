import type { Prisma } from '@prisma/client'
import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { type FileAccessInfo, checkFileAccess } from '@/lib/files/access'
import { findFile } from '@/lib/files/delivery'
import type { fileListItem } from '@/lib/files/gallery-navigation'
import { fileUrls } from '@/lib/files/urls'
import { listFolders } from '@/lib/folders/service'
import { UNFILED, UNTAGGED } from '@/lib/library/contract'
import { listTags } from '@/lib/tags/manage'
import { mbToBytes } from '@/lib/utils/size'

import type { AgentPrincipal } from '../auth'
import { type AccountSummary, resolveAccount } from '../moderation'
import { compact } from '../results'
import { type ToolContext, ToolError } from '../tool'

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
  // A moderator's listing has no counts, as the REST moderation route has none.
  views: z.number().optional(),
  downloads: z.number().optional(),
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
 * The file of `accountId` an argument names: an ID, a share URL, or a
 * `/user/name` path. Anyone else's file answers exactly like a missing one,
 * with `missing`. `select` must include `userId`.
 */
export async function accountFile<
  S extends Prisma.FileSelect & { userId: true },
>(
  accountId: string,
  reference: string,
  select: S,
  missing: string
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
  if (!file || (file as { userId: string }).userId !== accountId)
    throw new ToolError(missing)
  return file
}

/**
 * The account's own file an argument names: an ID, a share URL, or a
 * `/user/name` path. Anyone else's file answers exactly like a missing one.
 * `select` must include `userId`.
 */
export function ownFile<S extends Prisma.FileSelect & { userId: true }>(
  principal: AgentPrincipal,
  reference: string,
  select: S
): Promise<Prisma.FileGetPayload<{ select: S }>> {
  return accountFile(
    principal.user.id,
    reference,
    select,
    `No file of this account matches "${reference}". Use search_files to find it.`
  )
}

/** The files of `userId` a batch tool names, by ID. Missing and foreign IDs are reported together. */
export async function filesById(userId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  const files = await prisma.file.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true, name: true },
  })
  const found = new Map(files.map((file) => [file.id, file]))
  return { unique, found }
}

/** The files a batch tool names, by ID. Missing and foreign IDs are reported together. */
export function ownFilesById(
  principal: AgentPrincipal,
  ids: readonly string[]
) {
  return filesById(principal.user.id, ids)
}

/**
 * The account a call in moderator mode acts on, or null in owner mode. The
 * server checked the moderation needs before the tool ran; asking again here
 * keeps a tool from ever acting on another account without them.
 */
export async function moderatedAccount(
  context: Pick<ToolContext, 'moderating' | 'requireModeration'>
): Promise<AccountSummary | null> {
  if (context.moderating === null) return null
  context.requireModeration()
  return resolveAccount(context.moderating)
}

/** What a tool says about a file of the moderated account that is not there. */
export const NOT_THEIRS =
  'No file of that account matches. Use search_files with the same `account` to find it.'

/**
 * A file of the account a moderator names, found as `accountFile` finds it,
 * and only if the app's delivery rules let this moderator open it
 * (`checkFileAccess`, which lets `content.read` past visibility and
 * passwords). Any other file answers exactly like a missing one.
 */
export async function moderatedFile<
  S extends Prisma.FileSelect & { userId: true },
>(
  principal: AgentPrincipal,
  accountId: string,
  reference: string,
  select: S
): Promise<Prisma.FileGetPayload<{ select: S }>> {
  const file = await accountFile(
    accountId,
    reference,
    { ...select, id: true, visibility: true, password: true },
    NOT_THEIRS
  )
  const access = await checkFileAccess(file as unknown as FileAccessInfo, {
    user: { id: principal.user.id, permissions: principal.user.permissions },
  })
  if (!access.allowed || !access.canModerate) throw new ToolError(NOT_THEIRS)
  return file as unknown as Prisma.FileGetPayload<{ select: S }>
}

/** The audit event of a moderator's call names the account it looked at. */
export function auditAccount(account: AccountSummary) {
  setAuditTarget({
    type: 'user',
    id: account.id,
    name: account.name ?? undefined,
  })
}

/** Up to 50 file IDs, the size every batch tool accepts. */
export const fileIds = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(50)
  .describe('File IDs from search_files, 1 to 50')

/**
 * The account's upload profile an argument names: its ID, its exact name, or
 * its name in another letter case when only one profile has it.
 */
export async function ownProfile(userId: string, value: string) {
  const wanted = value.trim()
  const profiles = await prisma.uploadProfile.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  })
  const exact =
    profiles.find((profile) => profile.id === wanted) ??
    profiles.find((profile) => profile.name === wanted)
  if (exact) return exact
  // Names differ by case at most here; one match is what the caller meant.
  const named = profiles.filter(
    (profile) => profile.name.toLowerCase() === wanted.toLowerCase()
  )
  if (named.length === 1) return named[0]
  if (named.length > 1)
    throw new ToolError(
      `Several upload profiles match "${value}": ${named
        .map((profile) => profile.name)
        .join(', ')}. Use the exact name or the profile ID.`
    )
  throw new ToolError(
    `No upload profile matches "${value}". Call get_account to see the upload profiles.`
  )
}

/** The ID of the upload profile an argument names, as `ownProfile` finds it; null for "none". */
export async function pickProfile(
  userId: string,
  value: string
): Promise<string | null> {
  if (value.trim().toLowerCase() === NONE) return null
  return (await ownProfile(userId, value)).id
}

/** Text ended as a sentence; some services' refusals are not written as one. */
export const sentence = (text: string) =>
  /[.!?]$/.test(text) ? text : `${text}.`

/**
 * A value read by the schema a service or its route reads it with, so a tool
 * refuses exactly what the route refuses, in the route's words. `names` gives
 * the tool's argument for each field the schema may complain about.
 */
export function serviceInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  names: Record<string, string>
): z.infer<Schema> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const [issue] = parsed.error.issues
  const name = names[String(issue.path[0])]
  throw new ToolError(name ? `\`${name}\`: ${issue.message}` : issue.message)
}

/** A new file as the tools that make one answer it. */
export const newFileSchema = z.object({
  file: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string().describe('MIME type'),
    size_bytes: z.number(),
    url: z
      .string()
      .describe('The share page; private files need the owner signed in'),
    raw_url: z.string().describe('The bytes, shown in the browser'),
    download_url: z.string().describe('The bytes, as a download'),
  }),
})

/**
 * What an address may hold inside double quotes in a shell command without
 * the shell reading any of it: URL characters, less `!` and `$`.
 */
const SHELL_PLAIN = /^[A-Za-z0-9\-._~:/?#[\]@%&'()*+,;=]+$/

/**
 * Refuses to write a shell command around an instance address the shell
 * would read. The rest of a transfer URL is a fixed path and a base64url
 * secret.
 */
export function shellSafeOrigin(origin: string) {
  if (!SHELL_PLAIN.test(origin))
    throw new ToolError(
      'The address of this Flare instance holds characters that are not safe in a shell command. Ask its administrator to check the address it is served under.'
    )
}
