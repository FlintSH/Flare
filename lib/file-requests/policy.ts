/** Shared by the file request API, the public request page, and the dashboard. No server imports. */
import { z } from 'zod'

export const FILE_REQUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/
export const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const FILE_REQUEST_TITLE_MAX = 100
export const FILE_REQUEST_MESSAGE_MAX = 1000
export const SENDER_NAME_MAX = 80
export const SENDER_NOTE_MAX = 500
/** Bounds accidental scripts. Closed, expired, and full requests do not count. */
export const MAX_OPEN_FILE_REQUESTS = 100
export const MAX_REQUEST_FILES = 10_000
export const MAX_REQUEST_BYTES = 10 * 1024 ** 4
/** S3 needs 5 MiB parts except the last; the dashboard uses the same size. */
export const MIN_PART_BYTES = 5 * 1024 * 1024
export const MAX_PART_BYTES = 64 * 1024 * 1024
export const MAX_PARTS = 10_000
/** At most one owner email per request in this window; later activity is batched. */
export const NOTIFICATION_INTERVAL_MS = 10 * 60 * 1000
/** File request emails one owner can receive per UTC day, across all requests. */
export const MAX_REQUEST_EMAILS_PER_DAY = 24
/** Files one sender's batch can have on the way at once. */
export const MAX_ACTIVE_UPLOADS_PER_BATCH = 3
/** Files on the way to one request at once, from every sender. */
export const MAX_ACTIVE_UPLOADS_PER_REQUEST = 20
/** A file on its way that sends no part for this long gives its room back. */
export const UPLOAD_RESERVATION_IDLE_MS = 10 * 60 * 1000

export const SENDER_NAME_MODES = ['off', 'optional', 'required'] as const
export type SenderNameMode = (typeof SENDER_NAME_MODES)[number]

export type FileRequestStatus =
  'open' | 'closed' | 'expired' | 'full' | 'paused'
/** `invalid` covers unknown, malformed, deleted, and replaced links. */
export type FileRequestLinkStatus = FileRequestStatus | 'invalid'

/** Shown to senders. Never reveals why the owner cannot receive files. */
export const FILE_REQUEST_LINK_MESSAGES: Record<
  Exclude<FileRequestLinkStatus, 'open'>,
  { title: string; description: string }
> = {
  invalid: {
    title: 'This link isn’t valid',
    description:
      'Check that you copied the whole link, or ask the person who sent it for a new one.',
  },
  closed: {
    title: 'This request is closed',
    description:
      'It no longer accepts files. Ask the person who sent it if you still need to send something.',
  },
  expired: {
    title: 'This request has expired',
    description:
      'It no longer accepts files. Ask the person who sent it for a new link.',
  },
  full: {
    title: 'This request is full',
    description:
      'It has received all the files it can accept. Ask the person who sent it for more room.',
  },
  paused: {
    title: 'This request can’t accept files right now',
    description:
      'Try again later, or let the person who sent you the link know.',
  },
}

export const FILE_REQUEST_EXPIRY_OPTIONS: readonly {
  hours: number | null
  label: string
}[] = [
  { hours: 24, label: '1 day' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
  { hours: 2160, label: '90 days' },
  { hours: null, label: 'Never' },
]

export const SENDER_NAME_LABELS: Record<SenderNameMode, string> = {
  off: 'Don’t ask',
  optional: 'Optional',
  required: 'Required',
}

export interface FileRequestView {
  id: string
  title: string
  message: string
  status: FileRequestStatus
  /** Why an open request cannot receive files. Shown only to its owner. */
  pausedReason: string | null
  token: string
  senderName: SenderNameMode
  profile: { id: string; name: string } | null
  folder: { id: string; name: string } | null
  maxFiles: number | null
  maxBytes: number | null
  fileCount: number
  bytesReceived: number
  expiresAt: string | null
  closedAt: string | null
  notify: boolean
  lastReceivedAt: string | null
  /** Files arrived after the owner last opened this request. */
  unseen: boolean
  createdAt: string
  updatedAt: string
}

export interface FileRequestFileView {
  id: string
  name: string
  sizeBytes: number
  mimeType: string
  urlPath: string
  uploadedAt: string
}

export interface FileRequestSubmissionView {
  id: string
  senderName: string
  note: string
  createdAt: string
  completedAt: string | null
  /** Delivered through this submission; some may have been deleted since. */
  fileCount: number
  bytes: number
  files: FileRequestFileView[]
}

export interface FileRequestPolicyView {
  canCreate: boolean
  openCount: number
  maxOpen: number
  /** The instance can send email and the owner has a verified address. */
  canNotify: boolean
}

/** Everything a sender needs before choosing files. */
export interface PublicFileRequestView {
  title: string
  message: string
  ownerName: string | null
  senderName: SenderNameMode
  maxFileBytes: number
  filesRemaining: number | null
  bytesRemaining: number | null
  expiresAt: string | null
}

const noControlCharacters = (value: string) =>
  !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)
const title = z
  .string()
  .trim()
  .min(1, 'Give the request a title.')
  .max(
    FILE_REQUEST_TITLE_MAX,
    `Titles can be at most ${FILE_REQUEST_TITLE_MAX} characters.`
  )
  .refine(
    (value) => noControlCharacters(value) && !value.includes('\n'),
    'Titles must be a single line of text.'
  )
const message = z
  .string()
  .trim()
  .max(
    FILE_REQUEST_MESSAGE_MAX,
    `Messages can be at most ${FILE_REQUEST_MESSAGE_MAX} characters.`
  )
  .refine(noControlCharacters, 'Messages can only contain text.')
const id = z.string().min(1).max(128)
const maxFiles = z
  .number()
  .int()
  .min(1, 'Allow at least one file.')
  .max(MAX_REQUEST_FILES, `Allow at most ${MAX_REQUEST_FILES} files.`)
  .nullable()
const maxBytes = z
  .number()
  .int()
  .min(1024 * 1024, 'Allow at least 1 MB.')
  .max(MAX_REQUEST_BYTES, 'Allow at most 10 TB.')
  .nullable()
const expiresInHours = z.number().int().min(1).max(8760).nullable()

export const fileRequestCreateSchema = z
  .object({
    title,
    message: message.default(''),
    senderName: z.enum(SENDER_NAME_MODES).default('optional'),
    profileId: id.nullable().default(null),
    folderId: id.nullable().default(null),
    maxFiles: maxFiles.default(null),
    maxBytes: maxBytes.default(null),
    expiresInHours: expiresInHours.default(168),
    notify: z.boolean().default(false),
  })
  .strict()
export type FileRequestCreateInput = z.infer<typeof fileRequestCreateSchema>

export const fileRequestUpdateSchema = z
  .object({
    title: title.optional(),
    message: message.optional(),
    senderName: z.enum(SENDER_NAME_MODES).optional(),
    profileId: id.nullable().optional(),
    folderId: id.nullable().optional(),
    maxFiles: maxFiles.optional(),
    maxBytes: maxBytes.optional(),
    /** Counted from now. Null removes the deadline. */
    expiresInHours: expiresInHours.optional(),
    notify: z.boolean().optional(),
    closed: z.boolean().optional(),
    /** Issue a new link. The old link stops working, including unfinished uploads. */
    replaceLink: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Change at least one field.'
  )
export type FileRequestUpdateInput = z.infer<typeof fileRequestUpdateSchema>

export const fileRequestListQuerySchema = z.object({
  status: z.enum(['open', 'ended', 'all']).default('all'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type FileRequestListQuery = z.infer<typeof fileRequestListQuerySchema>

export const submissionCreateSchema = z
  .object({
    senderName: z
      .string()
      .trim()
      .max(
        SENDER_NAME_MAX,
        `Names can be at most ${SENDER_NAME_MAX} characters.`
      )
      .refine(
        (value) => noControlCharacters(value) && !value.includes('\n'),
        'Names must be a single line of text.'
      )
      .default(''),
    note: z
      .string()
      .trim()
      .max(
        SENDER_NOTE_MAX,
        `Notes can be at most ${SENDER_NOTE_MAX} characters.`
      )
      .refine(noControlCharacters, 'Notes can only contain text.')
      .default(''),
  })
  .strict()
export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>

export const requestUploadInitSchema = z
  .object({
    submissionId: id,
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().positive('Empty files can’t be sent.'),
  })
  .strict()

type StatusInput = {
  closedAt: Date | string | null
  expiresAt: Date | string | null
  maxFiles: number | null
  fileCount: number
  maxBytes: number | bigint | null
  bytesReceived: number | bigint
}

/** Closed is an owner choice; expired and full end on their own. */
export function fileRequestStatus(
  request: StatusInput,
  now = new Date()
): Exclude<FileRequestStatus, 'paused'> {
  if (request.closedAt) return 'closed'
  if (request.expiresAt && new Date(request.expiresAt) <= now) return 'expired'
  if (request.maxFiles !== null && request.fileCount >= request.maxFiles)
    return 'full'
  if (
    request.maxBytes !== null &&
    Number(request.bytesReceived) >= Number(request.maxBytes)
  )
    return 'full'
  return 'open'
}

/** Parts stay within storage limits; huge files use larger parts, never more of them. */
export function requestPartSize(size: number) {
  return Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS))
}

export function fileRequestUrl(origin: string, token: string) {
  return new URL(`/r/${encodeURIComponent(token)}`, origin).toString()
}

export function formatRequestBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${Number(value.toFixed(value >= 10 ? 0 : 1))} ${units[unit]}`
}
