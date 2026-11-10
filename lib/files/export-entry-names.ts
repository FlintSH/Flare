import { uploadDisplayName } from '@/lib/uploads/display-name'

/**
 * The last path segment without control characters or `..`, as
 * `sanitizeDisplayName` gives it. Written out here so the browser can name
 * the entries of an export it builds itself (docs/e2ee-spec.md, section
 * 12.4): that module imports `node:path`.
 */
function displayName(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.\./g, '')
  return cleaned.replace(/\/+$/, '').split('/').at(-1) || 'download'
}

/**
 * Names each file's entry in a data export: `files/<upload date>/<name>`,
 * numbered before the extension when that name is already taken that day,
 * as in `report (2).pdf`. Extraction on Windows and macOS is
 * case-insensitive, so `Report.PDF` and `report.pdf` also count as a clash.
 */
export function exportEntryNamer() {
  const used = new Set<string>()
  // Where the search for a free copy number resumes, per folder and name.
  // Every number below it is taken, so each repeat costs one lookup rather
  // than one per earlier copy. `used` still catches a literal file named
  // like a numbered copy.
  const nextCopy = new Map<string, number>()
  return (file: {
    name: string
    uploadedAt: Date | string
    encrypted?: boolean
    urlPath?: string
  }) => {
    const folder = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}`
    // The server has no name for an encrypted file. Its entry is the
    // ciphertext, named by the public file identifier.
    const encryptedName =
      file.encrypted && file.urlPath
        ? `${file.urlPath.split('/').at(-1)}.flare-encrypted`
        : null
    // Older chunked uploads could save a path as the name; keep its last part.
    const name =
      encryptedName ?? displayName(uploadDisplayName(file.name) ?? '')
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    const key = `${folder}/${name}`.toLowerCase()
    for (let copy = nextCopy.get(key) ?? 1; ; copy++) {
      const entry = `${folder}/${copy === 1 ? name : `${stem} (${copy})${extension}`}`
      if (!used.has(entry.toLowerCase())) {
        used.add(entry.toLowerCase())
        nextCopy.set(key, copy + 1)
        return entry
      }
    }
  }
}
