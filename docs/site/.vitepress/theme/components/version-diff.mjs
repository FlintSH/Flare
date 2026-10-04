import { diffLines } from 'diff'

// Compute only the chosen file's patch. Large rewrites have a bounded runtime.
export function compareFile(before = '', after = '') {
  return (
    diffLines(before, after, { timeout: 300 }) || [
      { removed: true, value: before },
      { added: true, value: after },
    ]
  )
}

export function changedFiles(before, after) {
  return [
    ...new Set([...Object.keys(before.files), ...Object.keys(after.files)]),
  ]
    .sort(
      (a, b) =>
        Number(!a.endsWith('.md')) - Number(!b.endsWith('.md')) ||
        a.localeCompare(b)
    )
    .filter(
      (path) => before.files[path]?.content !== after.files[path]?.content
    )
    .map((path) => ({
      path,
      status: !before.files[path]
        ? 'Added'
        : !after.files[path]
          ? 'Removed'
          : 'Changed',
      before: before.files[path],
      after: after.files[path],
    }))
}
