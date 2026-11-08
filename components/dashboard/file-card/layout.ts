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

export function fileCardHeight(compact: boolean, coarse: boolean, scale = 1) {
  // Preview stages stay fixed while text and label rows can grow. The
  // virtualizer measures the final content after these initial estimates.
  const previewHeight = coarse && !compact ? 128 : 112
  return previewHeight + (coarse ? 116 : 80) * scale + 4
}
