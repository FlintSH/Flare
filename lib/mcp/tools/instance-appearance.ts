import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import {
  type AppearanceCommand,
  type AppearanceDocument,
  type CustomizationState,
  appearanceDocumentSchema,
  paletteSchema,
} from '@/lib/customization/schema'
import { saveAppearance } from '@/lib/customization/store'
import { EMBED_LIMITS, EMBED_MODES } from '@/lib/embeds/schema'
import { EMBED_PLACEHOLDERS } from '@/lib/embeds/template'
import { HttpError } from '@/lib/http/errors'

import { compact } from '../results'
import { ToolError, defineTool } from '../tool'
import { appearanceState, appearanceStateSchema } from './instance-views'
import { sentence } from './shared'

/**
 * The appearance studio through MCP: a partial change to its draft, merged
 * on the server onto the draft (or the published document when there is no
 * draft) and validated by the studio's own schema; or one of its commands.
 * Logos and appearance packs stay in the browser (design 3.16 item 3): no
 * argument names a logo, and no command may change one, published or in the
 * draft.
 *
 * `saveAppearance` takes no account and rechecks nothing under a lock, so,
 * like `POST /api/customization`, the call is authorized once on entry: the
 * catalog row's `appearance.manage`, checked by the server before `run`.
 */

const ACTIONS = [
  'save',
  'publish',
  'restore',
  'discard',
  'reset_theme',
] as const
const COMMAND = {
  save: 'save',
  publish: 'publish',
  restore: 'restore',
  discard: 'discard',
  reset_theme: 'reset-theme',
} as const satisfies Record<
  (typeof ACTIONS)[number],
  AppearanceCommand['action']
>

const brand = appearanceDocumentSchema.shape.brand.shape
const theme = appearanceDocumentSchema.shape.theme.shape
const PLACEHOLDERS = EMBED_PLACEHOLDERS.map(({ key }) => `{{${key}}}`).join(
  ', '
)
const template = (limit: number, what: string) =>
  z
    .string()
    .max(limit)
    .optional()
    .describe(`${what}, up to ${limit} characters; may use ${PLACEHOLDERS}`)

export const appearanceInput = z.strictObject({
  action: z
    .enum(ACTIONS)
    .describe(
      'save: keep the change as a draft; publish: make the change, with the draft, live; restore: bring back the appearance live before the last publish; discard: drop the draft; reset_theme: put the studio theme and the classic colors back to Flare defaults and publish that at once, keeping the brand and sharing choices'
    ),
  revision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "The studio's `revision` from get_instance_settings, to have the call refused if the appearance changed since. Without it, the change goes onto the appearance as it is now"
    ),
  brand: z
    .strictObject({
      name: brand.name.optional(),
      tagline: brand.tagline.optional(),
      footer_text: brand.footerText.optional(),
    })
    .optional()
    .describe(
      'The instance name, tagline and footer text. Logos are set in the browser'
    ),
  theme: z
    .strictObject({
      enabled: theme.enabled
        .optional()
        .describe(
          'Use the studio theme; false leaves the classic theme in charge'
        ),
      default_mode: theme.defaultMode.optional(),
      light: paletteSchema
        .partial()
        .optional()
        .describe(
          'Light palette colors to change, by token, as #rrggbb, such as {"primary": "#4f46e5"}'
        ),
      dark: paletteSchema
        .partial()
        .optional()
        .describe('Dark palette colors to change'),
      radius: theme.radius
        .optional()
        .describe('Corner radius in rem, 0 to 1.5'),
      background: theme.background.optional(),
      font: theme.font.optional(),
    })
    .optional(),
  sharing: z
    .strictObject({
      default_style: z.enum(['minimal', 'framed', 'delivery']).optional(),
      show_uploader: z.boolean().optional(),
      show_filename: z.boolean().optional(),
      show_size: z.boolean().optional(),
      show_expiry: z.boolean().optional(),
      show_footer: z
        .boolean()
        .nullable()
        .optional()
        .describe('null follows the credits footer setting'),
      image_fit: z.enum(['contain', 'cover']).optional(),
      embed_mode: z
        .enum(EMBED_MODES)
        .optional()
        .describe(
          'direct: chat apps show an image or video on its own where they can; rich: always the card'
        ),
      personal_embeds: z
        .boolean()
        .optional()
        .describe('Let accounts choose their own embed'),
      site_name_template: template(
        EMBED_LIMITS.siteName,
        'The small line above the title'
      ),
      author_template: template(EMBED_LIMITS.author, 'The author line'),
      title_template: template(EMBED_LIMITS.title, 'The title line'),
      description_template: template(
        EMBED_LIMITS.description,
        'The text under the title'
      ),
      embed_color: z
        .union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
        .optional()
        .describe("#rrggbb, or an empty string for the app's accent"),
    })
    .optional()
    .describe('Share pages and link previews'),
})
type AppearanceInput = z.infer<typeof appearanceInput>

/** The studio document a save or publish sends: the base with the call's changes on top. */
export function mergeAppearance(
  base: AppearanceDocument,
  args: Pick<AppearanceInput, 'brand' | 'theme' | 'sharing'>
): unknown {
  const b = args.brand ?? {}
  const t = args.theme ?? {}
  const s = args.sharing ?? {}
  // Each field by name, so nothing else a call carries can reach the
  // document; the logos are always the base's.
  return {
    brand: {
      ...base.brand,
      ...compact({
        name: b.name,
        tagline: b.tagline,
        footerText: b.footer_text,
      }),
      logoLight: base.brand.logoLight,
      logoDark: base.brand.logoDark,
    },
    theme: {
      ...base.theme,
      ...compact({
        enabled: t.enabled,
        defaultMode: t.default_mode,
        radius: t.radius,
        background: t.background,
        font: t.font,
      }),
      light: { ...base.theme.light, ...compact({ ...t.light }) },
      dark: { ...base.theme.dark, ...compact({ ...t.dark }) },
    },
    sharing: {
      ...base.sharing,
      ...compact({
        defaultStyle: s.default_style,
        showUploader: s.show_uploader,
        showFilename: s.show_filename,
        showSize: s.show_size,
        showExpiry: s.show_expiry,
        imageFit: s.image_fit,
        embedMode: s.embed_mode,
        personalEmbeds: s.personal_embeds,
        siteNameTemplate: s.site_name_template,
        authorTemplate: s.author_template,
        titleTemplate: s.title_template,
        descriptionTemplate: s.description_template,
        embedColor: s.embed_color,
      }),
      // null is a choice of its own here: follow the credits setting.
      ...(s.show_footer !== undefined && { showFooter: s.show_footer }),
    },
  }
}

const ARGUMENT_NAMES: Record<string, string> = {
  footerText: 'footer_text',
  defaultMode: 'default_mode',
  defaultStyle: 'default_style',
  showUploader: 'show_uploader',
  showFilename: 'show_filename',
  showSize: 'show_size',
  showExpiry: 'show_expiry',
  showFooter: 'show_footer',
  imageFit: 'image_fit',
  embedMode: 'embed_mode',
  personalEmbeds: 'personal_embeds',
  siteNameTemplate: 'site_name_template',
  authorTemplate: 'author_template',
  titleTemplate: 'title_template',
  descriptionTemplate: 'description_template',
  embedColor: 'embed_color',
}

const logosOf = (document: AppearanceDocument) =>
  `${document.brand.logoLight}\n${document.brand.logoDark}`

/**
 * Refuses a command that would change a logo: the published one, or the
 * draft's (a missing draft has the published logos). It runs under the
 * settings lock with the state the command leaves, so it holds for every
 * command, whatever it does with the documents.
 */
export function keepLogos(
  current: CustomizationState,
  next: CustomizationState
) {
  const live = logosOf(current.published) !== logosOf(next.published)
  const draft =
    logosOf(current.draft ?? current.published) !==
    logosOf(next.draft ?? next.published)
  if (live || draft)
    throw new ToolError(
      `Nothing was saved: this would change ${
        live ? 'the live logo' : "the draft's logo"
      }, and logos change only in the browser. A draft that holds a logo that is not live, or an earlier appearance with a different logo, is published, restored or discarded in Settings, Appearance there.`,
      'denied'
    )
}

const updateInstanceAppearanceTool = defineTool({
  name: 'update_instance_appearance',
  description:
    "Change the appearance studio: the brand name, tagline and footer text, the theme and its palettes, and how share pages and link previews look. `save` keeps a change as a draft and `publish` makes it live, merged onto the draft, or onto the live appearance when there is no draft; fields left out stay as they are. `restore` brings back the appearance live before the last publish, `discard` drops the draft, and `reset_theme` returns the theme and the classic colors to Flare defaults and publishes that. Logos cannot be changed or uploaded here, and nothing that would change one is done: a draft or an earlier appearance with a different logo is published, restored or discarded in the browser. Answers the studio's state, logos only as set or not.",
  input: appearanceInput,
  output: appearanceStateSchema.extend({
    action: z.enum(ACTIONS),
  }),
  async run(args) {
    const changes = args.brand ?? args.theme ?? args.sharing
    const edits = args.action === 'save' || args.action === 'publish'
    if (!edits && changes)
      throw new ToolError(
        `\`${args.action}\` takes no changes. Use \`save\` or \`publish\` to change brand, theme or sharing.`
      )
    if (args.action === 'save' && !changes)
      throw new ToolError(
        'Nothing to save. Give a change to brand, theme or sharing, or use `publish` to make the draft live.'
      )
    setAuditTarget({ type: 'appearance', name: args.action })
    const state = (await getConfig()).settings.customization
    if (args.revision !== undefined && args.revision !== state.revision)
      throw stale(args.revision, state.revision)
    const revision = args.revision ?? state.revision

    let command: AppearanceCommand
    if (edits) {
      const merged = appearanceDocumentSchema.safeParse(
        mergeAppearance(state.draft ?? state.published, args)
      )
      if (!merged.success) {
        const [issue] = merged.error.issues
        const [section, key] = issue.path.map(String)
        throw new ToolError(
          `Nothing was saved: \`${section}.${ARGUMENT_NAMES[key] ?? key}\`: ${issue.message}`
        )
      }
      command = {
        action: args.action as 'save',
        revision,
        document: merged.data,
      }
    } else
      command = {
        action: COMMAND[args.action] as 'discard',
        revision,
      }

    let saved: CustomizationState
    try {
      saved = await saveAppearance(command, { check: keepLogos })
    } catch (error) {
      if (error instanceof ToolError) throw error
      if (error instanceof HttpError && error.status === 409)
        throw stale(
          revision,
          (await getConfig()).settings.customization.revision,
          args.revision === undefined
        )
      if (error instanceof HttpError)
        throw new ToolError(`Nothing was saved: ${sentence(error.message)}`)
      throw error
    }
    return {
      structured: {
        action: args.action,
        // The row needs appearance.manage, which sees the draft.
        ...appearanceState(saved, true),
      },
    }
  },
})

const stale = (revision: number, now: number, raced = false) =>
  new ToolError(
    raced
      ? `Nothing was saved: the appearance changed while this call ran (it is now at revision ${now}). Call again.`
      : `Nothing was saved: the appearance changed after revision ${revision}; it is now at revision ${now}. Call get_instance_settings with \`sections: ["appearance"]\` to see it as it is, then call again with that revision.`
  )

export const appearanceTool = updateInstanceAppearanceTool
