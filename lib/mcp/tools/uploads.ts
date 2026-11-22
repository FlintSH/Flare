import { fileTypeFromBuffer } from 'file-type'
import * as z from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { hashFilePassword } from '@/lib/files/password-hash'
import { FILE_PASSWORD_MIN_LENGTH } from '@/lib/files/password-policy'
import { uploadLimiter } from '@/lib/security/rate-limit'
import { uploadCapacity } from '@/lib/uploads/capacity'
import { directUpload } from '@/lib/uploads/direct'
import { uploadDisplayName } from '@/lib/uploads/display-name'
import { TYPE_CHECK_BYTES } from '@/lib/uploads/finalize'
import { resolveUploadOptions } from '@/lib/uploads/options'
import {
  PROFILE_TAG_LIMIT,
  type UploadRequestOptions,
} from '@/lib/uploads/schema'
import { isoDateTimeWithOffset } from '@/lib/utils/iso-datetime'

import type { AgentPrincipal } from '../auth'
import { compact, readableBytes } from '../results'
import { type ToolContext, ToolError, defineTool } from '../tool'
import { UPLOAD_MINUTES, createUploadUrl } from '../transfer'
import { NONE, accountFolders, pickFolder, pickTags } from './shared'

/** The most text one call carries, and the most binary data once decoded. */
const MAX_TEXT_BYTES = 256 * 1024
const MAX_BASE64_BYTES = 64 * 1024

const EXPIRATIONS = {
  hour: 'HOUR',
  day: 'DAY',
  week: 'WEEK',
  month: 'MONTH',
  never: 'DISABLED',
} as const

/**
 * A bare MIME type. The characters are held to what real types use, because
 * `create_upload_url` writes the value into a shell command.
 */
const mimeType = z
  .string()
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.+_-]*\/[A-Za-z0-9][A-Za-z0-9.+_-]*$/,
    'A MIME type looks like image/png, without parameters.'
  )

const filename = z.string().min(1).max(255)

/** What every upload tool lets the caller choose about the new file. */
const optionFields = {
  visibility: z
    .enum(['public', 'private'])
    .optional()
    .describe('Who can open the link; private means only the owner'),
  password: z
    .string()
    .max(200)
    .optional()
    .describe(
      `Ask visitors for this password, at least ${FILE_PASSWORD_MIN_LENGTH} characters`
    ),
  expires_at: z
    .string()
    .max(40)
    .optional()
    .describe(
      'When the file expires: an ISO 8601 time with offset, such as 2026-12-01T09:00:00Z'
    ),
  expires_in: z
    .enum(['hour', 'day', 'week', 'month', 'never'])
    .optional()
    .describe(
      'Expire this long after the upload, in place of `expires_at`; `never` turns off a default expiry'
    ),
  expiry_action: z
    .enum(['delete', 'make_private'])
    .optional()
    .describe('What happens when the file expires'),
  folder: z.string().max(1024).optional().describe('A folder path, name or ID'),
  tags: z
    .array(z.string().min(1).max(200))
    .max(PROFILE_TAG_LIMIT)
    .optional()
    .describe(`Tag names or IDs, up to ${PROFILE_TAG_LIMIT}`),
  profile: z
    .string()
    .max(100)
    .optional()
    .describe(
      'An upload profile ID or name from get_account, or "none" to use no profile'
    ),
}
type OptionArgs = z.infer<z.ZodObject<typeof optionFields>>

const DEFAULTS_NOTE =
  'Options left out follow the account defaults and its upload profile.'

/** The account's upload profile an argument names, by ID or by name; null for "none". */
async function pickProfile(
  userId: string,
  value: string
): Promise<string | null> {
  const wanted = value.trim()
  if (wanted.toLowerCase() === NONE) return null
  const profiles = await prisma.uploadProfile.findMany({
    where: { userId },
    select: { id: true, name: true },
  })
  const exact =
    profiles.find((profile) => profile.id === wanted) ??
    profiles.find((profile) => profile.name === wanted)
  if (exact) return exact.id
  // Names differ by case at most here; one match is what the caller meant.
  const named = profiles.filter(
    (profile) => profile.name.toLowerCase() === wanted.toLowerCase()
  )
  if (named.length === 1) return named[0].id
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

/**
 * The REST upload options a tool's arguments ask for. An option the caller
 * left out stays unset, so the account's defaults and the profile apply to it
 * exactly as they do over REST.
 */
async function uploadOptions(
  principal: AgentPrincipal,
  args: OptionArgs
): Promise<UploadRequestOptions> {
  if (args.expires_at && args.expires_in)
    throw new ToolError('Give `expires_at` or `expires_in`, not both.')
  // The upload code checks the same form; its answer does not say what it wants.
  if (
    args.expires_at &&
    !isoDateTimeWithOffset.safeParse(args.expires_at).success
  )
    throw new ToolError(
      '`expires_at` must be an ISO 8601 time with an offset, such as 2026-12-01T09:00:00Z.'
    )
  const userId = principal.user.id
  const options: UploadRequestOptions = {}
  if (args.visibility)
    options.visibility = args.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'
  if (args.password) options.password = args.password
  if (args.expires_at) options.expiresAt = args.expires_at
  if (args.expires_in) options.expiration = EXPIRATIONS[args.expires_in]
  if (args.expiry_action)
    options.expiryAction =
      args.expiry_action === 'delete' ? 'DELETE' : 'SET_PRIVATE'
  // Uploads go in no folder unless one is named, so "none" asks for nothing.
  if (args.folder && args.folder.trim().toLowerCase() !== NONE)
    options.folderId = pickFolder(await accountFolders(userId), args.folder).id
  if (args.tags?.length)
    options.tagIds = [
      ...new Set((await pickTags(userId, args.tags)).map((tag) => tag.id)),
    ]
  if (args.profile) options.profileId = await pickProfile(userId, args.profile)
  return options
}

/** The name a new file gets: its last path component, without control characters. */
function cleanName(value: string): string {
  const name = uploadDisplayName(value.trim())
  if (!name)
    throw new ToolError('`filename` must be a file name, such as notes.txt.')
  return name
}

/**
 * The type inline bytes are stored under when the caller names none.
 * Publication refuses a type the bytes contradict, so what the bytes are
 * recognized as wins. Text stays `text/plain` unless it is recognized as
 * another text format, such as XML: a few binary formats are recognized by
 * two or three letters, and prose must not become a broken image.
 */
async function inlineType(bytes: Uint8Array, isText: boolean): Promise<string> {
  const detected = (
    await fileTypeFromBuffer(bytes.subarray(0, TYPE_CHECK_BYTES))
  )?.mime
  if (!isText) return detected ?? 'application/octet-stream'
  return detected &&
    (detected.startsWith('text/') || detected === 'application/xml')
    ? detected
    : 'text/plain'
}

const tooLarge = (field: string, bytes: number, limit: number) =>
  new ToolError(
    `\`${field}\` is ${bytes} bytes; this tool takes up to ${limit} (${readableBytes(limit)}). For anything larger, call create_upload_url and run the curl command it returns.`
  )

function utf8(field: string, text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length > MAX_TEXT_BYTES)
    throw tooLarge(field, bytes.length, MAX_TEXT_BYTES)
  return bytes
}

function decodeBase64(value: string): Buffer {
  const packed = value.replace(/\s+/g, '')
  // Padding is cut by hand: a pattern for "ends in =" tries every run of `=`
  // in a long value, and the time that takes grows with its square.
  let end = packed.length
  while (end > 0 && packed[end - 1] === '=') end--
  const data = packed.slice(0, end)
  // Checked before decoding, which would silently skip what is not base64.
  if (!/^[A-Za-z0-9+/]*$/.test(data) || data.length % 4 === 1)
    throw new ToolError(
      '`base64` is not valid base64. Send standard base64, or call create_upload_url to upload the file from disk.'
    )
  // Four characters carry three bytes.
  const size = Math.floor((data.length * 3) / 4)
  if (size > MAX_BASE64_BYTES) throw tooLarge('base64', size, MAX_BASE64_BYTES)
  return Buffer.from(data, 'base64')
}

/** The address of the request built here; it is never fetched. */
const INTERNAL_UPLOAD_URL = 'http://flare.internal/api/files'

const uploadedFile = z.object({
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
 * Publishes bytes held in memory through the upload path every client uses,
 * as one multipart request that never leaves the process.
 */
async function publishInline(
  { principal, request }: ToolContext,
  upload: {
    bytes: Buffer
    name: string
    type: string
    options: UploadRequestOptions
    isPaste?: boolean
  }
): Promise<{ structured: z.infer<typeof uploadedFile> }> {
  try {
    await uploadLimiter.consume(principal.credentialKey)
  } catch {
    throw new ToolError(
      `Too many uploads: this connection may make ${uploadLimiter.points} a minute. Wait a minute, then continue.`,
      'denied'
    )
  }
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array(upload.bytes)], upload.name, { type: upload.type })
  )
  // Sent as bytes, not as the form's stream: an upload refused part way stops
  // reading, and an abandoned form stream rejects with nobody listening.
  const encoded = new Response(form)
  const file = await directUpload(
    new Request(INTERNAL_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': encoded.headers.get('content-type')! },
      body: await encoded.arrayBuffer(),
      signal: request.signal,
    }),
    principal.user,
    // The part's name is escaped in transit; the file gets this one as given.
    { options: upload.options, filename: upload.name, isPaste: upload.isPaste }
  )
  return {
    structured: {
      file: {
        id: file.id,
        name: file.name,
        type: file.type,
        size_bytes: file.size,
        url: file.pageUrl,
        raw_url: file.rawUrl,
        download_url: file.downloadUrl,
      },
    },
  }
}

const uploadFile = defineTool({
  name: 'upload_file',
  description: `Upload a small file whose contents are in this conversation: \`text\` up to ${readableBytes(MAX_TEXT_BYTES)}, or \`base64\` up to ${readableBytes(MAX_BASE64_BYTES)} for binary data. Returns the new file's ID and links. ${DEFAULTS_NOTE} For a file on disk, or anything larger, call create_upload_url instead, so the bytes do not pass through this conversation.`,
  input: z.object({
    filename,
    text: z.string().optional().describe('The contents as UTF-8 text'),
    base64: z
      .string()
      .optional()
      .describe('The contents as base64, in place of `text`'),
    mime_type: mimeType
      .optional()
      .describe(
        'Such as image/svg+xml or text/html. Without it, binary data is stored as what it is recognized as and text as text/plain'
      ),
    ...optionFields,
  }),
  output: uploadedFile,
  async run(args, context) {
    const text = args.text || undefined
    const base64 = args.base64 || undefined
    if (text && base64)
      throw new ToolError(
        'Give the contents as `text` or as `base64`, not both.'
      )
    if (!text && !base64)
      throw new ToolError(
        'Give the contents as `text`, or as `base64` for binary data.'
      )
    const name = cleanName(args.filename)
    const bytes = text ? utf8('text', text) : decodeBase64(base64!)
    return publishInline(context, {
      bytes,
      name,
      type:
        args.mime_type?.toLowerCase() ??
        (await inlineType(bytes, Boolean(text))),
      options: await uploadOptions(context.principal, args),
    })
  },
})

const createPaste = defineTool({
  name: 'create_paste',
  description: `Share text or code as a paste, up to ${readableBytes(MAX_TEXT_BYTES)}. The extension of \`filename\` picks the syntax highlighting, such as snippet.py. Returns the paste's ID and links. ${DEFAULTS_NOTE}`,
  input: z.object({
    content: z.string().min(1).describe('The text or code to share'),
    filename: filename.optional().describe('Default paste.txt'),
    ...optionFields,
  }),
  output: uploadedFile,
  async run(args, context) {
    if (!args.content.trim())
      throw new ToolError('`content` is empty. Give the text or code to share.')
    const bytes = utf8('content', args.content)
    return publishInline(context, {
      bytes,
      // What the paste page calls a paste nobody named.
      name: args.filename ? cleanName(args.filename) : 'paste.txt',
      type: await inlineType(bytes, true),
      options: await uploadOptions(context.principal, args),
      isPaste: true,
    })
  },
})

/**
 * What an address may hold inside double quotes in a shell command without
 * the shell reading any of it: URL characters, less `!` and `$`.
 */
const SHELL_PLAIN = /^[A-Za-z0-9\-._~:/?#[\]@%&'()*+,;=]+$/

const createUploadUrlTool = defineTool({
  name: 'create_upload_url',
  description: `Get a one-time URL that uploads a file from disk, of any size the account allows, without its bytes passing through this conversation. The options are fixed now and the upload cannot change them. ${DEFAULTS_NOTE} Replace /path/to/file in the returned \`curl\` command with the file's path and run it once: the URL takes one upload and expires in ${UPLOAD_MINUTES} minutes. The command prints JSON with the new file's ID and links; an upload that fails can be retried with the same command until the URL expires. Flare works out the file's type from its bytes; pass \`mime_type\` only to state it yourself.`,
  input: z.object({
    filename: filename
      .optional()
      .describe('The name the file gets, in place of its name on disk'),
    mime_type: mimeType
      .optional()
      .describe('The type of the file, such as video/mp4 or application/zip'),
    ...optionFields,
  }),
  output: z.object({
    upload_url: z.string(),
    expires_at: z.string().describe('When the URL stops taking an upload'),
    max_file_bytes: z
      .number()
      .describe(
        'The largest file this upload takes: the instance limit, or what the storage quota has left'
      ),
    curl: z
      .string()
      .describe('Run once, with /path/to/file replaced by the file to upload'),
  }),
  async run(args, { principal, origin }) {
    // The rest of the URL is a fixed path and a base64url secret.
    if (!SHELL_PLAIN.test(origin))
      throw new ToolError(
        'The address of this Flare instance holds characters that are not safe in a shell command. Ask its administrator to check the address it is served under.'
      )
    const name = args.filename ? cleanName(args.filename) : undefined
    const requested = await uploadOptions(principal, args)
    // Refused now, not when the file arrives: a folder, tag or profile that is
    // not the account's, a password the policy rejects, an expiry in the past.
    const resolved = await resolveUploadOptions(principal.user, requested)
    // What the URL fixes is everything the upload will use, the account's
    // defaults and its profile's settings included, as they stand now. A
    // profile made public a minute later cannot publish a file this URL was
    // meant to keep private. A token bound to a profile is the exception: its
    // uploads always follow that profile as it is when they happen, and it
    // may not state the profile's settings itself.
    const fixed: typeof requested = principal.user.apiToken?.profileId
      ? requested
      : {
          ...requested,
          visibility: resolved.visibility,
          expiration: resolved.expiration,
          expiryAction: resolved.expiryAction,
          randomizeFileUrls: resolved.randomizeFileUrls,
          shareStyle: resolved.shareStyle,
          tagIds: resolved.tagIds,
          profileId: resolved.profileId,
          folderId: resolved.folderId ?? null,
          // A time the caller stated is already in `requested`. A length of
          // time, such as a week, stays a length, so it is counted from the
          // upload and not from the making of this URL.
        }
    const capacity = uploadCapacity(
      await getConfig(),
      principal.user,
      principal.user.storageUsed
    )
    if (capacity.quotaBytes <= 0)
      throw new ToolError(
        'The storage quota of this account is used up, so nothing can be uploaded. Delete files to make room, or ask an administrator for more.'
      )
    // Only the hash the file will carry is kept; the password is not.
    const { password, ...options } = fixed
    const passwordHash = await hashFilePassword(password)
    const { url, expires_at } = await createUploadUrl(
      principal,
      origin,
      compact({
        filename: name,
        options,
        passwordHash: passwordHash ?? undefined,
      })
    )
    const type = args.mime_type ? `;type=${args.mime_type.toLowerCase()}` : ''
    return {
      structured: {
        upload_url: url,
        expires_at,
        max_file_bytes: Math.floor(
          Math.min(capacity.fileBytes, capacity.quotaBytes)
        ),
        curl: `curl -sS -F "file=@/path/to/file${type}" "${url}"`,
      },
    }
  },
})

export const uploadsTools = [uploadFile, createPaste, createUploadUrlTool]
