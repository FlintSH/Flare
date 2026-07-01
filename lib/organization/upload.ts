import { prisma } from '@/lib/database/prisma'
import { isOrganizationEnabled } from '@/lib/organization'
import { normalizeTagName } from '@/lib/tags/normalize'

export interface ResolvedUploadOrganization {
  folderId: string | null
  tagIds: string[]
}

/**
 * Resolves the optional `folderId` and `tags` supplied at upload time into a
 * validated folder id and a set of tag ids owned by the user.
 *
 * - When organization is disabled instance-wide, both are ignored.
 * - An invalid/foreign folder id is ignored (the upload still succeeds, unfiled)
 *   so scripted uploads (e.g. ShareX) never fail on a stale folder reference.
 * - Each tag token is matched to an existing tag by id or (case-insensitive)
 *   name; unknown names are created on the fly. This lets clients pass either
 *   tag ids or human-friendly names.
 */
export async function resolveUploadOrganization(
  userId: string,
  rawFolderId: string | null | undefined,
  rawTags: string[] | undefined
): Promise<ResolvedUploadOrganization> {
  if (!(await isOrganizationEnabled())) {
    return { folderId: null, tagIds: [] }
  }

  let folderId: string | null = null
  if (rawFolderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: rawFolderId, userId },
      select: { id: true },
    })
    folderId = folder?.id ?? null
  }

  const tagIds: string[] = []
  const tokens = (rawTags ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  if (tokens.length > 0) {
    const existingTags = await prisma.tag.findMany({
      where: { userId },
      select: { id: true, name: true },
    })
    const byId = new Map(existingTags.map((t) => [t.id, t]))
    const byName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))

    for (const token of tokens) {
      if (byId.has(token)) {
        if (!tagIds.includes(token)) tagIds.push(token)
        continue
      }
      const name = normalizeTagName(token)
      if (!name) continue
      const existing = byName.get(name.toLowerCase())
      if (existing) {
        if (!tagIds.includes(existing.id)) tagIds.push(existing.id)
        continue
      }
      const created = await prisma.tag.create({
        data: { name, userId },
        select: { id: true, name: true },
      })
      byId.set(created.id, created)
      byName.set(created.name.toLowerCase(), created)
      tagIds.push(created.id)
    }
  }

  return { folderId, tagIds }
}
