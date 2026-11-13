import { z } from 'zod'

import {
  DEFAULT_EMBED_CARD,
  EMBED_LIMITS,
  EMBED_MODES,
  embedColorSchema,
  embedTemplateSchema,
} from '@/lib/embeds/schema'

import { DARK_PALETTE, DEFAULT_APPEARANCE, LIGHT_PALETTE } from './defaults'
import { LOGO_DATA_URL_MAX_LENGTH, isLogoDataUrl } from './logo'

export { DARK_PALETTE, DEFAULT_APPEARANCE, LIGHT_PALETTE }

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color')
const paletteShape = {
  background: color,
  foreground: color,
  card: color,
  cardForeground: color,
  popover: color,
  popoverForeground: color,
  primary: color,
  primaryForeground: color,
  secondary: color,
  secondaryForeground: color,
  muted: color,
  mutedForeground: color,
  accent: color,
  accentForeground: color,
  destructive: color,
  destructiveForeground: color,
  border: color,
  input: color,
  ring: color,
}

export const paletteSchema = z.object(paletteShape).strict()
export type Palette = z.infer<typeof paletteSchema>

// Packs cannot cause external requests or introduce executable image formats.
// Uploaded raster assets are embedded, so a pack remains portable.
const logoSchema = z
  .string()
  .max(LOGO_DATA_URL_MAX_LENGTH)
  .refine(
    (value) => value === '' || isLogoDataUrl(value),
    'Upload a PNG, JPEG, or WebP logo'
  )

/**
 * Appearance saved before embeds had their own settings left the preview
 * title and description empty to mean Flare's wording. Those lines are now
 * written out, and an empty one is left off the card, so such a document
 * gets the default card's lines: the title it showed, and the description
 * it showed for media. A document that names an embed mode was saved since.
 */
function withEmbedText(sharing: unknown): unknown {
  if (!sharing || typeof sharing !== 'object' || 'embedMode' in sharing)
    return sharing
  const saved = sharing as Record<string, unknown>
  return {
    ...saved,
    titleTemplate: saved.titleTemplate || DEFAULT_EMBED_CARD.title,
    descriptionTemplate:
      saved.descriptionTemplate || DEFAULT_EMBED_CARD.description,
  }
}

export const appearanceDocumentSchema = z
  .object({
    brand: z
      .object({
        name: z.string().trim().min(1).max(60),
        tagline: z.string().trim().max(180),
        logoLight: logoSchema,
        logoDark: logoSchema,
        footerText: z.string().trim().max(200),
      })
      .strict(),
    theme: z
      .object({
        enabled: z.boolean(),
        defaultMode: z.enum(['system', 'light', 'dark']),
        light: paletteSchema,
        dark: paletteSchema,
        radius: z.number().min(0).max(1.5),
        background: z.enum(['glow', 'plain', 'grid']),
        font: z.enum(['inter', 'system', 'mono']),
      })
      .strict(),
    sharing: z.preprocess(
      withEmbedText,
      z
        .object({
          defaultStyle: z.enum(['minimal', 'framed', 'delivery']),
          showUploader: z.boolean(),
          showFilename: z.boolean(),
          showSize: z.boolean(),
          /** Tell visitors how long a file with a scheduled expiry has left. */
          showExpiry: z.boolean().default(true),
          showFooter: z.boolean().nullable(),
          imageFit: z.enum(['contain', 'cover']).default('contain'),
          embedMode: z.enum(EMBED_MODES).default('direct'),
          /** Whether accounts may choose their own embed mode and card. */
          personalEmbeds: z.boolean().default(true),
          siteNameTemplate: embedTemplateSchema(EMBED_LIMITS.siteName).default(
            DEFAULT_EMBED_CARD.siteName
          ),
          authorTemplate: embedTemplateSchema(EMBED_LIMITS.author).default(
            DEFAULT_EMBED_CARD.author
          ),
          titleTemplate: embedTemplateSchema(EMBED_LIMITS.title).default(
            DEFAULT_EMBED_CARD.title
          ),
          descriptionTemplate: embedTemplateSchema(
            EMBED_LIMITS.description
          ).default(DEFAULT_EMBED_CARD.description),
          embedColor: embedColorSchema.default(DEFAULT_EMBED_CARD.color),
        })
        .strict()
    ),
  })
  .strict()

export type AppearanceDocument = z.infer<typeof appearanceDocumentSchema>
export type ShareStyle = AppearanceDocument['sharing']['defaultStyle']

export const customizationSchema = z
  .object({
    version: z.literal(1).default(1),
    revision: z.number().int().nonnegative().default(0),
    published: appearanceDocumentSchema.prefault(DEFAULT_APPEARANCE),
    draft: appearanceDocumentSchema.nullable().default(null),
    previous: appearanceDocumentSchema.nullable().default(null),
    publishedAt: z.string().datetime().nullable().default(null),
  })
  .strict()

export type CustomizationState = z.infer<typeof customizationSchema>
export const DEFAULT_CUSTOMIZATION = customizationSchema.parse({})

export const appearancePackSchema = z
  .object({
    kind: z.literal('flare.appearance'),
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    appearance: appearanceDocumentSchema,
  })
  .strict()
export type AppearancePack = z.infer<typeof appearancePackSchema>

export const appearanceCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      revision: z.number().int().nonnegative(),
      document: appearanceDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      revision: z.number().int().nonnegative(),
      document: appearanceDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('restore'),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  // Puts the studio theme and classic colors back to Flare's defaults and
  // publishes that at once. Identity and sharing choices are kept.
  z
    .object({
      action: z.literal('reset-theme'),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('discard'),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('import'),
      revision: z.number().int().nonnegative(),
      pack: appearancePackSchema,
    })
    .strict(),
])
export type AppearanceCommand = z.infer<typeof appearanceCommandSchema>

export const personalAppearanceSchema = z
  .object({
    themeMode: z
      .enum(['inherit', 'system', 'light', 'dark'])
      .default('inherit'),
  })
  .strict()
export type PersonalAppearance = z.infer<typeof personalAppearanceSchema>

export function readPersonalAppearance(
  preferences: unknown
): PersonalAppearance {
  const record =
    preferences && typeof preferences === 'object'
      ? (preferences as Record<string, unknown>)
      : {}
  const result = personalAppearanceSchema.safeParse(record.customization || {})
  return result.success ? result.data : { themeMode: 'inherit' }
}

export function resolveShareStyle(
  options: unknown,
  fallback: ShareStyle
): ShareStyle {
  const style =
    options && typeof options === 'object'
      ? (options as Record<string, unknown>).shareStyle
      : undefined
  return style === 'minimal' || style === 'framed' || style === 'delivery'
    ? style
    : fallback
}
