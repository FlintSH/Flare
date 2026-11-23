/**
 * A file's or a short link's sheet is addressed by a `file` or `link` query
 * on whichever dashboard page is open, so Back closes it and its address
 * opens it again. Browser-safe.
 */
export const FILE_SHEET_PARAM = 'file'
export const LINK_SHEET_PARAM = 'link'

type Where = { pathname: string; search: string }

function sheetHref(where: Where, param: string, id: string | null) {
  const params = new URLSearchParams(where.search)
  params.delete(FILE_SHEET_PARAM)
  params.delete(LINK_SHEET_PARAM)
  if (id) params.set(param, id)
  const query = params.toString()
  return query ? `${where.pathname}?${query}` : where.pathname
}

/** The current page's address with a file's sheet open on `id`, or closed. */
export const fileSheetHref = (where: Where, id: string | null) =>
  sheetHref(where, FILE_SHEET_PARAM, id)

/** The current page's address with a short link's sheet open on `id`. */
export const linkSheetHref = (where: Where, id: string) =>
  sheetHref(where, LINK_SHEET_PARAM, id)

const OPEN_EVENT = 'flare:open-sheet'
type Opening = { kind: 'file' | 'link'; id: string }

/** Opens a file's sheet from anywhere, including outside React. */
export function openFileSheet(id: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { kind: 'file', id } })
  )
}

/** Opens a short link's sheet from anywhere. */
export function openLinkSheet(id: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { kind: 'link', id } })
  )
}

/** For the sheets' host: hears `openFileSheet` and `openLinkSheet`. */
export function onOpenSheet(open: (opening: Opening) => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Partial<Opening>>).detail
    if ((detail?.kind === 'file' || detail?.kind === 'link') && detail.id)
      open({ kind: detail.kind, id: detail.id })
  }
  window.addEventListener(OPEN_EVENT, listener)
  return () => window.removeEventListener(OPEN_EVENT, listener)
}

const VIEW_IMAGE_EVENT = 'flare:view-image'

/**
 * Asks the library, when it's open, to show an image in its full-screen
 * viewer, which steps through the library's images. Answers whether one
 * took it.
 */
export function viewImage(file: { id: string }) {
  const event = new CustomEvent(VIEW_IMAGE_EVENT, {
    detail: file,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** For the library: shows images other places ask it to. */
export function onViewImage<File extends { id: string }>(
  view: (file: File) => boolean
) {
  // Taken only when the library can show it; otherwise the picture opens
  // on its own.
  const listener = (event: Event) => {
    if (view((event as CustomEvent<File>).detail)) event.preventDefault()
  }
  window.addEventListener(VIEW_IMAGE_EVENT, listener)
  return () => window.removeEventListener(VIEW_IMAGE_EVENT, listener)
}

/**
 * The files the library shows, in its order, so an open sheet can step to
 * the one before or after with the arrow keys.
 */
let order: readonly string[] = []

export function setSheetOrder(ids: readonly string[]) {
  order = ids
}

/** The file beside `id` in the library's order, or null at either end. */
export function sheetNeighbor(id: string, step: -1 | 1) {
  const index = order.indexOf(id)
  if (index === -1) return null
  return order[index + step] ?? null
}

/** What had focus when a sheet opened, to return it there on close. */
let opener: { element: HTMLElement | null; id: string } | null = null

/** Marks a control that opens the sheet of the file or link `id`. */
export const SHEET_OPENER = 'data-sheet-opener'

export function rememberOpener(id: string) {
  const active = document.activeElement
  opener = {
    element:
      active instanceof HTMLElement && active !== document.body ? active : null,
    id,
  }
}

/**
 * Focuses what opened the sheet; when a list drew it again meanwhile, the
 * control now opening the same file or link, waiting a moment for the list
 * to come back.
 */
export function returnToOpener() {
  const remembered = opener
  opener = null
  if (!remembered) return
  const started = performance.now()
  const attempt = () => {
    const element = remembered.element?.isConnected
      ? remembered.element
      : document.querySelector<HTMLElement>(
          `[${SHEET_OPENER}="${CSS.escape(remembered.id)}"]`
        )
    // Something else took focus meanwhile (a click, another dialog).
    const free =
      document.activeElement === document.body || !document.activeElement
    if (element && free) element.focus({ preventScroll: true })
    else if (!element && free && performance.now() - started < 600)
      requestAnimationFrame(attempt)
  }
  attempt()
}

/** The sheet moved on to another file: closing returns focus to its card. */
export function retargetOpener(id: string) {
  opener = { element: null, id }
}
