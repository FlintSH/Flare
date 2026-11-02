import { buttonVariants } from '@/components/ui/button'

import { cn } from '@/lib/utils'

/** One compact width for short numbers and their units (sizes, limits). */
export const numberFieldClassName = 'w-28'

/**
 * For native colour inputs: the browser draws the chosen colour as a
 * square swatch in a grey frame. This fills the control with a rounded
 * swatch instead, so it matches the outlined inputs beside it.
 */
export const colorSwatchClassName =
  '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0'

/*
 * Long form dialogs (New user, Edit user, Create invite link): the title and
 * the actions stay in view while the fields scroll between them.
 *
 * - formDialogClassName goes on DialogContent. The dialog may grow to 1rem
 *   from the screen edges (its side margin on phones) before its fields
 *   scroll. On a screen too short for even the title and actions, the whole
 *   dialog scrolls instead.
 * - formDialogBodyClassName goes on the scrolling body, with
 *   ref={scrollFadeRef}, so its cut edge fades while there is more. Its
 *   padding leaves room for the fields' focus rings.
 * - formDialogFooterClassName puts a hairline above the DialogFooter, which
 *   keeps its usual arrangement.
 */
export const formDialogClassName =
  'flex max-h-[calc(100dvh-2rem)] flex-col [&>div:first-child]:flex [&>div:first-child]:min-h-0 [&>div:first-child]:flex-col [&>div:first-child]:gap-5 [&>div:first-child]:space-y-0'
export const formDialogBodyClassName =
  'scroll-fade scroll-fade-tall -m-1 min-h-0 flex-1 space-y-5 overflow-y-auto p-1'
export const formDialogFooterClassName = 'mt-4 shrink-0 border-t pt-4'

/** The destructive button style for a confirming AlertDialogAction. */
export const destructiveActionClassName = cn(
  buttonVariants({ variant: 'destructive' }),
  'hover:bg-destructive-fill'
)
