/**
 * Files pasted onto the Upload page. Browser-safe, no React.
 */

/**
 * Browsers name a copied screenshot or image `image.png`, so several pastes
 * would all upload under one name. Give those the time they were pasted;
 * a copied file keeps its own name.
 */
export function namePastedFile(file: File, now: Date): File {
  if (!/^image\.[a-z0-9]+$/i.test(file.name)) return file
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return new File([file], `Pasted image ${stamp}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

/**
 * Whether a paste belongs to something else on the page: a field being
 * typed in, or an open dialog or menu.
 */
export function pasteBelongsElsewhere(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'
    )
  )
}
