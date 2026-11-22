import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import {
  deleteProfile,
  profileView,
  saveProfileAndDefault,
} from '@/lib/uploads/profiles'
import {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_TAG_LIMIT,
  type UploadProfileOptions,
  type UploadProfileView,
  uploadProfileInputSchema,
} from '@/lib/uploads/schema'

import type { AgentPrincipal } from '../auth'
import { compact } from '../results'
import { ToolError, defineTool } from '../tool'
import {
  ACTION_NEEDS,
  EXPIRY,
  EXPIRY_ACTION,
  EXPIRY_NEEDS,
  PROFILE_EFFECTS,
  UNBOUND,
  boundProfile,
  expiry,
  expiryAction,
  profileProof,
  requireNamedAction,
  wordFor,
} from './profile'
import { ownProfile, pickTags, sentence, serviceInput } from './shared'

const VISIBILITY = { public: 'PUBLIC', private: 'PRIVATE' } as const
const visibility = z.enum(['public', 'private'])
const shareStyle = z.enum(['minimal', 'framed', 'delivery'])

/** Refuses a token bound to an upload profile, which may not change profiles. */
async function refuseBoundToken(principal: AgentPrincipal) {
  const bound = await boundProfile(principal)
  if (bound)
    throw new ToolError(
      `This token is bound to the upload profile ${bound}, so it cannot change upload profiles. Use ${UNBOUND}.`,
      'denied'
    )
}

// ---------------------------------------------------------------------------
// Upload profiles
// ---------------------------------------------------------------------------

/**
 * An upload profile with its settings, as `save_upload_profile` and
 * `get_account` answer it. A setting that is absent is one the profile leaves
 * to the account's own settings.
 */
export const uploadProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  default: z
    .boolean()
    .optional()
    .describe('Uploads that name no profile use this one'),
  revision: z
    .string()
    .describe(
      'Changes with every save; pass it as `revision` to save_upload_profile to refuse a stale edit'
    ),
  visibility: visibility.optional(),
  expiry: expiry.optional(),
  expiry_action: expiryAction.optional(),
  randomize_file_urls: z.boolean().optional(),
  share_style: shareStyle.optional(),
  tags: z
    .array(z.string())
    .optional()
    .describe('The tags every file uploaded with the profile gets, by name'),
})
export type UploadProfileRow = z.infer<typeof uploadProfileSchema>

/** The names of the tags these profiles add, read from the account once. */
export async function profileTagNames(
  userId: string,
  profiles: readonly UploadProfileView[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(profiles.flatMap(({ options }) => options.tagIds ?? [])),
  ]
  if (!ids.length) return new Map()
  const tags = await prisma.vaultTag.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, name: true },
  })
  return new Map(tags.map((tag) => [tag.id, tag.name]))
}

export function uploadProfileRow(
  { id, name, options, updatedAt }: UploadProfileView,
  defaultId: string | null | undefined,
  tagNames: ReadonlyMap<string, string>
): UploadProfileRow {
  const tags = (options.tagIds ?? []).flatMap((tag) => tagNames.get(tag) ?? [])
  return compact({
    id,
    name,
    default: id === defaultId || undefined,
    revision: updatedAt,
    visibility: options.visibility && wordFor(VISIBILITY, options.visibility),
    expiry: options.expiration && wordFor(EXPIRY, options.expiration),
    expiry_action:
      options.expiryAction && wordFor(EXPIRY_ACTION, options.expiryAction),
    randomize_file_urls: options.randomizeFileUrls,
    share_style: options.shareStyle,
    tags: tags.length ? tags : undefined,
  })
}

/** Whether two sets of options save the same choices, tag order aside. */
function sameOptions(a: UploadProfileOptions, b: UploadProfileOptions) {
  const choices = (options: UploadProfileOptions) =>
    JSON.stringify(
      Object.entries({
        ...options,
        // No tags and an empty list of tags are one choice.
        tagIds: options.tagIds?.length ? [...options.tagIds].sort() : undefined,
      })
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  return choices(a) === choices(b)
}

/** A database error worded as the profile routes word it. */
const asProfileRoutes = (error: unknown) =>
  uploadProfileRoutes.translate?.(error) ?? error

/** Why an update was refused as stale, with where the profile stands now. */
async function staleEdit(
  userId: string,
  profile: { id: string; name: string },
  revision: string | undefined
) {
  const now = await prisma.uploadProfile.findFirst({
    where: { id: profile.id, userId },
    select: { updatedAt: true },
  })
  if (!now)
    return new ToolError(
      `Nothing was saved: the upload profile "${profile.name}" was deleted in the meantime. Call get_account to see the profiles that exist.`
    )
  return new ToolError(
    revision
      ? `Nothing was saved: the upload profile "${profile.name}" changed after revision ${revision}. It is now at revision ${now.updatedAt.toISOString()}. Call get_account to see its settings as they are, then call again with that revision, or without \`revision\` to change the profile as it now stands.`
      : `Nothing was saved: the upload profile "${profile.name}" changed while this call ran. Call again.`
  )
}

const BOUND_TOKENS_FOLLOW =
  'Tokens bound to a profile follow its changes at once'

/** The settings a call can put in a profile, each also removable with null. */
const SETTING_ARGUMENTS = [
  'visibility',
  'expiry',
  'expiry_action',
  'randomize_file_urls',
  'share_style',
  'tags',
] as const

const saveUploadProfileTool = defineTool({
  name: 'save_upload_profile',
  description: `Create an upload profile, or change the one \`profile\` names. A profile is a saved set of upload settings: uploads can name it, one can be the default, and a token can be bound to one. When changing one, settings left out stay as they are, and a setting given as null is taken out, so uploads follow the account's own setting for it. Changes apply to later uploads only, and a profile's expiry applies to every later upload that uses it. ${BOUND_TOKENS_FOLLOW}; a token bound to a profile cannot use this tool. Answers the profile with its new \`revision\`.`,
  input: z.strictObject({
    profile: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'The profile to change: its ID or name from get_account. Leave out to create one'
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(PROFILE_NAME_MAX_LENGTH)
      .optional()
      .describe(
        `Up to ${PROFILE_NAME_MAX_LENGTH} characters, unlike any other profile's name; required for a new profile`
      ),
    visibility: visibility
      .nullable()
      .optional()
      .describe(
        'Who can open the files; private means only the owner, and null takes it out, which leaves them public. Making later uploads public where they were private needs a connection that may change sharing'
      ),
    expiry: expiry
      .nullable()
      .optional()
      .describe(
        `How long the files last. \`never\` turns off a default expiry of the account and needs nothing more. ${EXPIRY_NEEDS}`
      ),
    expiry_action: expiryAction
      .nullable()
      .optional()
      .describe(
        `What happens to a file when it expires: it is deleted permanently, or made private. ${ACTION_NEEDS}, also while no length is set. \`null\` leaves the action to the account, and needs the same for the account's action when that is the other one`
      ),
    randomize_file_urls: z
      .boolean()
      .nullable()
      .optional()
      .describe('Give the files random names in their links'),
    share_style: shareStyle
      .nullable()
      .optional()
      .describe('How the share page of the files looks'),
    tags: z
      .array(z.string().min(1).max(200))
      .max(PROFILE_TAG_LIMIT)
      .nullable()
      .optional()
      .describe(
        `The tags every file gets: names or IDs from list_tags, up to ${PROFILE_TAG_LIMIT}. An empty list or null means none`
      ),
    make_default: z
      .boolean()
      .optional()
      .describe(
        'true: uploads that name no profile use this one. false: it stops being the default, and the account has none. Either changes how those uploads expire and whether they are public, which needs what `expiry` and `visibility` say'
      ),
    revision: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Only when changing a profile: the `revision` last answered for it, to have the edit refused if the profile changed since. Without it the changes go onto the profile as it is now'
      ),
  }),
  output: z.object({
    profile: uploadProfileSchema,
    created: z.boolean().optional().describe('true for a new profile'),
  }),
  async run(args, context) {
    const { principal } = context
    await refuseBoundToken(principal)
    requireNamedAction(context, PROFILE_EFFECTS, args.expiry_action)
    const userId = principal.user.id
    const current =
      args.profile === undefined ? null : await ownProfile(userId, args.profile)
    if (!current) {
      if (args.name === undefined)
        throw new ToolError(
          'Give the new profile a `name`, or say which `profile` to change.'
        )
      if (args.revision !== undefined)
        throw new ToolError(
          '`revision` belongs to a change. Pass the profile to change as `profile`, or leave `revision` out to create a new profile.'
        )
    }
    const saved = current && profileView(current)
    if (saved) {
      setAuditTarget({ type: 'upload_profile', id: saved.id, name: saved.name })
      const asks =
        args.name !== undefined ||
        args.make_default !== undefined ||
        SETTING_ARGUMENTS.some((argument) => args[argument] !== undefined)
      if (!asks)
        throw new ToolError(
          'Nothing to change. Give a new `name`, a setting to change, or `make_default`.'
        )
      // The route takes the same form: the time the profile was last saved.
      if (
        args.revision !== undefined &&
        !z.string().datetime().safeParse(args.revision).success
      )
        throw new ToolError(
          '`revision` must be the value last answered for this profile, such as 2026-11-22T10:15:30.000Z. Leave it out to change the profile as it is now.'
        )
    }

    // The profile routes replace every setting at once, so what the call
    // leaves out is sent as the profile has it now.
    const options: UploadProfileOptions = { ...saved?.options }
    const choose = <Key extends keyof UploadProfileOptions>(
      key: Key,
      value: UploadProfileOptions[Key] | null | undefined
    ) => {
      if (value === null) delete options[key]
      else if (value !== undefined) options[key] = value
    }
    choose('visibility', args.visibility && VISIBILITY[args.visibility])
    choose('expiration', args.expiry && EXPIRY[args.expiry])
    choose(
      'expiryAction',
      args.expiry_action && EXPIRY_ACTION[args.expiry_action]
    )
    choose('randomizeFileUrls', args.randomize_file_urls)
    choose('shareStyle', args.share_style)
    if (args.tags !== undefined)
      choose(
        'tagIds',
        args.tags?.length
          ? [
              ...new Set(
                (await pickTags(userId, args.tags)).map((tag) => tag.id)
              ),
            ]
          : null
      )
    const input = serviceInput(
      uploadProfileInputSchema,
      { name: args.name ?? saved?.name, options },
      { name: 'name' }
    )
    const changed =
      !saved ||
      input.name !== saved.name ||
      !sameOptions(input.options, saved.options)

    // The profile and the default are saved together, with the account
    // locked, and judged together by what they do to every upload, so a
    // refusal leaves both as they were.
    const id = saved?.id ?? ''
    let result: Awaited<ReturnType<typeof saveProfileAndDefault>>
    try {
      result = await saveProfileAndDefault(
        userId,
        {
          id: saved?.id ?? null,
          // A change to the fields is refused if the profile moved on since
          // it was read here; a revision the call gives is always enforced.
          revision:
            args.revision ?? (saved && changed ? saved.updatedAt : undefined),
          input: changed ? input : undefined,
          makeDefault: args.make_default,
        },
        await profileProof(context, (state) => ({
          ...state,
          // A profile that does not exist yet has no ID to go by.
          profiles: !saved
            ? [...state.profiles, { id, ...input }]
            : state.profiles.map((other) =>
                other.id === id && changed ? { ...other, ...input } : other
              ),
          defaultProfileId:
            args.make_default === true
              ? id
              : args.make_default === false && state.defaultProfileId === id
                ? null
                : state.defaultProfileId,
        }))
      )
    } catch (error) {
      if (error instanceof ToolError) throw error
      // The service answers a conflict only for a profile that is no longer
      // at the revision; a name another profile has is the database's.
      if (saved && error instanceof HttpError && error.status === 409)
        throw await staleEdit(userId, saved, args.revision)
      const refusal = asProfileRoutes(error)
      if (refusal instanceof HttpError && refusal.status === 409)
        throw new ToolError(
          `${sentence(refusal.message)} Choose another \`name\`${
            saved ? '' : ', or pass that profile as `profile` to change it'
          }.`
        )
      throw refusal
    }
    const { profile, defaultId } = result
    setAuditTarget({
      type: 'upload_profile',
      id: profile.id,
      name: profile.name,
    })

    return {
      structured: compact({
        profile: uploadProfileRow(
          profile,
          defaultId,
          await profileTagNames(userId, [profile])
        ),
        created: !saved || undefined,
      }),
    }
  },
})

const deleteUploadProfileTool = defineTool({
  name: 'delete_upload_profile',
  description:
    'Delete an upload profile. Files already uploaded with it stay as they are. Uploads that name the profile are refused afterwards, and tokens bound to it can no longer upload: a token cannot be bound to another profile, so each has to be replaced. If it was the default profile, the account has no default afterwards and uploads that name no profile follow the account settings; deleting, hiding or publishing them then needs Delete files or Change sharing. A deleted profile cannot be restored; save_upload_profile can create one with the same settings, which bound tokens do not follow. A token bound to an upload profile cannot use this tool.',
  input: z.strictObject({
    profile: z
      .string()
      .min(1)
      .max(100)
      .describe('The profile to delete: its ID or name from get_account'),
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    default_cleared: z
      .boolean()
      .optional()
      .describe('true when it was the default: the account now has none'),
  }),
  async run(args, context) {
    const { principal } = context
    await refuseBoundToken(principal)
    const userId = principal.user.id
    const profile = await ownProfile(userId, args.profile)
    setAuditTarget({
      type: 'upload_profile',
      id: profile.id,
      name: profile.name,
    })
    // Deleting the default hands uploads that name no profile back to the
    // account's own settings, which the profile may have been holding off.
    let wasDefault = false
    const deleted = await deleteProfile(
      userId,
      profile.id,
      await profileProof(context, (state) => {
        wasDefault = state.defaultProfileId === profile.id
        return {
          ...state,
          defaultProfileId: wasDefault ? null : state.defaultProfileId,
          profiles: state.profiles.filter(({ id }) => id !== profile.id),
        }
      })
    )
    // The owner may have deleted it after it was found here.
    if (!deleted)
      throw new ToolError(
        `The upload profile "${profile.name}" no longer exists: it was deleted in the meantime. Call get_account to see the upload profiles.`
      )
    return {
      structured: compact({
        id: profile.id,
        name: profile.name,
        default_cleared: wasDefault || undefined,
      }),
    }
  },
})

export const uploadProfileTools = [
  saveUploadProfileTool,
  deleteUploadProfileTool,
]
