// Image stages and initial placeholders share conservative default estimates.
// Generic cards are shorter; the virtualizer measures actual row content.
export const fileCardPreviewClassName =
  'h-28 [@media(pointer:coarse)]:h-36 sm:[@media(pointer:coarse)]:h-32'
export const fileCardGenericPreviewClassName = 'h-[52px]'
export const fileCardDetailsClassName =
  'flex flex-col gap-1 border-t border-border/40 px-2 py-1 [@media(pointer:coarse)]:gap-0'
export const fileCardNameRowClassName =
  'flex min-h-7 min-w-0 items-center justify-between gap-2 border-b border-border/40 px-2 py-1 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:items-start'
export const fileCardLabelsClassName =
  'flex min-h-6 min-w-0 flex-wrap items-center gap-1.5 [@media(pointer:coarse)]:min-h-11'
export const fileCardActivityClassName =
  'mt-auto flex min-h-4 flex-wrap items-center gap-x-3 text-xs text-muted-foreground'

const filenameGraphemes = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

export function fileCardFilenameParts(name: string) {
  const match = name.match(/^(.+)(\.[A-Za-z0-9]{1,16})$/)
  const stem = match?.[1] ?? name
  const graphemes = Array.from(
    filenameGraphemes.segment(stem),
    ({ segment }) => segment
  )
  let split = graphemes.length > 20 ? graphemes.length - 12 : graphemes.length
  // Keep whitespace inside a display fragment. Text normalization must not
  // remove a filename's space between its two rendered parts.
  while (
    split > 0 &&
    (/\s/u.test(graphemes[split - 1]) ||
      (split < graphemes.length && /\s/u.test(graphemes[split])))
  )
    split--
  return {
    start: graphemes.slice(0, split).join(''),
    tail: graphemes.slice(split).join(''),
    extension: match?.[2] ?? '',
  }
}

export function fileCardHeight(compact: boolean, coarse: boolean, scale = 1) {
  // Default rem-sized content plus four 1px borders. Larger content is measured
  // by the virtualizer; root text enlargement also scales these first estimates.
  const previewHeight = coarse ? (compact ? 144 : 128) : 112
  return (previewHeight + (coarse ? 116 : 80)) * scale + 4
}
