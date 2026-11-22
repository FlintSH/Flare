import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import {
  type FlareConfig,
  configSchema,
  getConfig,
  readConfig,
} from '@/lib/config'
import { type SettingsPatch, patchSettings } from '@/lib/config/patch'
import { keepSavedCredentials } from '@/lib/config/views'
import {
  LEGACY_THEMES,
  MAX_LEGACY_COLORS,
} from '@/lib/customization/legacy-appearance'
import { getEmailSettingsView } from '@/lib/email/config'
import { HttpError } from '@/lib/http/errors'
import { setEveryoneCanInvite } from '@/lib/invites/service'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'
import { s3StorageTarget, sameStorageTarget } from '@/lib/storage/targets'

import { everyoneHoldsKey } from '../key-permissions'
import { compact } from '../results'
import { type ToolContext, ToolError, defineTool } from '../tool'
import { appearanceTool } from './instance-appearance'
import { searchAuditLogTool } from './instance-audit'
import { emailTools } from './instance-email'
import {
  READ_ONLY_SECTIONS,
  SECTIONS,
  type Section,
  readSections,
  settingsSectionsSchema,
} from './instance-views'
import { sentence } from './shared'

/**
 * get_instance_settings, search_audit_log and update_instance_settings
 * here; the email tools and the appearance studio beside this file.
 *
 * Neither MCP setting can be changed through MCP (design 3.16 item 5): no
 * tool here may accept, merge or pass on anything under `general.mcp`, and
 * `update_instance_settings` takes only the fields its catalog row names.
 * Turning administration off strips the `admin:*` scopes in the settings
 * write itself (`replaceConfig`), so a tool never does that by hand.
 */

/** The answer of every tool that reads or changes settings. */
async function sectionsFor(
  context: ToolContext,
  sections: readonly Section[],
  config?: FlareConfig
) {
  return readSections(sections, {
    config: config ?? (await getConfig()),
    appearanceDraft: context.principal.can('appearance.manage'),
    email: sections.includes('email')
      ? await getEmailSettingsView()
      : undefined,
  })
}

const updateSchema = z.object({
  current_version: z.string(),
  channel: z.string(),
  has_update: z
    .boolean()
    .nullable()
    .describe('null when the check could not tell'),
  latest_version: z.string().optional(),
  release_url: z.string().optional(),
  latest_commit_sha: z.string().optional(),
  latest_commit_url: z.string().optional(),
  message: z.string(),
})

const getInstanceSettingsTool = defineTool({
  name: 'get_instance_settings',
  description: `Read the instance settings by section: ${SECTIONS.join(', ')}. Secrets are never shown: S3 keys, the single sign-on client secret and the SMTP password come back only as whether one is saved, and custom CSS and head HTML only as whether they are set. The email section needs a role with settings.email. ${READ_ONLY_SECTIONS.join(', ')} are read only: they change in the browser. \`appearance\` is the appearance studio, with its revision for update_instance_appearance. Set \`check_for_updates\` to ask GitHub whether a newer Flare release exists.`,
  input: z.strictObject({
    sections: z
      .array(z.enum(SECTIONS))
      .min(1)
      .max(SECTIONS.length)
      .optional()
      .describe(
        'Only these sections. Leave out for every section this connection may read'
      ),
    check_for_updates: z
      .boolean()
      .optional()
      .describe('Also check for a newer release, which asks GitHub'),
  }),
  output: z.object({
    settings: settingsSectionsSchema,
    update: updateSchema.optional(),
  }),
  async run(args, context) {
    if (args.sections?.includes('email')) context.requireEffect('email')
    const sections = (args.sections ?? SECTIONS).filter(
      (section) => section !== 'email' || context.allows('email')
    )
    const settings = await sectionsFor(context, [...new Set(sections)])
    let update: z.infer<typeof updateSchema> | undefined
    if (args.check_for_updates) {
      const info = await checkForUpdates(getBuildInfo())
      update = compact({
        current_version: info.currentVersion,
        channel: info.channel,
        has_update: info.hasUpdate,
        latest_version: info.latestVersion,
        release_url: info.releaseUrl,
        latest_commit_sha: info.latestCommitSha,
        latest_commit_url: info.latestCommitUrl,
        message: info.message,
      })
    }
    return { structured: compact({ settings, update }) }
  },
})

// ---------------------------------------------------------------------------
// Changing settings
// ---------------------------------------------------------------------------

const size = z.strictObject({
  value: z.number().int().min(1).max(1_048_576),
  unit: z.enum(['MB', 'GB']),
})

const keyText = z.string().trim().min(1).max(1024)

export const settingsInput = z.strictObject({
  registrations: z
    .strictObject({
      enabled: z
        .boolean()
        .optional()
        .describe(
          'Let anyone create an account. Opening it is refused while the Everyone role holds administrator, settings.security or settings.email'
        ),
      disabled_message: z
        .string()
        .max(1000)
        .optional()
        .describe('Shown on the sign-up page while registration is closed'),
      invite_limits: z
        .strictObject({
          active_invites: z.number().int().min(1).max(100).optional(),
          uses_per_invite: z.number().int().min(1).max(100).optional(),
          lifetime_days: z.number().int().min(1).max(365).optional(),
        })
        .optional()
        .describe(
          'Limits for accounts that may invite people but not create users'
        ),
    })
    .optional(),
  everyone_can_invite: z
    .boolean()
    .optional()
    .describe(
      'Give the Everyone role Create invites, or take it away. Send it alone: a call that names it with any other argument is refused. Needs settings.security and Create invites of your own; turning it on is refused while Everyone holds a key permission'
    ),
  storage: z
    .strictObject({
      provider: z.enum(['local', 's3']).optional(),
      s3: z
        .strictObject({
          bucket: z.string().trim().min(1).max(255).optional(),
          region: z.string().trim().min(1).max(255).optional(),
          endpoint: z
            .string()
            .trim()
            .max(2048)
            .optional()
            .describe(
              'An S3-compatible endpoint such as https://s3.example.com; an empty string means AWS'
            ),
          force_path_style: z.boolean().optional(),
          access_key_id: keyText.optional(),
          secret_access_key: keyText.optional(),
        })
        .optional()
        .describe(
          'Left-out keys keep the saved ones only while the provider, bucket, region, endpoint and path style stay as saved. Changing any of those needs both keys'
        ),
      quotas_enabled: z.boolean().optional(),
      default_quota: size
        .optional()
        .describe('Storage each account may use while quotas are on'),
      max_upload_size: size.optional(),
    })
    .optional(),
  credits: z
    .strictObject({
      show_footer: z.boolean().describe('Show the Flare credit in the footer'),
    })
    .optional(),
  ocr: z
    .strictObject({
      enabled: z.boolean().describe('Read text from uploaded images'),
    })
    .optional(),
  theme: z
    .strictObject({
      classic_theme: z.enum(LEGACY_THEMES).optional(),
      classic_colors: z
        .record(
          z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
          z.string().max(64)
        )
        .optional()
        .refine(
          (colors) =>
            !colors || Object.keys(colors).length <= MAX_LEGACY_COLORS,
          `At most ${MAX_LEGACY_COLORS} colors`
        )
        .describe(
          'Classic colors by token, such as {"primary": "#6366f1"}, as hex or HSL like 222.2 84% 4.9%. Merged into the saved colors'
        ),
    })
    .optional()
    .describe(
      'The classic theme, used while the appearance studio theme is off'
    ),
})
type SettingsInput = z.infer<typeof settingsInput>

/** The effect each argument needs, by the catalog row's names. */
const EFFECTS = [
  'registrations',
  'everyone_can_invite',
  'storage',
  'credits',
  'ocr',
  'theme',
] as const satisfies readonly (keyof SettingsInput)[]

/**
 * Every settings path a call can write. The patch is built field by field
 * from the arguments and then held to this list, so a mistake here can never
 * reach `general.mcp`, `general.oidc`, `general.setup`, `advanced`,
 * `appearance.favicon`, `email` or `customization`.
 */
export const ALLOWED_PATHS = [
  'general.registrations.enabled',
  'general.registrations.disabledMessage',
  'general.registrations.inviteLimits.activeInvites',
  'general.registrations.inviteLimits.usesPerInvite',
  'general.registrations.inviteLimits.lifetimeDays',
  'general.storage.provider',
  'general.storage.s3.bucket',
  'general.storage.s3.region',
  'general.storage.s3.endpoint',
  'general.storage.s3.forcePathStyle',
  'general.storage.s3.accessKeyId',
  'general.storage.s3.secretAccessKey',
  'general.storage.quotas.enabled',
  'general.storage.quotas.default.value',
  'general.storage.quotas.default.unit',
  'general.storage.maxUploadSize.value',
  'general.storage.maxUploadSize.unit',
  'general.credits.showFooter',
  'general.ocr.enabled',
  'appearance.theme',
  'appearance.customColors',
] as const

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [prefix]
  // Colors are one setting, whatever tokens they name.
  if (prefix === 'appearance.customColors') return [prefix]
  return Object.entries(value).flatMap(([key, entry]) =>
    leafPaths(entry, prefix ? `${prefix}.${key}` : key)
  )
}

/** Throws, as a bug, on a patch that names anything outside `ALLOWED_PATHS`. */
export function assertAllowlisted(patch: SettingsPatch) {
  const outside = leafPaths(patch).filter(
    (path) => !(ALLOWED_PATHS as readonly string[]).includes(path)
  )
  if (outside.length)
    throw new Error(`update_instance_settings built ${outside.join(', ')}`)
}

/** Drops what a call left out, then any object it leaves empty. */
function prune<T>(value: T): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const kept = Object.entries(value).flatMap(([key, entry]) => {
    const pruned = prune(entry)
    return pruned === undefined ? [] : [[key, pruned]]
  })
  return kept.length ? (Object.fromEntries(kept) as T) : undefined
}

/** The settings patch the arguments ask for, built field by field. */
export function settingsPatchFor(args: SettingsInput): SettingsPatch {
  const { registrations: r, storage: s, credits, ocr, theme } = args
  const patch: SettingsPatch =
    prune({
      general: {
        registrations: r && {
          enabled: r.enabled,
          disabledMessage: r.disabled_message,
          inviteLimits: r.invite_limits && {
            activeInvites: r.invite_limits.active_invites,
            usesPerInvite: r.invite_limits.uses_per_invite,
            lifetimeDays: r.invite_limits.lifetime_days,
          },
        },
        storage: s && {
          provider: s.provider,
          s3: s.s3 && {
            bucket: s.s3.bucket,
            region: s.s3.region,
            endpoint: s.s3.endpoint,
            forcePathStyle: s.s3.force_path_style,
            accessKeyId: s.s3.access_key_id,
            secretAccessKey: s.s3.secret_access_key,
          },
          quotas: {
            enabled: s.quotas_enabled,
            default: s.default_quota && { ...s.default_quota },
          },
          maxUploadSize: s.max_upload_size && { ...s.max_upload_size },
        },
        credits: credits && { showFooter: credits.show_footer },
        ocr: ocr && { enabled: ocr.enabled },
      },
      appearance: theme && {
        theme: theme.classic_theme,
        customColors: theme.classic_colors && { ...theme.classic_colors },
      },
    }) ?? {}
  assertAllowlisted(patch)
  return patch
}

type Storage = FlareConfig['settings']['general']['storage']

/** The endpoint as the settings will save it, so a comparison sees what is saved. */
const savedEndpoint = (value: string | undefined) =>
  configSchema.shape.settings.shape.general.shape.storage.shape.s3.shape.endpoint.parse(
    value
  )

const DESTINATION_FIELDS = {
  bucket: 'bucket',
  region: 'region',
  endpoint: 'endpoint',
  forcePathStyle: 'force_path_style',
} as const

/** What a storage patch does to where files go. */
export function storageChange(
  saved: Storage,
  patch: NonNullable<NonNullable<SettingsPatch['general']>['storage']>
) {
  const provider = patch.provider ?? saved.provider
  const s3 = {
    ...saved.s3,
    ...patch.s3,
    endpoint:
      patch.s3?.endpoint === undefined
        ? saved.s3.endpoint
        : savedEndpoint(patch.s3.endpoint),
  }
  const before = s3StorageTarget(saved.s3)
  const after = s3StorageTarget(s3)
  const fields = sameStorageTarget(before, after)
    ? []
    : (Object.keys(DESTINATION_FIELDS) as (keyof typeof DESTINATION_FIELDS)[])
        .filter((field) => {
          const a = before[field]
          const b = after[field]
          return typeof a === 'string' && typeof b === 'string'
            ? a.trim() !== b.trim()
            : a !== b
        })
        .map((field) => DESTINATION_FIELDS[field])
  return {
    providerFrom: saved.provider,
    providerTo: provider,
    s3Fields: fields,
    /**
     * Whether saved keys would reach a destination they were not saved
     * for: another bucket, region, endpoint or addressing, or S3 taking
     * over uploads. A switch to local storage sends them nowhere new; they
     * stay with the unchanged S3 destination for the files stored there.
     */
    keysMove:
      fields.length > 0 || (provider === 's3' && saved.provider !== 's3'),
  }
}

export const STORAGE_NOTICE =
  'Files already stored are not moved. Share pages, downloads and previews read from the storage now in effect, so files uploaded before this change cannot be opened until storage points back to where they were written, or they are copied there. Avatars and archives stored on S3 stay readable, and their queued deletions run, only while the saved bucket, region, endpoint and path style match the ones they were written with; otherwise deletions wait with "Storage target changed".'

const storageChangeSchema = z.object({
  provider: z
    .object({ from: z.enum(['local', 's3']), to: z.enum(['local', 's3']) })
    .optional(),
  s3_changed: z
    .array(z.string())
    .optional()
    .describe('The S3 destination fields this call changed'),
  keys_replaced: z.boolean().optional(),
  notice: z.string().optional(),
})

export const EVERYONE_CAN_INVITE_ALONE =
  'Nothing was changed: `everyone_can_invite` is saved by itself. Send it in a call of its own, and the other settings in another.'

const everyoneHoldsKeyRefusal = (what: string) =>
  new ToolError(
    `Refused: ${what} is not allowed through MCP while the Everyone role holds administrator, settings.security or settings.email, because every account, new ones included, would receive it. Nothing was saved. An administrator can take that permission off Everyone under Roles, or make this change in the browser.`,
    'denied'
  )

const updateInstanceSettingsTool = defineTool({
  name: 'update_instance_settings',
  description: `Change some instance settings. Only these: registration and invite limits (\`registrations\`), whether everyone may invite (\`everyone_can_invite\`, sent in a call of its own), storage, quotas and the upload size limit (\`storage\`), the footer credit (\`credits\`), reading text from images (\`ocr\`) and the classic theme (\`theme\`). Each needs its own role permission. A call applies everything it names or nothing. Fields left out stay as they are. Sign-in, custom code, the MCP switches and setup cannot be changed through MCP; email has update_email_settings and the appearance studio update_instance_appearance. Changing the storage provider or S3 destination does not move files already stored: they cannot be opened until storage points back to where they are, so check with the administrator first; the answer says what changed. Saved S3 keys are never sent to a new destination: changing the provider to S3, or the bucket, region, endpoint or path style, needs both keys in the same call. Answers the changed sections as get_instance_settings shows them.`,
  input: settingsInput,
  output: z.object({
    changed: z.array(z.string()).describe('The sections this call changed'),
    settings: settingsSectionsSchema,
    storage_change: storageChangeSchema.optional(),
  }),
  async run(args, context) {
    // The invite switch is saved by the invite service, in a transaction of
    // its own, so it never shares a call with settings the settings patch
    // saves: each call then applies everything or nothing.
    const invite = args.everyone_can_invite
    if (
      invite !== undefined &&
      Object.entries(args).some(
        ([name, value]) => name !== 'everyone_can_invite' && value !== undefined
      )
    )
      throw new ToolError(EVERYONE_CAN_INVITE_ALONE)
    const asked = EFFECTS.filter((effect) => args[effect] !== undefined)
    // Every refusal for missing access comes before anything is written.
    for (const effect of asked) context.requireEffect(effect)
    const patch = settingsPatchFor(args)
    if (!Object.keys(patch).length && invite === undefined)
      throw new ToolError(
        'Nothing to change. Give at least one setting; get_instance_settings shows them.'
      )
    setAuditTarget({ type: 'settings', name: asked.join(', ') })
    const { user } = context.principal
    const opensRegistration = patch.general?.registrations?.enabled === true

    let saved: FlareConfig | undefined
    let change: ReturnType<typeof storageChange> | undefined
    if (invite !== undefined)
      await setEveryoneCanInvite(user.id, invite, async (tx) => {
        if (invite && (await everyoneHoldsKey(tx)))
          throw everyoneHoldsKeyRefusal('letting everyone invite')
      }).catch(settingsFailure)
    else
      saved = await patchSettings(user, patch, {
        // Under the role lock, against the storage as saved.
        credentials: async (settings, tx) => {
          keepSavedCredentials(settings)
          const storage = settings.general?.storage
          if (!storage) return
          change = storageChange(
            (await readConfig(tx)).settings.general.storage,
            storage
          )
          if (
            change.keysMove &&
            !(storage.s3?.accessKeyId && storage.s3?.secretAccessKey)
          )
            throw new ToolError(
              `Nothing was saved: this change sends uploads to ${
                change.s3Fields.length
                  ? `a different S3 ${change.s3Fields.join(', ')}`
                  : 'S3'
              }, and saved keys are never sent to a destination they were not saved for. Give both \`storage.s3.access_key_id\` and \`storage.s3.secret_access_key\` for it in the same call.`,
              'denied'
            )
        },
        check: async (tx) => {
          if (opensRegistration && (await everyoneHoldsKey(tx)))
            throw everyoneHoldsKeyRefusal('opening registration')
        },
      }).catch(settingsFailure)

    const settings = await sectionsFor(
      context,
      [
        ...new Set(
          asked.map((effect): Section =>
            effect === 'everyone_can_invite' ? 'registrations' : effect
          )
        ),
      ],
      saved
    )
    const moved =
      change &&
      (change.providerFrom !== change.providerTo || change.s3Fields.length)
    const keys = args.storage?.s3
    return {
      structured: compact({
        changed: asked,
        settings,
        storage_change: change
          ? compact({
              provider:
                change.providerFrom !== change.providerTo
                  ? { from: change.providerFrom, to: change.providerTo }
                  : undefined,
              s3_changed: change.s3Fields.length ? change.s3Fields : undefined,
              keys_replaced:
                Boolean(keys?.access_key_id || keys?.secret_access_key) ||
                undefined,
              notice: moved ? STORAGE_NOTICE : undefined,
            })
          : undefined,
      }),
    }
  },
})

/** A refusal from the settings services, told as one that saved nothing. */
function settingsFailure(error: unknown): never {
  if (error instanceof ToolError) throw error
  if (error instanceof HttpError)
    throw new ToolError(
      `Nothing was saved: ${sentence(error.message)}`,
      error.status === 401 || error.status === 403 ? 'denied' : 'failure'
    )
  throw error
}

export const instanceTools = [
  getInstanceSettingsTool,
  searchAuditLogTool,
  updateInstanceSettingsTool,
  ...emailTools,
  appearanceTool,
]
