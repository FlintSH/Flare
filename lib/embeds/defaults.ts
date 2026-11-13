/**
 * The embed settings' plain values, apart from the schemas that validate
 * them, so a page that only needs a default doesn't carry the validator.
 */

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
