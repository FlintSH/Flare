/**
 * The files this page uploaded a moment ago, by file ID. The background
 * work reads the text of a new image from here and does not download it
 * again (docs/e2ee-spec.md, section 9.6.2: "at the time of the upload").
 * Only references that the page holds anyway: nothing is copied or stored,
 * and a reload empties it.
 */
const LIMIT = 40
const files = new Map<string, Blob>()

export function rememberLocalFile(id: string, file: Blob) {
  files.delete(id)
  files.set(id, file)
  while (files.size > LIMIT) files.delete(files.keys().next().value!)
}

/** The file, one time: the work that asked for it is the only reader. */
export function takeLocalFile(id: string): Blob | null {
  const file = files.get(id) ?? null
  files.delete(id)
  return file
}

export function forgetLocalFiles() {
  files.clear()
}
