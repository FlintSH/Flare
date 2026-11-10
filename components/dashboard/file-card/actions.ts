import {
  Archive,
  ArrowUpRight,
  Download,
  Eye,
  FolderInput,
  KeyRound,
  Link as LinkIcon,
  type LucideIcon,
  ScanText,
  ShieldCheck,
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
  /** The button over the preview: its tooltip and its accessible name. */
  button?: { title: string; label: (name: string) => string }
  /** The selection bar's button. */
  batch?: string
}

/** Every action the library offers on files, with what each needs. */
export const FILE_ACTIONS = {
  browseArchive: { icon: Archive, needs: 'viewFiles', menu: 'Browse archive' },
  open: { icon: ArrowUpRight, menu: 'Open file' },
  copyLink: {
    icon: LinkIcon,
    needs: 'shareFiles',
    menu: 'Copy link',
    button: { title: 'Copy link', label: (name) => `Copy link to ${name}` },
  },
  download: {
    icon: Download,
    menu: 'Download file',
    button: { title: 'Download', label: (name) => `Download ${name}` },
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
    button: {
      title: 'Change visibility',
      label: (name) => `Change visibility of ${name}`,
    },
  },
  password: {
    icon: KeyRound,
    needs: 'shareFiles',
    menu: ({ hasPassword }) =>
      hasPassword ? 'Manage password' : 'Add password',
    button: {
      title: 'Password protection',
      label: (name) => `Password protection for ${name}`,
    },
  },
  // A plain file from before encryption, or from a tool that cannot
  // encrypt: the server encrypts it for its owner (docs/e2ee-spec.md,
  // section 14.2).
  encrypt: {
    icon: ShieldCheck,
    needs: 'viewFiles',
    menu: 'Encrypt',
    batch: 'Encrypt',
  },
  expiration: {
    icon: Timer,
    needs: 'manageExpiration',
    menu: 'Manage expiration',
    button: {
      title: 'Manage expiration',
      label: (name) => `Manage expiration of ${name}`,
    },
  },
  ocr: {
    icon: ScanText,
    menu: ({ busy }) => (busy ? 'Extracting text…' : 'Extract text (OCR)'),
    button: {
      title: 'Extract text (OCR)',
      label: (name) => `Extract text from ${name}`,
    },
  },
  delete: {
    icon: Trash2,
    needs: 'deleteFiles',
    menu: 'Delete file',
    button: { title: 'Delete', label: (name) => `Delete ${name}` },
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

/** The buttons over a card's preview, in order. */
export const CARD_BUTTONS = [
  'copyLink',
  'download',
  'visibility',
  'password',
  'ocr',
  'expiration',
  'delete',
] as const satisfies readonly FileActionId[]

/** The card menu's groups, in order. */
export const CARD_MENU = [
  ['browseArchive', 'open', 'copyLink', 'download'],
  [
    'editTags',
    'move',
    'visibility',
    'password',
    'encrypt',
    'expiration',
    'ocr',
  ],
  ['delete'],
] as const satisfies readonly (readonly FileActionId[])[]

/** The selection bar's actions, in order. Select is available when one is. */
export const BATCH_ACTIONS = [
  'createArchive',
  'move',
  'editTags',
  'encrypt',
] as const satisfies readonly FileActionId[]
export type BatchAction = (typeof BATCH_ACTIONS)[number]
