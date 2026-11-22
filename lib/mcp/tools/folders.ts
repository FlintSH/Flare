import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { sharedFolderUrl } from '@/lib/files/urls'
import { folderRoutes } from '@/lib/folders/http'
import {
  FOLDER_NAME_MAX_LENGTH,
  type FolderView,
  folderInputSchema,
  folderUpdateSchema,
} from '@/lib/folders/schema'
import { createFolder, deleteFolder, updateFolder } from '@/lib/folders/service'

import { compact, decodeCursor, pageOf } from '../results'
import { ToolError, defineTool } from '../tool'
import { NONE, accountFolders, folderPathMap, pickFolder } from './shared'

const PAGE_SIZE = 200

const folderReference = z.string().min(1).max(1024)

const folderRowSchema = z.object({
  id: z.string(),
  path: z
    .string()
    .describe('The names from the top folder down, such as Work/Reports'),
  name: z.string(),
  file_count: z.number().describe('Files directly in the folder'),
  share_url: z
    .string()
    .optional()
    .describe('The public link; present only while the folder has one'),
})

function folderRow(folder: FolderView, path: string, origin: string) {
  return compact({
    id: folder.id,
    path,
    name: folder.name,
    file_count: folder.fileCount,
    share_url: folder.shareToken
      ? sharedFolderUrl(folder.shareToken, { origin })
      : undefined,
  })
}

/** Runs a folder change, wording a name conflict or a vanished row as the folder routes do. */
export async function folderChange<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change()
  } catch (error) {
    throw folderRoutes.translate?.(error) ?? error
  }
}

const listFolders = defineTool({
  name: 'list_folders',
  description:
    'The folders of this account, each with its full path, how many files are directly in it, and its public link if it has one. Wherever a tool takes a folder, use a path or ID from here. Returns 200 folders a page, ordered by path; pass `next_cursor` back as `cursor` for more.',
  input: z.object({ cursor: z.string().max(200).optional() }),
  output: z.object({
    folders: z.array(folderRowSchema),
    total: z.number().describe('Folders in the account, across all pages'),
    next_cursor: z.string().optional(),
  }),
  async run(args, { principal, origin }) {
    const offset = decodeCursor(args.cursor)
    const { page, total, next_cursor } = pageOf(
      await accountFolders(principal.user.id),
      offset,
      PAGE_SIZE
    )
    return {
      structured: compact({
        folders: page.map((folder) => folderRow(folder, folder.path, origin)),
        total,
        next_cursor,
      }),
    }
  },
})

const saveFolder = defineTool({
  name: 'save_folder',
  description:
    'Create a folder, or rename one. To create, give `name` and, for a subfolder, its `parent`. To rename, give `folder` and the new `name`. A folder cannot be moved to another parent, and two folders in the same place cannot share a name, whatever the letter case. Put files in a folder with move_files; its public link is set_folder_sharing.',
  input: z.object({
    name: z
      .string()
      .max(500)
      .describe(`Up to ${FOLDER_NAME_MAX_LENGTH} characters, without slashes`),
    folder: folderReference
      .optional()
      .describe(
        'The folder to rename: its path, name or ID. Leave out to create a folder'
      ),
    parent: folderReference
      .optional()
      .describe(
        'The folder to create it in: a path, name or ID. Leave out for the top level'
      ),
  }),
  output: z.object({ folder: folderRowSchema }),
  async run(args, { principal, origin }) {
    const userId = principal.user.id
    const folders = await accountFolders(userId)
    const paths = folderPathMap(folders)
    const pathIn = (parentId: string | null, name: string) =>
      parentId && paths.has(parentId) ? `${paths.get(parentId)}/${name}` : name

    if (args.folder !== undefined) {
      if (args.parent !== undefined)
        throw new ToolError(
          'Flare cannot move a folder to another parent. Leave out `parent` to rename it, or create a folder in the new place and move the files there with move_files.'
        )
      const current = pickFolder(folders, args.folder)
      setAuditTarget({ type: 'folder', id: current.id, name: current.name })
      // Only the name: sharing belongs to set_folder_sharing.
      const input = folderUpdateSchema.parse({ name: args.name })
      const folder = await folderChange(() =>
        updateFolder(userId, current.id, input)
      )
      return {
        structured: {
          folder: folderRow(
            folder,
            pathIn(folder.parentId, folder.name),
            origin
          ),
        },
      }
    }

    const parent =
      args.parent === undefined || args.parent.trim().toLowerCase() === NONE
        ? null
        : pickFolder(folders, args.parent)
    const input = folderInputSchema.parse({
      name: args.name,
      parentId: parent?.id ?? null,
    })
    const folder = await folderChange(() => createFolder(userId, input))
    setAuditTarget({ type: 'folder', id: folder.id, name: folder.name })
    return {
      structured: {
        folder: folderRow(folder, pathIn(folder.parentId, folder.name), origin),
      },
    }
  },
})

const deleteFolderTool = defineTool({
  name: 'delete_folder',
  description:
    'Remove a folder without deleting what is in it: its files and subfolders move up one level, into its parent folder or out of folders, and its public link stops working. The folder itself cannot be brought back. Refused while one of its subfolders has the same name as a folder one level up; rename one of the two with save_folder first.',
  input: z.object({
    folder: folderReference.describe('The folder path, name or ID'),
  }),
  output: z.object({
    id: z.string(),
    path: z.string().describe('The path the folder had'),
    contents_moved_to: z
      .string()
      .optional()
      .describe(
        'The parent folder its files and subfolders are in now; absent when they moved to the top level'
      ),
  }),
  async run(args, { principal }) {
    const userId = principal.user.id
    const folders = await accountFolders(userId)
    const folder = pickFolder(folders, args.folder)
    setAuditTarget({ type: 'folder', id: folder.id, name: folder.name })
    await folderChange(() => deleteFolder(userId, folder.id))
    return {
      structured: compact({
        id: folder.id,
        path: folder.path,
        contents_moved_to: folder.parentId
          ? folderPathMap(folders).get(folder.parentId)
          : undefined,
      }),
    }
  },
})

const setFolderSharing = defineTool({
  name: 'set_folder_sharing',
  description:
    "Create or revoke a folder's public link. Anyone with the link sees a page of the public files directly in the folder: not its subfolders or private files, and files with a password stay locked. Revoking stops the link at once, and sharing again makes a different link. The files' own links are not affected either way; change those with set_file_sharing.",
  input: z.object({
    folder: folderReference.describe('The folder path, name or ID'),
    shared: z
      .boolean()
      .describe(
        'true creates the link, or keeps the one the folder has; false revokes it'
      ),
  }),
  output: z.object({ folder: folderRowSchema }),
  async run(args, { principal, origin }) {
    const userId = principal.user.id
    const current = pickFolder(await accountFolders(userId), args.folder)
    setAuditTarget({ type: 'folder', id: current.id, name: current.name })
    const input = folderUpdateSchema.parse({ sharing: args.shared })
    const folder = await folderChange(() =>
      updateFolder(userId, current.id, input)
    )
    return { structured: { folder: folderRow(folder, current.path, origin) } }
  },
})

export const foldersTools = [
  listFolders,
  saveFolder,
  deleteFolderTool,
  setFolderSharing,
]
