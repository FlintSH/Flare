/**
 * Whether a page handles pastes itself. Upload, Paste and Links read what is
 * pasted on them in their own way, so the dashboard's paste-anywhere card
 * stays out of their way while they are open.
 */
let claims = 0

/** Marks pastes as this page's until the returned function is called. */
export function claimPaste() {
  claims += 1
  let released = false
  return () => {
    if (released) return
    released = true
    claims -= 1
  }
}

export function pasteClaimed() {
  return claims > 0
}

/** Whether a paste on `target` goes into something being typed in. */
export function isEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
    )
  )
}
