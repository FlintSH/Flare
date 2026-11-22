/**
 * What Copy puts on the clipboard for an uploaded file: its share page, the
 * file itself, or Markdown for wherever that's written. Browser-safe.
 */
export const LINK_FORMATS = ['link', 'direct', 'markdown'] as const
export type LinkFormat = (typeof LINK_FORMATS)[number]

export const LINK_FORMAT_NAMES: Record<LinkFormat, string> = {
  link: 'Link',
  direct: 'Direct link',
  markdown: 'Markdown',
}

export const isLinkFormat = (value: unknown): value is LinkFormat =>
  LINK_FORMATS.includes(value as LinkFormat)

/** The file's bytes without the page around them: `/raw` after the share page. */
export const directLink = (link: string) => `${link.replace(/\/+$/, '')}/raw`

// Brackets end a Markdown label and parentheses end its address; a file's
// name and path can hold both.
const label = (name: string) => name.replace(/([\\[\]])/g, '\\$1')
const address = (url: string) => url.replace(/\(/g, '%28').replace(/\)/g, '%29')

/**
 * The text Copy gives for a file in `format`. Markdown shows an image as
 * one and links anything else to its page. Never carries a file password.
 */
export function formatLink(
  format: LinkFormat,
  file: { link: string; name: string; type: string }
) {
  if (format === 'link') return file.link
  if (format === 'direct') return directLink(file.link)
  return file.type.startsWith('image/')
    ? `![${label(file.name)}](${address(directLink(file.link))})`
    : `[${label(file.name)}](${address(file.link)})`
}
