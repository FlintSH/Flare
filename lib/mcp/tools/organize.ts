import { ExpiryAction } from '@/types/events'
import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import {
  cancelFileExpiration,
  scheduleFileExpiration,
} from '@/lib/files/expiry'
import {
  type FileAuthority,
  deleteFile,
  fileSettingsSchema,
  updateFileSettings,
} from '@/lib/files/manage'
import { FILE_PASSWORD_MIN_LENGTH } from '@/lib/files/password-policy'
import { fileUrls } from '@/lib/files/urls'
import { fileFoldersInputSchema } from '@/lib/folders/schema'
import { moveFilesToFolder } from '@/lib/folders/service'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
import { fileTagMembership } from '@/lib/tags/membership'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { changeFileTags } from '@/lib/tags/service'

import type { AgentPrincipal } from '../auth'
import { compact } from '../results'
import { type ToolContext, ToolError, defineTool } from '../tool'
import { folderChange } from './folders'
import {
  NONE,
  accountFolders,
  fileIds,
  filesById,
  moderatedAccount,
  ownFilesById,
  pickFolder,
  pickTags,
} from './shared'
import { tagChange } from './tags'

const logger = loggers.api

/** How a batch tool answers for one file. */
const fileResult = z.object({
  id: z.string(),
  name: z.string().optional(),
  ok: z.boolean(),
  error: z.string().optional().describe('Why this file was left as it was'),
})
type FileResult = z.infer<typeof fileResult>

type NamedFile = { id: string; name: string }

const NOT_OWN =
  'No file of this account has this ID. Use search_files to find it.'
const NOT_THEIRS =
  'No file of that account has this ID. Use search_files with the same `account` to find it.'

/**
 * Whose files a batch acts on, and under whose authority: the caller's own,
 * or, in moderator mode, the named account's as a moderator. A moderator
 * never acts as that account, and the services find only its files.
 */
async function batchAuthority(
  context: Pick<ToolContext, 'principal' | 'moderating' | 'requireModeration'>
): Promise<{ userId: string; authority: FileAuthority; missing: string }> {
  const account = await moderatedAccount(context)
  return account
    ? {
        userId: account.id,
        authority: { as: 'moderator', accountId: account.id },
        missing: NOT_THEIRS,
      }
    : {
        userId: context.principal.user.id,
        authority: { as: 'owner', userId: context.principal.user.id },
        missing: NOT_OWN,
      }
}

/** The audit event names the file a call is about, or says how many. */
function auditFiles(files: readonly NamedFile[]) {
  if (files.length === 1)
    setAuditTarget({ type: 'file', id: files[0].id, name: files[0].name })
  else if (files.length)
    setAuditTarget({ type: 'file', name: `${files.length} files` })
}

/** Why one file of a batch failed, worded for the agent. */
function failureText(error: unknown): string {
  // The services word these for the person calling them.
  if (error instanceof HttpError) {
    if (error.status >= 500)
      logger.error('A file in an MCP batch failed', error)
    return error.message
  }
  logger.error('A file in an MCP batch failed', error as Error)
  return 'Flare could not complete this for the file. Check it with get_file before trying again.'
}

/**
 * A batch in which no file succeeded is a failed call: the agent gets an
 * error and the audit log a failure, where a list of refusals would be
 * recorded as a success.
 */
function settled<Row extends FileResult>(results: Row[], nothing: string) {
  if (results.some((result) => result.ok)) return results
  const reasons = new Map<string, string[]>()
  for (const { id, error = '' } of results)
    reasons.set(error, [...(reasons.get(error) ?? []), id])
  throw new ToolError(
    `${nothing} ${[...reasons]
      .map(([error, ids]) => `${ids.join(', ')}: ${error}`)
      .join(' ')}`
  )
}

/**
 * Runs `change` for each file a batch names, one after another because every
 * change locks the same account. A file that fails is reported and the rest
 * still run. IDs that are not files of the account acted on (the caller's,
 * or the moderated one's) never reach the service.
 */
async function eachFile<Extra extends object = object>(
  owner: AgentPrincipal | { userId: string; missing: string },
  ids: readonly string[],
  nothing: string,
  change: (file: NamedFile) => Promise<Extra | void>
) {
  type Row = FileResult & Partial<Extra>
  const { userId, missing } =
    'user' in owner ? { userId: owner.user.id, missing: NOT_OWN } : owner
  const { unique, found } = await filesById(userId, ids)
  const results: Row[] = []
  for (const id of unique) {
    const file = found.get(id)
    if (!file) {
      results.push({ id, ok: false, error: missing } as Row)
      continue
    }
    try {
      const extra = await change(file)
      results.push({ id, name: file.name, ok: true, ...extra } as Row)
    } catch (error) {
      results.push({
        id,
        name: file.name,
        ok: false,
        error: failureText(error),
      } as Row)
    }
  }
  // Set after the changes, because the delete service names each file it
  // deletes as the target and a batch is not about its last file.
  auditFiles([...found.values()])
  return settled(results, nothing)
}

const isNone = (value: string) => value.trim().toLowerCase() === NONE

const moveFiles = defineTool({
  name: 'move_files',
  description:
    'Move up to 50 files into a folder, or out of folders with `folder: "none"`. All or nothing: if one ID is not a file of this account, no file moves. A file is in one folder at a time, so this replaces the folder it was in. Links and visibility do not change, but a public file directly in a folder that has a public link appears on that folder\'s page.',
  input: z.object({
    files: fileIds,
    folder: z
      .string()
      .min(1)
      .max(1024)
      .describe(
        'The destination: a folder path, name or ID, or "none" for no folder'
      ),
  }),
  output: z.object({
    moved: z.number().describe('Files now in the destination'),
    folder: z
      .string()
      .optional()
      .describe(
        'The destination path; absent when the files were taken out of folders'
      ),
  }),
  async run(args, { principal }) {
    const userId = principal.user.id
    const folder = isNone(args.folder)
      ? null
      : pickFolder(await accountFolders(userId), args.folder)
    // The service only says that some file is unavailable; this says which.
    const { unique, found } = await ownFilesById(principal, args.files)
    auditFiles([...found.values()])
    const missing = unique.filter((id) => !found.has(id))
    if (missing.length)
      throw new ToolError(
        `Nothing was moved: no file of this account has the ID ${missing.join(', ')}. Use search_files to find the files, then move them again.`
      )
    const input = fileFoldersInputSchema.parse({
      fileIds: args.files,
      folderId: folder?.id ?? null,
    })
    const moved = await folderChange(() => moveFilesToFolder(userId, input))
    return { structured: compact({ moved, folder: folder?.path }) }
  },
})

/** Tags one call may add, and may remove. */
const TAGS_PER_CALL = 10

const tagList = z.array(z.string().min(1).max(200)).min(1).max(TAGS_PER_CALL)

/** The tags a list of names and IDs means, each once, read from the account once. */
async function distinctTags(userId: string, values: readonly string[] = []) {
  const tags = await pickTags(userId, values)
  return [...new Map(tags.map((tag) => [tag.id, tag])).values()]
}

const tagFiles = defineTool({
  name: 'tag_files',
  description: `Put tags on up to 50 files, take tags off them, or both: give \`add\`, \`remove\` or both, up to ${TAGS_PER_CALL} tags each. The tags must exist; see them with list_tags and create one with save_tag. A file that already has a tag being added, or lacks one being removed, stays as it is. Taking a tag off by hand also keeps that tag's rule from putting it back on the file. Answers per file with the tags it has afterwards.`,
  input: z.object({
    files: fileIds,
    add: tagList.optional().describe('Tags to put on the files: names or IDs'),
    remove: tagList
      .optional()
      .describe('Tags to take off the files: names or IDs'),
  }),
  output: z.object({
    results: z.array(
      fileResult.extend({
        tags: z
          .array(z.string())
          .optional()
          .describe('The tags the file has after the change'),
      })
    ),
  }),
  async run(args, { principal }) {
    const userId = principal.user.id
    const add = await distinctTags(userId, args.add)
    const remove = await distinctTags(userId, args.remove)
    if (!add.length && !remove.length)
      throw new ToolError(
        'Give `add`, `remove` or both: the tags to put on the files or take off them.'
      )
    const twice = add.find((tag) => remove.some(({ id }) => id === tag.id))
    if (twice)
      throw new ToolError(
        `The tag "${twice.name}" is in both \`add\` and \`remove\`. Name it in one of them.`
      )

    const { unique, found } = await ownFilesById(principal, args.files)
    auditFiles([...found.values()])
    const owned = unique.filter((id) => found.has(id))
    const tags = new Map<string, string[]>()
    if (owned.length) {
      // The service changes one tag on every file or on none, so a tag that
      // fails stops the call and says what was already done.
      const done: string[] = []
      for (const [action, list] of [
        ['add', add],
        ['remove', remove],
      ] as const)
        for (const tag of list) {
          const input = fileTagsInputSchema.parse({
            fileIds: owned,
            tagId: tag.id,
            action,
          })
          try {
            await tagChange(() => changeFileTags(userId, input))
          } catch (error) {
            if (!(error instanceof HttpError)) throw error
            throw new ToolError(
              `Could not ${action} the tag "${tag.name}": ${error.message} ${
                done.length
                  ? `Already done in this call: ${done.join(', ')}.`
                  : 'No file was changed.'
              } Check the files with search_files, then try again.`
            )
          }
          done.push(`${action === 'add' ? 'added' : 'removed'} "${tag.name}"`)
        }
      try {
        for (const file of await fileTagMembership(userId, owned))
          tags.set(
            file.id,
            file.tags.map((tag) => tag.name)
          )
      } catch (error) {
        // The change is done. A file deleted since costs only the tag lists.
        if (!(error instanceof HttpError)) throw error
      }
    }
    return {
      structured: {
        results: settled(
          unique.map((id) => {
            const file = found.get(id)
            return file
              ? compact({ id, name: file.name, ok: true, tags: tags.get(id) })
              : { id, ok: false, error: NOT_OWN }
          }),
          'No file was changed.'
        ),
      },
    }
  },
})

const EXPIRY_ACTIONS = {
  delete: ExpiryAction.DELETE,
  make_private: ExpiryAction.SET_PRIVATE,
} as const

const expiryAction = z.enum(['delete', 'make_private'])

const setFileExpiry = defineTool({
  name: 'set_file_expiry',
  description:
    'Schedule what happens to up to 50 files at a time you choose, or cancel that. With `action: "delete"` the files are deleted permanently at `expires_at`; with `action: "make_private"` they become private then and are kept. A new schedule replaces the one a file has, and `expires_at: null` cancels it. Scheduling a deletion needs a connection that may delete files, and "make_private" one that may change sharing; cancelling needs neither. Answers per file.',
  input: z.object({
    files: fileIds,
    expires_at: z
      .string()
      .max(64)
      .nullable()
      .describe(
        'A future ISO 8601 time with offset, such as 2027-01-31T18:00:00Z; null cancels the expiry'
      ),
    action: expiryAction
      .optional()
      .describe('What happens at that time; required with a time'),
  }),
  output: z.object({
    expires_at: z
      .string()
      .optional()
      .describe('The scheduled time in UTC; absent after cancelling'),
    action: expiryAction.optional(),
    results: z.array(
      fileResult.extend({
        cancelled: z
          .boolean()
          .optional()
          .describe('After cancelling: false when the file had no expiry'),
      })
    ),
  }),
  async run(args, { principal, requireEffect }) {
    const { user } = principal
    const { expires_at: expiresAt, action } = args
    if (expiresAt === null) {
      if (action)
        throw new ToolError(
          '`expires_at: null` cancels the expiry, so `action` does not apply. Leave `action` out to cancel; to delete files now, use delete_files.'
        )
      const results = await eachFile(
        principal,
        args.files,
        'No expiry was cancelled.',
        async (file) => ({
          cancelled: await cancelFileExpiration(user.id, file.id),
        })
      )
      return { structured: { results } }
    }
    if (!action)
      throw new ToolError(
        'Say what happens at that time: `action` "delete" (permanent) or "make_private".'
      )
    // What the expiry does when it runs must be allowed now, before any
    // file is scheduled.
    requireEffect(action)
    const scheduled: Date[] = []
    const results = await eachFile(
      principal,
      args.files,
      'No expiry was scheduled.',
      async (file) => {
        scheduled.push(
          await scheduleFileExpiration(user, file.id, {
            expiresAt,
            action: EXPIRY_ACTIONS[action],
          })
        )
      }
    )
    return {
      structured: {
        expires_at: scheduled[0].toISOString(),
        action,
        results,
      },
    }
  },
})

const VISIBILITY = { public: 'PUBLIC', private: 'PRIVATE' } as const

const visibility = z.enum(['public', 'private'])

const setFileSharing = defineTool({
  name: 'set_file_sharing',
  moderation: true,
  description:
    'Change who can open up to 50 files. `visibility` "public" lets anyone with the link open a file; "private" lets only the signed-in owner. `password` makes visitors enter one, and `password: null` removes it. Give either or both. Making a file public or removing its password exposes it to everyone who has the link, and making it private cuts off everyone using the link. Answers per file with the new state and the share URL; a password is never returned. With `account`, the files are that account\'s, changed as a moderator.',
  input: z.object({
    files: fileIds,
    visibility: visibility.optional(),
    password: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .describe(
        `A new password of at least ${FILE_PASSWORD_MIN_LENGTH} characters; null removes the password`
      ),
  }),
  output: z.object({
    results: z.array(
      fileResult.extend({
        visibility: visibility.optional(),
        has_password: z.boolean().optional(),
        url: z
          .string()
          .optional()
          .describe('The share page; private files need the owner signed in'),
      })
    ),
  }),
  async run(args, context) {
    const { origin } = context
    if (args.visibility === undefined && args.password === undefined)
      throw new ToolError(
        'Give `visibility`, `password` or both: what to change about the files.'
      )
    // Checked once, as the route checks its body, so a password that is too
    // short changes no file.
    const settings = fileSettingsSchema.parse({
      ...(args.visibility && { visibility: VISIBILITY[args.visibility] }),
      ...(args.password !== undefined && { password: args.password }),
    })
    const { authority, ...owner } = await batchAuthority(context)
    const results = await eachFile(
      owner,
      args.files,
      'No file was changed.',
      async ({ id }) => {
        const file = await updateFileSettings(authority, id, settings)
        return {
          visibility:
            file.visibility === 'PRIVATE'
              ? ('private' as const)
              : ('public' as const),
          has_password: file.hasPassword,
          url: fileUrls(file, { origin }).page,
        }
      }
    )
    return { structured: { results } }
  },
})

const deleteFiles = defineTool({
  name: 'delete_files',
  moderation: true,
  description:
    "Permanently delete up to 50 files. Flare has no trash: a deleted file, its contents and its link cannot be recovered, so check the IDs with get_file or search_files first. To remove files later instead, use set_file_expiry. Answers per file. With `account`, the files are that account's, deleted as a moderator.",
  input: z.object({ files: fileIds }),
  output: z.object({ results: z.array(fileResult) }),
  async run(args, context) {
    const { authority, ...owner } = await batchAuthority(context)
    const results = await eachFile(
      owner,
      args.files,
      'No file was deleted.',
      async ({ id }) => deleteFile(authority, id)
    )
    return { structured: { results } }
  },
})

export const organizeTools = [
  moveFiles,
  tagFiles,
  setFileExpiry,
  setFileSharing,
  deleteFiles,
]
