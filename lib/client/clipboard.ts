/**
 * Copying a link that is still being made. Browsers only let a page write to
 * the clipboard during the click or key press that asked for it, and a paste
 * or short link exists only after a request. Handing the clipboard a pending
 * value from inside that gesture keeps the permission until the link arrives.
 * Answers whether the link was copied; nothing is copied when it never
 * arrives.
 */
export function copyWhenReady(text: Promise<string>): Promise<boolean> {
  const clipboard =
    typeof navigator === 'undefined' ? null : navigator.clipboard
  if (!clipboard)
    return text.then(
      () => false,
      () => false
    )
  if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
    try {
      const item = new ClipboardItem({
        'text/plain': text.then(
          (value) => new Blob([value], { type: 'text/plain' })
        ),
      })
      return clipboard.write([item]).then(
        () => true,
        // Browsers that refuse a pending value still allow a write soon
        // after the gesture.
        () => writeText(text)
      )
    } catch {
      /* A browser without pending values: write once the text exists. */
    }
  }
  return writeText(text)
}

function writeText(text: Promise<string>) {
  return text
    .then(
      (value) => navigator.clipboard.writeText(value).then(() => true),
      () => false
    )
    .catch(() => false)
}

/** Copies text now, from a click or key press. Answers whether it worked. */
export function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard)
    return Promise.resolve(false)
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false
  )
}
