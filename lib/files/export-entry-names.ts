import { sanitizeDisplayName } from '@/lib/security/paths'
import { uploadDisplayName } from '@/lib/uploads/display-name'

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
  return (file: { name: string; uploadedAt: Date }) => {
    const folder = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}`
    // Older chunked uploads could save a path as the name; keep its last part.
    const name = sanitizeDisplayName(uploadDisplayName(file.name) ?? '')
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
