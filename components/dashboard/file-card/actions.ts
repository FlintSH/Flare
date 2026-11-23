import {
  Archive,
  Download,
  Eye,
  FolderInput,
  KeyRound,
  Link as LinkIcon,
  type LucideIcon,
  ScanText,
  Tag,
  Timer,
  Trash2,
} from 'lucide-react'

import { type Action, allows } from '@/lib/permissions/actions'
import type { PermissionSubject } from '@/lib/permissions/catalog'

export interface FileActionDescriptor {
  icon: LucideIcon
  /** The permission-table action it needs; none when seeing the file is enough. */
  needs?: Action
  /** The file menu's item. */
  menu?: string | ((state: { hasPassword: boolean; busy: boolean }) => string)
  /** The selection bar's button. */
  batch?: string
}

/** Every action the library offers on files, with what each needs. */
export const FILE_ACTIONS = {
  browseArchive: { icon: Archive, needs: 'viewFiles', menu: 'Browse archive' },
  copyLink: {
    icon: LinkIcon,
    needs: 'shareFiles',
    menu: 'Copy link',
  },
  download: {
    icon: Download,
    menu: 'Download file',
  },
  editTags: {
    icon: Tag,
    needs: 'tagFiles',
    menu: 'Edit tags',
    batch: 'Edit tags',
  },
  move: {
    icon: FolderInput,
    needs: 'moveFiles',
    menu: 'Move to folder',
    batch: 'Move',
  },
  visibility: {
    icon: Eye,
    needs: 'shareFiles',
    menu: 'Change visibility',
  },
  password: {
    icon: KeyRound,
    needs: 'shareFiles',
    menu: ({ hasPassword }) =>
      hasPassword ? 'Manage password' : 'Add password',
  },
  expiration: {
    icon: Timer,
    needs: 'manageExpiration',
    menu: 'Manage expiration',
  },
  ocr: {
    icon: ScanText,
    menu: ({ busy }) => (busy ? 'Extracting text…' : 'Extract text (OCR)'),
  },
  delete: {
    icon: Trash2,
    needs: 'deleteFiles',
    menu: 'Delete file',
  },
  createArchive: {
    icon: Archive,
    needs: 'createArchive',
    batch: 'Create archive',
  },
} satisfies Record<string, FileActionDescriptor>

export type FileActionId = keyof typeof FILE_ACTIONS

export function fileActionAllowed(
  subject: PermissionSubject | null | undefined,
  id: FileActionId
): boolean {
  const { needs } = FILE_ACTIONS[id] as FileActionDescriptor
  return !needs || allows(subject, needs)
}

/**
 * The card menu's groups, in order: the quick things. Everything about the
 * file itself (who can open it, password, expiry, folder, tags, text in
 * images) is in its sheet, which a click on the card opens.
 */
export const CARD_MENU = [
  ['browseArchive', 'copyLink', 'download'],
  ['delete'],
] as const satisfies readonly (readonly FileActionId[])[]

/** The selection bar's actions, in order. Select is available when one is. */
export const BATCH_ACTIONS = [
  'createArchive',
  'move',
  'editTags',
] as const satisfies readonly FileActionId[]
export type BatchAction = (typeof BATCH_ACTIONS)[number]
