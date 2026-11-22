import type { Prisma } from '@prisma/client'
import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { imageType } from '@/lib/customization/image'
import { savePersonalAppearance } from '@/lib/customization/personal'
import {
  personalAppearanceSchema,
  readPersonalAppearance,
} from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { personalEmbedsAllowed, savePersonalEmbed } from '@/lib/embeds/personal'
import {
  EMBED_LIMITS,
  EMBED_MODES,
  type PersonalEmbed,
  personalEmbedSchema,
  readPersonalEmbed,
} from '@/lib/embeds/schema'
import { EMBED_PLACEHOLDERS } from '@/lib/embeds/template'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'
import { AVATAR_POLICY } from '@/lib/storage/avatar-policy'
import type { ProfileCheck } from '@/lib/uploads/profiles'
import { removeOwnAvatar, uploadAvatar } from '@/lib/users/avatar'
import {
  accountToEdit,
  profileSettingsSchema,
  updateProfileSettings,
} from '@/lib/users/profile'
import {
  VANITY_ID_MAX_LENGTH,
  VANITY_ID_MIN_LENGTH,
} from '@/lib/users/public-id'
import { formatBytes } from '@/lib/utils/size'

import type { AgentPrincipal } from '../auth'
import { compact } from '../results'
import { type ToolContext, ToolError, defineTool } from '../tool'
import {
  type UploadEffects,
  type UploadState,
  uploadCheck,
} from '../upload-guard'
import {
  fileReference,
  ownFile,
  sentence,
  serviceInput,
  sizeBytes,
} from './shared'

const logger = loggers.api

export const EXPIRY = {
  never: 'DISABLED',
  hour: 'HOUR',
  day: 'DAY',
  week: 'WEEK',
  month: 'MONTH',
} as const
export const EXPIRY_ACTION = {
  delete: 'DELETE',
  make_private: 'SET_PRIVATE',
} as const

export const expiry = z.enum(['never', 'hour', 'day', 'week', 'month'])
export const expiryAction = z.enum(['delete', 'make_private'])
const themeMode = personalAppearanceSchema.shape.themeMode.unwrap()

/** The tool's word for a stored value, such as `week` for `WEEK`. */
export function wordFor<Word extends string>(
  words: Record<Word, string>,
  stored: string
): Word {
  return (Object.keys(words) as Word[]).find((word) => words[word] === stored)!
}

const named = (values: readonly string[]) =>
  values.map((value) => `\`${value}\``).join(', ')

/**
 * The upload profile a named token is bound to, as a refusal names it, or
 * null. Such a token uploads with settings it did not choose, so no tool lets
 * it change what decides how uploads behave.
 */
export async function boundProfile({
  user,
}: AgentPrincipal): Promise<string | null> {
  const id = user.apiToken?.profileId
  if (!id) return null
  const profile = await prisma.uploadProfile.findFirst({
    where: { id, userId: user.id },
    select: { name: true },
  })
  // A profile deleted since has only its ID left to go by.
  return profile ? `"${profile.name}"` : id
}

export const UNBOUND = 'a connection that is not bound to a profile'

// ---------------------------------------------------------------------------
// update_profile
// ---------------------------------------------------------------------------

/** The longest display name a call may set; the profile page has no limit. */
const NAME_MAX_LENGTH = 200

const AVATAR_RULE = `An avatar is a PNG, JPEG, GIF or WebP image of at most ${formatBytes(AVATAR_POLICY.maxBytes)}.`

const PLACEHOLDERS = EMBED_PLACEHOLDERS.map(({ key }) => `{{${key}}}`).join(
  ', '
)

/** The embed settings as the tool names them, beside the fields they save. */
const EMBED_FIELDS = {
  mode: 'mode',
  design: 'design',
  site_name: 'siteName',
  author: 'author',
  title: 'title',
  description: 'description',
  color: 'color',
} as const satisfies Record<string, keyof PersonalEmbed>
type EmbedArgument = keyof typeof EMBED_FIELDS

/** An embed as the embed route reads it, refused in the tool's own words. */
const checkedEmbed = (embed: object): PersonalEmbed =>
  serviceInput(
    personalEmbedSchema,
    embed,
    Object.fromEntries(
      Object.entries(EMBED_FIELDS).map(([argument, field]) => [
        field,
        `embed.${argument}`,
      ])
    )
  )

const embedLine = (limit: number, what: string) =>
  z.string().max(limit).optional().describe(what)

const embedInput = z.strictObject({
  mode: z
    .enum(['inherit', ...EMBED_MODES])
    .optional()
    .describe(
      '`direct` shows an image or video on its own where the app can, `rich` always shows the card, `inherit` follows the instance'
    ),
  design: z
    .enum(['inherit', 'custom'])
    .optional()
    .describe(
      "`custom` replaces the instance's card with the lines below; `inherit` uses the instance's card"
    ),
  site_name: embedLine(EMBED_LIMITS.siteName, 'The small line above the title'),
  author: embedLine(EMBED_LIMITS.author, 'The author line'),
  title: embedLine(EMBED_LIMITS.title, 'The title line'),
  description: embedLine(EMBED_LIMITS.description, 'The text under the title'),
  color: z
    .string()
    .max(7)
    .optional()
    .describe("The card's accent as #rrggbb, or empty for the app's own"),
})

const embedOutput = z.object({
  mode: z.enum(['inherit', ...EMBED_MODES]),
  design: z.enum(['inherit', 'custom']),
  site_name: z.string().optional(),
  author: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
})

function embedRow(embed: PersonalEmbed): z.infer<typeof embedOutput> {
  // An empty line is one the card leaves off.
  return compact({
    mode: embed.mode,
    design: embed.design,
    site_name: embed.siteName || undefined,
    author: embed.author || undefined,
    title: embed.title || undefined,
    description: embed.description || undefined,
    color: embed.color || undefined,
  })
}

/** The image a call chose as the avatar, read, and the last check on it. */
type AvatarSource = {
  bytes: Buffer
  /**
   * Run in the transaction that publishes the avatar, before the call's own
   * `recheck`: the file as it is now. Its row is held to the commit, so the
   * owner hiding it either committed before this read or waits for it.
   */
  stillShareable(tx: Prisma.TransactionClient): Promise<void>
}

/**
 * The bytes of the account's own image that is to become its avatar. The
 * recorded type and size are checked before anything is read, and no more is
 * read than an avatar may hold. An avatar is served to everyone, so a file
 * that is not is only copied for a connection that may change sharing. That
 * is asked as the call starts and again when the avatar is published,
 * because reading the file takes time in which its owner can hide it.
 */
async function avatarImage(
  { principal, request, requireEffect }: ToolContext,
  reference: string
): Promise<AvatarSource> {
  const file = await ownFile(principal, reference, {
    id: true,
    userId: true,
    name: true,
    mimeType: true,
    size: true,
    path: true,
    visibility: true,
    password: true,
  })
  const { types, maxBytes } = AVATAR_POLICY
  if (!(types as readonly string[]).includes(file.mimeType))
    throw new ToolError(
      `"${file.name}" is ${file.mimeType}, which cannot be an avatar. ${AVATAR_RULE}`
    )
  const tooLarge = (size: string) =>
    new ToolError(
      `"${file.name}" is ${size}, which is too large for an avatar. ${AVATAR_RULE}`
    )
  const recorded = sizeBytes(file.size)
  if (recorded > maxBytes) throw tooLarge(`${recorded} bytes`)
  const notAnImage = new ToolError(
    `"${file.name}" is stored as ${file.mimeType}, but its contents are not such an image. ${AVATAR_RULE}`
  )
  if (!recorded) throw notAnImage
  /** Requires what copying a hidden file needs; a file anyone can open needs nothing. */
  const requireShareable = (
    now: { visibility: string; password: string | null },
    suffix = ''
  ) => {
    const hidden =
      now.visibility !== 'PUBLIC'
        ? 'private'
        : now.password
          ? 'protected by a password'
          : null
    if (!hidden) return
    try {
      requireEffect('avatar_private_file')
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      throw new ToolError(
        `"${file.name}" is ${hidden}, and an avatar is visible to anyone, so making it the avatar needs Change sharing. An image that is public and has no password does not. ${error.message}${suffix}`,
        'denied'
      )
    }
  }
  requireShareable(file)
  const stillShareable = async (tx: Prisma.TransactionClient) => {
    // A row somebody is changing or deleting is passed over, never waited
    // for: this transaction holds the account's row, which a deletion asks
    // for after the file's.
    const [now] = await tx.$queryRaw<
      { visibility: string; password: string | null }[]
    >`
      SELECT "visibility"::text AS "visibility", "password" FROM "File"
      WHERE "id" = ${file.id} AND "userId" = ${file.userId}
      FOR SHARE SKIP LOCKED
    `
    if (!now)
      throw new ToolError(
        `"${file.name}" was deleted or is being changed right now, so it was not made the avatar. Call again if it should still be.`
      )
    requireShareable(now, ' It was hidden while the call was running.')
  }
  const storage = await getStorageProvider()
  const chunks: Buffer[] = []
  let read = 0
  // One byte past the limit shows a file larger than its recorded size.
  for await (const chunk of await storage.getFileStream(
    file.path,
    { start: 0, end: maxBytes },
    request.signal
  )) {
    chunks.push(Buffer.from(chunk))
    read += chunk.length
    if (read > maxBytes) throw tooLarge(`over ${maxBytes} bytes in storage`)
  }
  const bytes = Buffer.concat(chunks)
  // The recorded type is what the uploader said; the bytes decide.
  const type = imageType(bytes)
  if (!type || !types.includes(type)) throw notAnImage
  return { bytes, stillShareable }
}

/** One of the services a call's changes go to, with the arguments it saves. */
type Step = { saves: string[]; apply: () => Promise<unknown> }

/**
 * Applies a call's changes one service after another. Each service saves its
 * own part or nothing, so a failure says which arguments were saved before it
 * and which were not, and the caller can send only the rest again.
 */
async function applyInOrder(steps: readonly Step[]) {
  const saved: string[] = []
  for (const [index, step] of steps.entries()) {
    try {
      await step.apply()
    } catch (error) {
      // The services word their refusals for the person calling them, and
      // the checks they run for the tool word theirs for the agent.
      const checked = error instanceof ToolError ? error : null
      const refusal = error instanceof HttpError ? error : null
      if (!checked && (!refusal || refusal.status >= 500))
        logger.error('MCP tool update_profile failed', error as Error)
      const reason =
        checked || refusal
          ? sentence((checked ?? refusal)!.message)
          : `Flare could not save ${named(step.saves)}.`
      const denied =
        checked?.outcome === 'denied' ||
        refusal?.status === 401 ||
        refusal?.status === 403
      const unsaved = steps.slice(index).flatMap(({ saves }) => saves)
      throw new ToolError(
        saved.length
          ? `${reason} Saved before that: ${named(saved)}. Not saved: ${named(unsaved)}. Call again with only what was not saved.`
          : `${reason} Nothing was changed.`,
        denied ? 'denied' : 'failure'
      )
    }
    saved.push(...step.saves)
  }
}

/** The account's settings, as `update_profile` and `get_account` answer them. */
export const accountSettingsSchema = z.object({
  name: z.string().optional(),
  vanity_id: z.string().optional().describe('Absent when the account has none'),
  randomize_file_urls: z.boolean(),
  default_expiry: expiry,
  default_expiry_action: expiryAction.describe(
    'What a default expiry does; it has no effect while `default_expiry` is never'
  ),
  theme_mode: themeMode,
  embed: embedOutput,
  personal_embeds: z
    .boolean()
    .describe(
      'Whether this instance lets accounts choose their own embed. When false, `embed` is not used and cannot be changed'
    ),
  avatar_url: z.string().optional().describe('Absent without an avatar'),
})
export type AccountSettings = z.infer<typeof accountSettingsSchema>

/** The account's settings as they stand; null for an account that is gone. */
export async function readAccountSettings(
  userId: string,
  origin: string
): Promise<AccountSettings | null> {
  const [account, embedsAllowed] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        vanityId: true,
        randomizeFileUrls: true,
        defaultFileExpiration: true,
        defaultFileExpirationAction: true,
        image: true,
        preferences: true,
      },
    }),
    personalEmbedsAllowed(),
  ])
  if (!account) return null
  return compact({
    name: account.name ?? undefined,
    vanity_id: account.vanityId ?? undefined,
    randomize_file_urls: account.randomizeFileUrls,
    default_expiry: wordFor(EXPIRY, account.defaultFileExpiration),
    default_expiry_action: wordFor(
      EXPIRY_ACTION,
      account.defaultFileExpirationAction
    ),
    theme_mode: readPersonalAppearance(account.preferences).themeMode,
    embed: embedRow(readPersonalEmbed(account.preferences)),
    personal_embeds: embedsAllowed,
    // A stored avatar is addressed under this instance; one from a sign-in
    // provider or object storage is a full URL already.
    avatar_url: account.image
      ? account.image.startsWith('/')
        ? `${origin}${account.image}`
        : account.image
      : undefined,
  })
}

const BOUND_CANNOT_SET = 'A token bound to an upload profile cannot set this'
/**
 * What a change to an expiry needs: what it does to every way of uploading,
 * with each profile or none, counting what profiles take from the account.
 * An upload can bring an expiry and take the saved action, or name an action
 * and take the saved length, so each half is judged for itself.
 */
export const EXPIRY_NEEDS =
  'A length that is new for uploads with any profile or none, a profile taking what it leaves out from the account, needs a connection that may delete files and may change sharing: an upload can name either action itself and then takes this length'
export const ACTION_NEEDS =
  '`delete` needs a connection that may delete files and `make_private` one that may change sharing'

type StoredAction = (typeof EXPIRY_ACTION)[keyof typeof EXPIRY_ACTION]

/**
 * The effects of each tool that judge what a change does to later uploads.
 * The account has no visibility of its own, so `update_profile` cannot make
 * uploads public and names no effect for it.
 */
const DEFAULT_EXPIRY_EFFECTS = {
  DELETE: 'default_expiry_delete',
  SET_PRIVATE: 'default_expiry_make_private',
} as const satisfies UploadEffects
export const PROFILE_EFFECTS = {
  DELETE: 'expiry_delete',
  SET_PRIVATE: 'expiry_make_private',
  PUBLIC: 'visibility_public',
} as const satisfies UploadEffects

/**
 * Refuses a call that names an expiry action without that action's effect,
 * whether or not a length applies yet. The action is saved either way, and a
 * length set later by another call or by the owner would switch it on.
 */
export function requireNamedAction(
  { requireEffect }: ToolContext,
  effects: Record<StoredAction, string>,
  action: keyof typeof EXPIRY_ACTION | null | undefined
) {
  if (action) requireEffect(effects[EXPIRY_ACTION[action]])
}

/**
 * The check a service runs, with the account's row locked, on what `change`
 * does to every later upload of the account.
 */
export async function uploadProof(
  context: ToolContext,
  effects: UploadEffects,
  change: (state: UploadState) => UploadState
): Promise<ProfileCheck> {
  return uploadCheck(context, effects, await getConfig(), change)
}

/**
 * What a service that saves upload profiles runs before it writes: the
 * `uploadProof` of the change, which can require an effect, and then the
 * call's last check, which asks for all of them as things are now.
 */
export async function profileProof(
  context: ToolContext,
  change: (state: UploadState) => UploadState
): Promise<ProfileCheck> {
  const proof = await uploadProof(context, PROFILE_EFFECTS, change)
  return async (tx) => {
    await proof(tx)
    try {
      await context.recheck(tx)
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      // One transaction saves all of a profile call, so that is all of it.
      throw new ToolError(
        `${error.message} Nothing was changed.`,
        error.outcome
      )
    }
  }
}

/** What decides how uploads behave, which a token bound to a profile may not set. */
const UPLOAD_DEFAULT_ARGUMENTS = [
  'randomize_file_urls',
  'default_expiry',
  'default_expiry_action',
] as const

const updateProfileTool = defineTool({
  name: 'update_profile',
  description: `Change this account's own settings: display name, vanity ID, upload defaults, theme, link embed and avatar. Arguments left out stay as they are. Changing or removing the vanity ID breaks links that use the old one, a default expiry deletes or makes private every later upload that sets none, and the avatar is public. The email address, the password, passkeys and everything else about signing in cannot be changed here: the owner does that on Flare's Profile page. Everything is checked before anything is saved; if a part still fails to save, the error says what was saved and what was not. get_account reads the current values.`,
  input: z.strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(NAME_MAX_LENGTH)
      .optional()
      .describe('The display name'),
    vanity_id: z
      .string()
      .max(64)
      .nullable()
      .optional()
      .describe(
        `A second address for the account's share links, /vanity_id/filename: ${VANITY_ID_MIN_LENGTH} to ${VANITY_ID_MAX_LENGTH} letters, digits and inner hyphens, not used by another account. null removes it`
      ),
    randomize_file_urls: z
      .boolean()
      .optional()
      .describe(
        `Give later uploads random names in their links. ${BOUND_CANNOT_SET}`
      ),
    default_expiry: expiry
      .optional()
      .describe(
        `How long later uploads last when they set no expiry. \`never\` turns the default off and needs nothing more. ${EXPIRY_NEEDS}. ${BOUND_CANNOT_SET}`
      ),
    default_expiry_action: expiryAction
      .optional()
      .describe(
        `What happens to an upload when its default expiry runs out: it is deleted permanently, or made private. ${ACTION_NEEDS}, also while the default is off. ${BOUND_CANNOT_SET}`
      ),
    theme_mode: themeMode
      .optional()
      .describe('`inherit` follows the instance; `system` follows the device'),
    embed: embedInput
      .optional()
      .describe(
        `How the account's links preview in chat apps. Fields left out stay as saved, and an empty string clears a line. The lines may use ${PLACEHOLDERS}. Refused on an instance that uses one embed for every account`
      ),
    avatar_file: fileReference
      .nullable()
      .optional()
      .describe(
        `An image among this account's files to copy as the avatar: its ID, share URL or /user/name path. null removes the avatar. ${AVATAR_RULE} The avatar is public, so choosing one needs a connection that may read file contents, and for a file that is private or has a password one that may change sharing too`
      ),
  }),
  output: accountSettingsSchema,
  async run(args, context) {
    const { principal, origin, requireEffect, recheck } = context
    const userId = principal.user.id
    const given = (Object.keys(args) as (keyof typeof args)[]).filter(
      (key) => args[key] !== undefined
    )
    if (!given.length)
      throw new ToolError(
        'Nothing to change. Give at least one of `name`, `vanity_id`, `randomize_file_urls`, `default_expiry`, `default_expiry_action`, `theme_mode`, `embed` or `avatar_file`.'
      )
    setAuditTarget({
      type: 'user',
      id: userId,
      name: principal.name ?? undefined,
    })

    // Every refusal comes before the first change, so a denied or invalid
    // call leaves the account as it was.
    if (args.theme_mode !== undefined) requireEffect('theme_mode')
    if (args.embed !== undefined) requireEffect('embed')
    // Choosing an avatar reads a file; removing one reads nothing.
    if (typeof args.avatar_file === 'string') requireEffect('avatar_file')
    const defaults = UPLOAD_DEFAULT_ARGUMENTS.filter(
      (argument) => args[argument] !== undefined
    )
    const bound = defaults.length ? await boundProfile(principal) : null
    if (bound)
      throw new ToolError(
        `This token is bound to the upload profile ${bound}, so it cannot change ${named(defaults)}, which ${defaults.length > 1 ? 'decide' : 'decides'} how uploads behave. Leave ${defaults.length > 1 ? 'them' : 'it'} out, or use ${UNBOUND}.`,
        'denied'
      )
    requireNamedAction(
      context,
      DEFAULT_EXPIRY_EFFECTS,
      args.default_expiry_action
    )
    const account = await accountToEdit(userId)

    const settings = serviceInput(
      profileSettingsSchema,
      {
        name: args.name,
        vanityId: args.vanity_id,
        randomizeFileUrls: args.randomize_file_urls,
        defaultFileExpiration:
          args.default_expiry && EXPIRY[args.default_expiry],
        defaultFileExpirationAction:
          args.default_expiry_action &&
          EXPIRY_ACTION[args.default_expiry_action],
      },
      { name: 'name', vanityId: 'vanity_id' }
    )
    // What the new defaults do to every upload is judged once the account
    // row is locked, against the profiles as they then stand.
    const expiryChanged =
      settings.defaultFileExpiration || settings.defaultFileExpirationAction
    const check = expiryChanged
      ? await uploadProof(context, DEFAULT_EXPIRY_EFFECTS, (state) => ({
          ...state,
          account: {
            ...state.account,
            defaultFileExpiration:
              settings.defaultFileExpiration ??
              state.account.defaultFileExpiration,
            defaultFileExpirationAction:
              settings.defaultFileExpirationAction ??
              state.account.defaultFileExpirationAction,
          },
        }))
      : undefined

    let embed: Partial<PersonalEmbed> | undefined
    if (args.embed !== undefined) {
      if (!(await personalEmbedsAllowed()))
        throw new ToolError(
          'This instance uses one embed for every account, so `embed` cannot be changed. Leave `embed` out; an administrator can allow personal embeds in the instance appearance settings.',
          'denied'
        )
      embed = Object.fromEntries(
        (Object.keys(EMBED_FIELDS) as EmbedArgument[])
          .filter((argument) => args.embed![argument] !== undefined)
          .map((argument) => [EMBED_FIELDS[argument], args.embed![argument]])
      )
      // Checked here against the embed as read, so a bad line is refused
      // before anything is saved; saved below onto the embed as it stands.
      checkedEmbed({ ...readPersonalEmbed(account.preferences), ...embed })
    }

    const avatar =
      typeof args.avatar_file === 'string'
        ? await avatarImage(context, args.avatar_file)
        : args.avatar_file

    const settingsGiven = given.filter((key) =>
      [
        'name',
        'vanity_id',
        'randomize_file_urls',
        'default_expiry',
        'default_expiry_action',
      ].includes(key)
    )
    const steps: Step[] = []
    // Every service is handed the call's last check, which it runs in its
    // own transaction before it writes: the call may have waited, and its
    // access is judged again where the change takes effect. A check that
    // can require a further effect goes first, so the last check covers it.
    //
    // First what is most likely to be refused late: a vanity ID is only
    // known to be free once it is claimed.
    if (settingsGiven.length)
      steps.push({
        saves: settingsGiven,
        apply: () =>
          updateProfileSettings(account, settings, async (_account, tx) => {
            await check?.(tx)
            await recheck(tx)
          }),
      })
    if (avatar !== undefined)
      steps.push({
        saves: ['avatar_file'],
        apply: () =>
          avatar === null
            ? removeOwnAvatar(userId, recheck)
            : uploadAvatar(userId, avatar.bytes, async (tx) => {
                await avatar.stillShareable(tx)
                await recheck(tx)
              }),
      })
    if (args.theme_mode !== undefined)
      steps.push({
        saves: ['theme_mode'],
        apply: () =>
          savePersonalAppearance(
            userId,
            { themeMode: args.theme_mode! },
            recheck
          ),
      })
    if (embed)
      steps.push({
        saves: ['embed'],
        apply: () =>
          savePersonalEmbed(
            userId,
            (current) => checkedEmbed({ ...current, ...embed }),
            recheck
          ),
      })
    await applyInOrder(steps)

    const settled = await readAccountSettings(userId, origin)
    if (!settled)
      throw new ToolError(
        'The account no longer exists, so its settings cannot be read back.'
      )
    return { structured: settled }
  },
})

export const profileTools = [updateProfileTool]
