import type { FolderBreadcrumbItem, FolderDTO } from '@/types/dto/folder'

interface FolderLike {
  id: string
  name: string
  parentId: string | null
  fileCount: number
}

export type FolderTreeNodeOf<T extends FolderLike> = T & {
  children: FolderTreeNodeOf<T>[]
  totalFileCount: number
}

/**
 * Converts a flat list of folders into a nested tree, sorted alphabetically at
 * each level. `totalFileCount` aggregates a folder's own files plus those of
 * all descendants. Generic over the folder shape so it works for both server
 * DTOs (Date timestamps) and client models (string timestamps).
 */
export function buildFolderTree<T extends FolderLike>(
  folders: T[]
): FolderTreeNodeOf<T>[] {
  const nodes = new Map<string, FolderTreeNodeOf<T>>()

  for (const folder of folders) {
    nodes.set(folder.id, {
      ...folder,
      children: [],
      totalFileCount: folder.fileCount,
    })
  }

  const roots: FolderTreeNodeOf<T>[] = []

  for (const folder of folders) {
    const node = nodes.get(folder.id)!
    if (folder.parentId && nodes.has(folder.parentId)) {
      nodes.get(folder.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Roll up descendant file counts depth-first.
  const computeTotals = (node: FolderTreeNodeOf<T>): number => {
    let total = node.fileCount
    for (const child of node.children) {
      total += computeTotals(child)
    }
    node.totalFileCount = total
    return total
  }
  for (const root of roots) {
    computeTotals(root)
  }

  const sortRecursive = (list: FolderTreeNodeOf<T>[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of list) {
      sortRecursive(node.children)
    }
  }
  sortRecursive(roots)

  return roots
}

// Convenience alias for the common server-side case.
export type ServerFolderTree = FolderTreeNodeOf<FolderDTO>

/**
 * Returns the ids of every descendant of `folderId` (not including itself).
 */
export function getDescendantIds(
  folders: Pick<FolderDTO, 'id' | 'parentId'>[],
  folderId: string
): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (folder.parentId) {
      const list = childrenByParent.get(folder.parentId) ?? []
      list.push(folder.id)
      childrenByParent.set(folder.parentId, list)
    }
  }

  const result: string[] = []
  const stack = [...(childrenByParent.get(folderId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    result.push(current)
    const children = childrenByParent.get(current)
    if (children) stack.push(...children)
  }
  return result
}

/**
 * Determines whether moving `movingId` under `newParentId` would create a cycle.
 * Moving a folder into itself or any of its descendants is forbidden.
 */
export function wouldCreateCycle(
  folders: Pick<FolderDTO, 'id' | 'parentId'>[],
  movingId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false
  if (newParentId === movingId) return true
  const descendants = getDescendantIds(folders, movingId)
  return descendants.includes(newParentId)
}

/**
 * Builds the breadcrumb (root → ... → folder) for a given folder id.
 */
export function getBreadcrumb(
  folders: Pick<FolderDTO, 'id' | 'name' | 'parentId'>[],
  folderId: string
): FolderBreadcrumbItem[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const trail: FolderBreadcrumbItem[] = []
  let current = byId.get(folderId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    trail.unshift({ id: current.id, name: current.name })
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return trail
}
