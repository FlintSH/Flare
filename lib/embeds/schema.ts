import { z } from 'zod'

import type { AppearanceDocument } from '@/lib/customization/schema'

import { EMBED_PLACEHOLDER_MESSAGE, isEmbedTemplate } from './template'

/**
 * How a link to a file previews where it is pasted. `direct` shows an image or
 * video on its own wherever the app can, and the card everywhere else; `rich`
 * always shows the card, with the media inside it. Browser-safe.
 */
export const EMBED_MODES = ['direct', 'rich'] as const
export type EmbedMode = (typeof EMBED_MODES)[number]

/**
 * The longest each line of the card can be, as written and as filled in. The
 * title and description keep the 500 characters earlier appearances allowed.
 */
export const EMBED_LIMITS = {
  siteName: 100,
  author: 100,
  title: 500,
  description: 500,
} as const

/** The card's text as templates. An empty line is left off the card. */
export interface EmbedCardTemplates {
  siteName: string
  author: string
  title: string
  description: string
  /** `#rrggbb`, or empty for the app's own accent. */
  color: string
}

export const DEFAULT_EMBED_CARD: EmbedCardTemplates = {
  siteName: '{{instanceName}}',
  author: '',
  title: '{{filename}} ({{size}})',
  description: 'Uploaded by {{uploader}}',
  color: '',
}

export const embedTemplateSchema = (limit: number) =>
  z.string().max(limit).refine(isEmbedTemplate, EMBED_PLACEHOLDER_MESSAGE)

export const embedColorSchema = z.union([
  z.literal(''),
  z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color'),
])

/** An account's own choice, kept in its preferences. */
export const personalEmbedSchema = z
  .object({
    mode: z.enum(['inherit', ...EMBED_MODES]).default('inherit'),
    /** `custom` replaces the instance's card with the lines below. */
    design: z.enum(['inherit', 'custom']).default('inherit'),
    siteName: embedTemplateSchema(EMBED_LIMITS.siteName).default(''),
    author: embedTemplateSchema(EMBED_LIMITS.author).default(''),
    title: embedTemplateSchema(EMBED_LIMITS.title).default(''),
    description: embedTemplateSchema(EMBED_LIMITS.description).default(''),
    color: embedColorSchema.default(''),
  })
  .strict()
export type PersonalEmbed = z.infer<typeof personalEmbedSchema>

export const DEFAULT_PERSONAL_EMBED: PersonalEmbed = personalEmbedSchema.parse(
  {}
)

/** The embed choice saved in an account's preferences; the default if unreadable. */
export function readPersonalEmbed(preferences: unknown): PersonalEmbed {
  const record =
    preferences && typeof preferences === 'object'
      ? (preferences as Record<string, unknown>)
      : {}
  const result = personalEmbedSchema.safeParse(record.embed ?? {})
  return result.success ? result.data : DEFAULT_PERSONAL_EMBED
}

type Sharing = AppearanceDocument['sharing']

/** The instance's card, which accounts start from. */
export function instanceEmbedCard(sharing: Sharing): EmbedCardTemplates {
  return {
    siteName: sharing.siteNameTemplate,
    author: sharing.authorTemplate,
    title: sharing.titleTemplate,
    description: sharing.descriptionTemplate,
    color: sharing.embedColor,
  }
}

export interface EmbedSettings {
  mode: EmbedMode
  card: EmbedCardTemplates
}

/**
 * What applies to one owner's links: their own choice where the instance
 * lets accounts make one, and the instance's otherwise.
 */
export function resolveEmbedSettings(
  sharing: Sharing,
  personal: PersonalEmbed | null
): EmbedSettings {
  const own = sharing.personalEmbeds ? personal : null
  return {
    mode: own && own.mode !== 'inherit' ? own.mode : sharing.embedMode,
    card:
      own?.design === 'custom'
        ? {
            siteName: own.siteName,
            author: own.author,
            title: own.title,
            description: own.description,
            color: own.color,
          }
        : instanceEmbedCard(sharing),
  }
}

/**
 * What an app that shows media on its own is given: the file itself, a page
 * with only its player and title, or the card.
 */
export type EmbedLayout = 'media' | 'player' | 'card'

export function embedLayout(
  mode: EmbedMode,
  media: 'image' | 'video' | 'audio' | null,
  /** Whether the app shows a link to an image as the image alone. */
  bareImages: boolean
): EmbedLayout {
  if (mode !== 'direct' || !bareImages) return 'card'
  return media === 'image' ? 'media' : media === 'video' ? 'player' : 'card'
}
