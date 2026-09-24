import type { FolderView } from './schema'

export function folderTrail(
  folders: FolderView[],
  id: string | null
): FolderView[] {
  const trail: FolderView[] = []
  const visited = new Set<string>()
  let current = folders.find((folder) => folder.id === id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    trail.unshift(current)
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return trail
}

export function folderPath(folders: FolderView[], id: string): string {
  return folderTrail(folders, id)
    .map((folder) => folder.name)
    .join(' / ')
}
