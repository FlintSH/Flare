import type { Prisma } from '@prisma/client'

import type { FlareConfig } from '@/lib/config'
import { hasPermission } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'
import { accountUploadOptions } from '@/lib/uploads/effective-settings'
import {
  type UploadProfileOptions,
  mergeUploadOptions,
  uploadProfileOptionsSchema,
} from '@/lib/uploads/schema'

import { type ToolContext, ToolError } from './tool'

// What later uploads become, deleted or hidden when they expire or public
// from the start, follows from every later upload that reaches a setting,
// however it is reached: the account's defaults, a profile's own setting,
// or a profile that leaves the setting to the account. So a change is
// judged by what it does to every way of uploading, not by the setting it
// touches, and judged under the account's row lock, which every write to
// the defaults and the profiles takes, so the state it judges is the state
// it changes.

/** What happens to a file when its expiry runs; null when it never expires. */
export type ExpiryOutcome = 'DELETE' | 'SET_PRIVATE' | null

export type UploadProfileState = {
  id: string
  name: string
  options: UploadProfileOptions
}

/** What decides what every later upload of an account becomes. */
export type UploadState = {
  /** The account's own defaults, as uploads read them. */
  account: Parameters<typeof accountUploadOptions>[0]
  defaultProfileId: string | null
  profiles: readonly UploadProfileState[]
  /**
   * Whether the owner's role may share files. Without it every upload is
   * made private when it is published, whatever its settings say.
   */
  canShare: boolean
}

/**
 * One way of uploading: naming no profile (the default profile, or the
 * account alone without one), naming `none` (the account alone), or naming
 * a profile.
 */
export type UploadPath =
  | { kind: 'default' }
  | { kind: 'account' }
  | { kind: 'profile'; id: string; name: string }

const pathKey = (path: UploadPath) =>
  path.kind === 'profile' ? `profile:${path.id}` : path.kind

/** What an upload on one path becomes. */
type Upload = {
  outcome: ExpiryOutcome
  length: string
  /**
   * The action the path saves, whether or not a length is saved with it: an
   * upload that brings its own expiry takes this one. Null where uploads
   * are refused.
   */
  action: Exclude<ExpiryOutcome, null> | null
  visibility: 'PUBLIC' | 'PRIVATE'
}

/**
 * What uploads on each way of uploading become: what their expiry does and
 * after how long, and whether they are public. By path key.
 */
export function uploadOutcomes(
  state: UploadState,
  config: FlareConfig
): Map<string, { path: UploadPath } & Upload> {
  const account = accountUploadOptions(state.account, config)
  // The upload code's own precedence: its defaults, the account, the profile.
  const upload = (profile: UploadProfileOptions): Upload => {
    const { expiration, expiryAction, visibility } = mergeUploadOptions(
      account,
      profile,
      {}
    )
    return {
      outcome: expiration === 'DISABLED' ? null : expiryAction,
      length: expiration,
      action: expiryAction,
      // As publishing an upload does for a role that may not share.
      visibility: state.canShare ? visibility : 'PRIVATE',
    }
  }
  // A default that names a profile that is gone refuses every upload.
  const refused: Upload = {
    outcome: null,
    length: 'DISABLED',
    action: null,
    visibility: 'PRIVATE',
  }
  // A profile that is still to be created has the empty ID.
  const fallback =
    state.defaultProfileId === null
      ? null
      : state.profiles.find(({ id }) => id === state.defaultProfileId)
  const paths: [UploadPath, Upload][] = [
    [
      { kind: 'default' },
      fallback === undefined ? refused : upload(fallback?.options ?? {}),
    ],
    [{ kind: 'account' }, upload({})],
    ...state.profiles.map(({ id, name, options }): [UploadPath, Upload] => [
      { kind: 'profile', id, name },
      upload(options),
    ]),
  ]
  return new Map(
    paths.map(([path, result]) => [pathKey(path), { path, ...result }])
  )
}

/** What a change can newly make later uploads: deleted, hidden, or public. */
export type UploadChange = 'DELETE' | 'SET_PRIVATE' | 'PUBLIC'

/**
 * The ways of uploading that a change makes delete or hide files, or moves
 * to another length while they do, or makes public where they were private,
 * by what they would do. Setting a new time for files to be deleted is
 * scheduling their deletion, as it is on a file. A new profile is compared
 * with the account as it was, which is what those uploads did without it,
 * so one that only inherits needs nothing.
 */
export function uploadChanges(
  before: UploadState,
  after: UploadState,
  config: FlareConfig
): Record<UploadChange, UploadPath[]> {
  const was = uploadOutcomes(before, config)
  const changes: Record<UploadChange, UploadPath[]> = {
    DELETE: [],
    SET_PRIVATE: [],
    PUBLIC: [],
  }
  for (const [key, now] of uploadOutcomes(after, config)) {
    const previous = was.get(key) ?? was.get('account')!
    if (
      now.outcome &&
      (now.outcome !== previous.outcome || now.length !== previous.length)
    )
      changes[now.outcome].push(now.path)
    if (now.visibility === 'PUBLIC' && previous.visibility === 'PRIVATE')
      changes.PUBLIC.push(now.path)
  }
  return changes
}

/**
 * What a change does to uploads that bring half of an expiry themselves. An
 * upload can name its own expiry and no action, and then takes the action
 * its way of uploading saves, even one saved beside no length. Or it names
 * an action and no expiry, and takes the saved length. Neither shows in
 * what uploads without options of their own become.
 *
 * - `action`: the ways of uploading whose saved action becomes another, by
 *   the new action. Uploads with an expiry of their own would be deleted
 *   where they were made private, or the reverse.
 * - `length`: the ways whose saved length becomes another that is not
 *   never. Uploads that name an action of their own would be deleted, or
 *   made private, after the new time.
 *
 * A new profile is compared with the account as it was, as in
 * `uploadChanges`.
 */
export function inheritedChanges(
  before: UploadState,
  after: UploadState,
  config: FlareConfig
): {
  action: Record<Exclude<ExpiryOutcome, null>, UploadPath[]>
  length: UploadPath[]
} {
  const was = uploadOutcomes(before, config)
  const changes = {
    action: { DELETE: [] as UploadPath[], SET_PRIVATE: [] as UploadPath[] },
    length: [] as UploadPath[],
  }
  for (const [key, now] of uploadOutcomes(after, config)) {
    const previous = was.get(key) ?? was.get('account')!
    if (now.action && now.action !== previous.action)
      changes.action[now.action].push(now.path)
    if (now.length !== 'DISABLED' && now.length !== previous.length)
      changes.length.push(now.path)
  }
  return changes
}

/** The ways of uploading as a refusal names them to the agent. */
function describePaths(paths: readonly UploadPath[], after: UploadState) {
  const kinds = new Set(paths.map(({ kind }) => kind))
  // Without a default profile, naming none and naming `none` are one way.
  const together =
    kinds.has('default') &&
    kinds.has('account') &&
    after.defaultProfileId === null
  const words = paths.flatMap((path) => {
    if (path.kind === 'profile')
      return [`uploads with the profile "${path.name}"`]
    if (together)
      return path.kind === 'default'
        ? ['uploads that name no profile or `none`']
        : []
    return path.kind === 'default'
      ? ['uploads that name no profile']
      : ['uploads that name the profile `none`']
  })
  const listed =
    words.length > 1
      ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
      : words[0]
  return listed.charAt(0).toUpperCase() + listed.slice(1)
}

const WOULD: Record<UploadChange, string> = {
  DELETE: 'would be deleted when they expire',
  SET_PRIVATE: 'would be made private when they expire',
  PUBLIC: 'would be public',
}
/** For uploads that bring an expiry of their own and take the saved action. */
const WITH_OWN_EXPIRY: Record<Exclude<ExpiryOutcome, null>, string> = {
  DELETE: 'that set an expiry of their own would be deleted when it runs out',
  SET_PRIVATE:
    'that set an expiry of their own would be made private when it runs out',
}
/** For uploads that name an action of their own and take the saved length. */
const WITH_OWN_ACTION: Record<Exclude<ExpiryOutcome, null>, string> = {
  DELETE:
    'that ask to be deleted when they expire would be deleted after the new time',
  SET_PRIVATE:
    'that ask to be made private when they expire would be made private after the new time',
}

/** What decides later uploads, as the transaction sees it. */
async function readUploadState(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<UploadState> {
  const [account, profiles, access] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        randomizeFileUrls: true,
        defaultFileExpiration: true,
        defaultFileExpirationAction: true,
        defaultUploadProfileId: true,
      },
    }),
    tx.uploadProfile.findMany({
      where: { userId },
      select: { id: true, name: true, options: true },
      // A refusal lists the profiles as get_account does.
      orderBy: { name: 'asc' },
    }),
    // The role as publishing an upload reads it.
    getUserAccess(userId, tx),
  ])
  if (!account)
    throw new ToolError('The account no longer exists. Nothing was changed.')
  const { defaultUploadProfileId, ...defaults } = account
  return {
    account: defaults,
    defaultProfileId: defaultUploadProfileId,
    profiles: profiles.map(({ id, name, options }) => ({
      id,
      name,
      options: uploadProfileOptionsSchema.parse(options),
    })),
    canShare: hasPermission(access, 'files.share'),
  }
}

/**
 * The tool's effect for each kind of change. A tool whose calls cannot make
 * uploads public names no effect for it.
 */
export type UploadEffects = Record<'DELETE' | 'SET_PRIVATE', string> & {
  PUBLIC?: string
}

/**
 * A check for a service to run once it holds the account's row lock and
 * before it writes. It reads what decides later uploads, applies `change`,
 * and refuses, saying which uploads it would affect, unless the call holds
 * the tool's effect for every way of uploading that would start deleting,
 * hiding or publishing files, also for uploads that bring an expiry or an
 * action of their own and take the other half from what is saved.
 *
 * The effects are judged by the call's access as it began. The tool runs the
 * call's `recheck` after this in the same transaction, which asks for the
 * effects required here as the credential and the role are now.
 */
export function uploadCheck(
  {
    principal,
    requireEffect,
  }: Pick<ToolContext, 'principal' | 'requireEffect'>,
  effects: UploadEffects,
  config: FlareConfig,
  change: (state: UploadState) => UploadState
): (tx: Prisma.TransactionClient) => Promise<void> {
  return async (tx) => {
    const before = await readUploadState(tx, principal.user.id)
    const after = change(before)
    /** Requires the effect for `kind`, or refuses saying which uploads and why. */
    const need = (
      kind: UploadChange,
      paths: readonly UploadPath[],
      would: string
    ) => {
      if (!paths.length) return
      const effect = effects[kind]
      if (!effect)
        throw new Error(`This tool has no effect for a change to ${kind}`)
      try {
        requireEffect(effect)
      } catch (error) {
        if (!(error instanceof ToolError)) throw error
        throw new ToolError(
          `${describePaths(paths, after)} ${would}. ${error.message}`,
          'denied'
        )
      }
    }
    // First what the change does to uploads that bring no options of their
    // own, which is what most uploads are and what the refusal should say.
    const changes = uploadChanges(before, after, config)
    for (const kind of ['DELETE', 'SET_PRIVATE', 'PUBLIC'] as const)
      need(kind, changes[kind], WOULD[kind])
    // Then uploads that bring an expiry and take the saved action, and
    // uploads that bring an action and take the saved length.
    const inherited = inheritedChanges(before, after, config)
    for (const kind of ['DELETE', 'SET_PRIVATE'] as const)
      need(kind, inherited.action[kind], WITH_OWN_EXPIRY[kind])
    for (const kind of ['DELETE', 'SET_PRIVATE'] as const)
      need(kind, inherited.length, WITH_OWN_ACTION[kind])
  }
}
