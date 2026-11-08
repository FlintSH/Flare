import type { LibraryView } from '@/lib/library/view'

// Image stages and initial placeholders share conservative default estimates.
// Generic cards are shorter; the virtualizer measures actual row content.
export const fileCardPreviewClassName =
  'h-[112px] sm:[@media(pointer:coarse)]:h-[128px]'
export const fileCardDetailsClassName =
  'flex flex-col gap-1 border-t border-border/40 px-2 py-1 [@media(pointer:coarse)]:gap-0'
export const fileCardNameRowClassName =
  'flex min-h-7 min-w-0 items-center justify-between gap-2 border-b border-border/40 px-2 py-1 [@media(pointer:coarse)]:min-h-[44px]'
export const fileCardLabelsClassName =
  'flex min-h-6 min-w-0 flex-wrap items-center gap-1.5'
export const fileCardActivityClassName =
  'mt-auto flex min-h-4 flex-wrap items-center gap-x-3 text-xs text-muted-foreground'

/** Password protection supplements visibility; it never replaces that fact. */
export function fileVisibilityText(
  visibility: 'PUBLIC' | 'PRIVATE',
  hasPassword: boolean
) {
  const label = visibility === 'PUBLIC' ? 'Public' : 'Private'
  return hasPassword ? `${label} · password protected` : label
}

const filenameGraphemes =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function fileCardFilenameParts(name: string) {
  const match = name.match(/^(.+)(\.[A-Za-z0-9]{1,16})$/)
  const stem = match?.[1] ?? name
  const graphemes = filenameGraphemes
    ? Array.from(filenameGraphemes.segment(stem), ({ segment }) => segment)
    : Array.from(stem)
  if (
    !filenameGraphemes &&
    graphemes.some((part) => part.charCodeAt(0) > 0x7f)
  ) {
    // Older supported browsers cannot find Unicode grapheme boundaries.
    // Keep the stem whole; only trailing whitespace has a safe separate slot.
    const separator = stem.match(/\s+$/u)?.[0] ?? ''
    return {
      start: separator ? stem.slice(0, -separator.length) : stem,
      separator,
      tail: '',
      extension: match?.[2] ?? '',
    }
  }
  const split = graphemes.length > 20 ? graphemes.length - 12 : graphemes.length
  // Preserve the separator without walking back into the preceding word.
  let separatorStart = split
  let separatorEnd = split
  while (separatorStart > 0 && /\s/u.test(graphemes[separatorStart - 1]))
    separatorStart--
  while (separatorEnd < graphemes.length && /\s/u.test(graphemes[separatorEnd]))
    separatorEnd++
  return {
    start: graphemes.slice(0, separatorStart).join(''),
    separator: graphemes.slice(separatorStart, separatorEnd).join(''),
    tail: graphemes.slice(separatorEnd).join(''),
    extension: match?.[2] ?? '',
  }
}

export type FileMenuSide = 'bottom' | 'left'

export function fileCardMenuSide(
  viewportWidth: number,
  rootFontSize: number
): FileMenuSide {
  // w-56 is 14rem; leave 4px offset plus 16px collision padding.
  // A 44px trigger at mid-screen has the least room on either side.
  return viewportWidth >= 640 &&
    14 * rootFontSize + 20 <= (viewportWidth - 44) / 2
    ? 'left'
    : 'bottom'
}

export function fileCardHeight(
  compact: boolean,
  coarse: boolean,
  scale = 1,
  view: LibraryView = 'gallery'
) {
  // An initial estimate only: the existing row observer supplies actual sizes.
  if (view === 'list') return Math.max(80, (coarse ? 128 : 80) * scale)
  // Preview stages stay fixed while text and label rows can grow. The
  // virtualizer measures the final content after these initial estimates.
  const previewHeight = coarse && !compact ? 128 : 112
  return previewHeight + (coarse ? 116 : 80) * scale + 4
}

// Empty label cells retain the same desktop columns across every List item.
export const fileListClassName =
  'grid grid-cols-[64px_minmax(0,1fr)_44px] items-start gap-x-2 gap-y-1 p-2 lg:grid-cols-[64px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_44px] lg:gap-x-3'
export const fileListNameClassName =
  'col-start-2 row-start-1 flex min-h-[44px] min-w-0 items-center'
export const fileListFactsClassName =
  'col-span-full row-start-2 min-w-0 lg:col-span-1 lg:col-start-3 lg:row-start-1'
export const fileListLabelsClassName =
  'col-span-full row-start-3 flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 lg:col-span-1 lg:col-start-4 lg:row-start-1'
export const fileListManageClassName =
  'col-start-3 row-start-1 w-[44px] min-w-[44px] lg:col-start-5'
