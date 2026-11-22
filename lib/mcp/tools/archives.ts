import * as z from 'zod'

import { ArchiveError } from '@/lib/archives/errors'
import {
  archiveRoutes,
  createArchiveSchema,
  extractArchiveSchema,
} from '@/lib/archives/http'
import {
  ARCHIVE_CONCURRENCY,
  type ArchiveOperation,
  withArchiveOperation,
} from '@/lib/archives/operation'
import { createAccountArchive, extractArchive } from '@/lib/archives/service'
import { ARCHIVE_LIMITS } from '@/lib/archives/shared'
import { setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { fileKind } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { FOLDER_NAME_MAX_LENGTH } from '@/lib/folders/schema'
import { HttpError } from '@/lib/http/errors'

import type { AgentPrincipal } from '../auth'
import { archiveActor } from '../publish-check'
import { readableBytes } from '../results'
import { ToolError, defineTool } from '../tool'
import { EXPORT_MINUTES, createExportUrl } from '../transfer'
import {
  NONE,
  accountFolders,
  fileReference,
  newFileSchema,
  ownFile,
  ownFilesById,
  pickFolder,
  pickProfile,
  sentence,
  serviceInput,
  shellSafeOrigin,
} from './shared'

const MINUTES = ARCHIVE_LIMITS.timeoutMs / 60_000

/** What both tools say about how long a call takes and what its results are. */
const OPERATION_NOTE = `A call can take up to ${MINUTES} minutes, and Flare runs one archive operation for an account at a time. What it creates is private and never expires, unless \`profile\` names an upload profile to follow.`

const profile = z
  .string()
  .max(100)
  .optional()
  .describe(
    'An upload profile ID or name from get_account whose settings the new files get; left out or "none", they are private and never expire. A token bound to an upload profile always uses that one'
  )

/**
 * The upload profile the results are published with, or null for none: the
 * one the call names, by ID or by name as the upload tools read it. A token
 * bound to a profile publishes with that profile, named or not, and is
 * refused any other, as its uploads are. The archive services select no
 * profile by themselves, so without this such a token's results would be
 * refused only once they were made.
 */
async function resultProfile(
  principal: AgentPrincipal,
  value: string | undefined
): Promise<string | null> {
  const bound = principal.user.apiToken?.profileId
  const wanted = value?.trim()
  const named = async () =>
    wanted ? pickProfile(principal.user.id, wanted) : null
  if (!bound) return named()
  if (wanted !== undefined && (await named()) !== bound)
    throw new ToolError(
      'This token is bound to an upload profile and publishes only with it. Leave `profile` out.',
      'denied'
    )
  return bound
}

/** What the services tell a browser to do next; an agent is told its own way. */
const BROWSER_ADVICE =
  / (?:Refresh|Review the refreshed settings) and try again\.$/

/**
 * A refusal of the archive services, with what an agent can do about it. The
 * routes' own reading of what was thrown comes first, so a folder name that
 * is taken or a file that vanished part way is answered as they answer it.
 * `tooMuch` is what to do when the files themselves are the reason.
 */
function refusal(error: unknown, tooMuch: string): unknown {
  if (error instanceof ToolError) return error
  const answer =
    archiveRoutes.translate?.(error) ??
    (error instanceof HttpError ? error : undefined)
  // Anything else is Flare's own failure, which the server logs and words.
  if (!answer || answer.status >= 500) return error
  const { status } = answer
  const denied =
    status === 401 ||
    status === 403 ||
    (answer instanceof ArchiveError && answer.accessDenied)
  if (status === 429)
    return new ToolError(
      `Another archive operation is running: Flare runs one for an account at a time, and ${ARCHIVE_CONCURRENCY} at once on this server. Nothing was created. Wait for it to finish, which takes up to ${MINUTES} minutes, then call again.`
    )
  if (status === 401)
    return new ToolError(
      'The account was signed out everywhere, or removed, while this call was running. Nothing was created. If this connection still works, call again.',
      'denied'
    )
  const next =
    status === 409
      ? ' Look at what is there now, then call again.'
      : status === 408
        ? ' Call again; if it runs out of time again, the files are too large to work on here.'
        : status === 404
          ? ' Check that the files, folder and upload profile this call names still exist.'
          : // The archive or the files are what was refused, not the call.
            status === 413 ||
              (answer instanceof ArchiveError && [400, 415].includes(status))
            ? ` ${tooMuch}`
            : ''
  const said = answer.message.replace(BROWSER_ADVICE, '')
  return new ToolError(
    `${sentence(said)} Nothing was created.${next}`,
    denied ? 'denied' : 'failure'
  )
}

/**
 * One archive operation for the account, as the routes run it: one at a time,
 * within the services' time limit, and ended with the MCP request.
 */
async function operate<Result>(
  principal: AgentPrincipal,
  signal: AbortSignal,
  tooMuch: string,
  action: (operation: ArchiveOperation) => Promise<Result>
): Promise<Result> {
  try {
    return await withArchiveOperation(principal.user.id, signal, action)
  } catch (error) {
    throw refusal(error, tooMuch)
  }
}

/** The folder an argument names, or null when it names none. */
async function namedFolder(userId: string, value: string | undefined) {
  return value && value.trim().toLowerCase() !== NONE
    ? pickFolder(await accountFolders(userId), value)
    : null
}

const extractArchiveTool = defineTool({
  name: 'extract_archive',
  description: `Unpack an archive in this account's library into a new folder, as Extract all does in the app: each file inside becomes a file in the library, in folders that follow the archive's own. Takes a zip, tar, tar.gz, tgz or gz file of up to ${readableBytes(ARCHIVE_LIMITS.archiveBytes)} that unpacks to at most ${readableBytes(ARCHIVE_LIMITS.expandedBytes)}, ${readableBytes(ARCHIVE_LIMITS.fileBytes)} a file and ${ARCHIVE_LIMITS.entries.toLocaleString('en-US')} files and folders; any other is refused and nothing is created. ${OPERATION_NOTE} Returns the new folder and how many files were created. read_file lists what is inside first, and says whether it can be extracted.`,
  input: z.strictObject({
    file: fileReference,
    folder_name: z
      .string()
      .min(1)
      .max(FOLDER_NAME_MAX_LENGTH)
      .describe('The name of the new folder the contents go into'),
    parent_folder: z
      .string()
      .max(1024)
      .optional()
      .describe(
        'A folder path, name or ID to make the new folder inside; left out, it is made at the top level'
      ),
    profile,
  }),
  output: z.object({
    folder: z.object({
      id: z.string(),
      path: z.string().describe('Folder path, such as Work/Reports'),
    }),
    files_created: z.number(),
  }),
  async run(args, { principal, request }) {
    const userId = principal.user.id
    const file = await ownFile(principal, args.file, {
      id: true,
      name: true,
      userId: true,
      mimeType: true,
    })
    setAuditTarget({ type: 'file', id: file.id, name: file.name })
    if (fileKind(file).kind !== 'archive')
      throw new ToolError(
        'This file is not an archive Flare can extract. It extracts zip, tar, tar.gz, tgz and gz files.'
      )
    const parent = await namedFolder(userId, args.parent_folder)
    const profileId = await resultProfile(principal, args.profile)
    const input = serviceInput(
      extractArchiveSchema,
      { folderId: parent?.id ?? null, name: args.folder_name, profileId },
      { name: 'folder_name', folderId: 'parent_folder', profileId: 'profile' }
    )
    const actor = await archiveActor(principal, 'extract_archive')
    const result = await operate(
      principal,
      request.signal,
      'To read single files from this archive, call read_file with `entry`.',
      (operation) => extractArchive(actor, file.id, input, operation)
    )
    const made = (await accountFolders(userId)).find(
      (folder) => folder.id === result.folderId
    )
    return {
      structured: {
        folder: {
          id: result.folderId,
          // As the library has it; a folder moved this instant keeps the
          // place it was made in.
          path:
            made?.path ?? [parent?.path, input.name].filter(Boolean).join('/'),
        },
        files_created: result.fileCount,
      },
    }
  },
})

const createArchiveTool = defineTool({
  name: 'create_archive',
  description: `Pack up to ${ARCHIVE_LIMITS.selectedFiles} of this account's files into one new zip or tar.gz file in its library, as Create archive does in the app. A file may be up to ${readableBytes(ARCHIVE_LIMITS.fileBytes)} and all of them together ${readableBytes(ARCHIVE_LIMITS.expandedBytes)}; more is refused and nothing is created. ${OPERATION_NOTE} Returns the new file's ID and links.`,
  input: z.strictObject({
    files: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(ARCHIVE_LIMITS.selectedFiles)
      .describe(
        `File IDs from search_files, 1 to ${ARCHIVE_LIMITS.selectedFiles}`
      ),
    name: z
      .string()
      .min(1)
      .max(180)
      .describe(
        'The name of the new archive; the extension is added when it is left off'
      ),
    format: z.enum(['zip', 'tar.gz']),
    folder: z
      .string()
      .max(1024)
      .optional()
      .describe('A folder path, name or ID to put the archive in'),
    profile,
  }),
  output: newFileSchema,
  async run(args, { principal, origin, request }) {
    const userId = principal.user.id
    const ids = [...new Set(args.files)]
    const { found } = await ownFilesById(principal, ids)
    const unknown = ids.filter((id) => !found.has(id))
    if (unknown.length)
      throw new ToolError(
        `No file of this account matches ${unknown
          .map((id) => `"${id}"`)
          .join(', ')}. Use search_files to find the files to pack.`
      )
    const folder = await namedFolder(userId, args.folder)
    const profileId = await resultProfile(principal, args.profile)
    const input = serviceInput(
      createArchiveSchema,
      {
        fileIds: ids,
        name: args.name,
        format: args.format,
        folderId: folder?.id ?? null,
        profileId,
      },
      {
        fileIds: 'files',
        name: 'name',
        folderId: 'folder',
        profileId: 'profile',
      }
    )
    const actor = await archiveActor(principal, 'create_archive')
    const { file, totalBytes } = await operate(
      principal,
      request.signal,
      'Pack fewer or smaller files.',
      (operation) => createAccountArchive(actor, input, operation)
    )
    // The type is the service's to choose, so it is read, not assumed.
    const stored = await prisma.file.findUnique({
      where: { id: file.id },
      select: { mimeType: true },
    })
    if (!stored)
      throw new ToolError(
        'The archive was made and then removed before this call could answer. Call search_files to see what is there now.'
      )
    const urls = fileUrls(file, { origin, owner: principal.user })
    return {
      structured: {
        file: {
          id: file.id,
          name: file.name,
          type: stored.mimeType,
          size_bytes: totalBytes,
          url: urls.page,
          raw_url: urls.content,
          download_url: urls.download,
        },
      },
    }
  },
})

const exportAccountTool = defineTool({
  name: 'export_account',
  description: `Get a one-time URL that downloads this account's data export: one ZIP holding every file the account stores, and a JSON file that lists them and the account's short links. It holds every file and link, so it can be very large and take a long time to download; none of it passes through this conversation. Run the returned \`curl\` command once: the download has to start within ${EXPORT_MINUTES} minutes and the URL works one time. If the download is refused, the command fails and saves no ZIP.`,
  input: z.strictObject({}),
  output: z.object({
    download_url: z.string(),
    expires_at: z.string().describe('When the URL stops starting a download'),
    curl: z
      .string()
      .describe('Run once; it saves the export as flare-export.zip'),
  }),
  async run(_args, { principal, origin }) {
    shellSafeOrigin(origin)
    setAuditTarget({
      type: 'user',
      id: principal.user.id,
      name: principal.name ?? undefined,
    })
    const { url, expires_at } = await createExportUrl(principal, origin)
    return {
      structured: {
        download_url: url,
        expires_at,
        // -f: a refused download fails, and no error page is saved as the ZIP.
        curl: `curl -fsS -o flare-export.zip "${url}"`,
      },
    }
  },
})

export const archivesTools = [
  extractArchiveTool,
  createArchiveTool,
  exportAccountTool,
]
