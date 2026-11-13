import type { Prisma } from '@prisma/client'

import { lockUploadProfiles } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { nameKey } from '@/lib/library/names'
import { removeTagFromProfiles } from '@/lib/uploads/profiles'

import type { RuleSource, TagInput, TagView } from './schema'
import { TagError } from './service'

// An account's tags themselves. Kept apart from service.ts because deleting a
// tag edits upload profiles, which check their tags through service.ts.

const tagViewSelect = {
  id: true,
  name: true,
  ruleSource: true,
  ruleText: true,
  _count: { select: { files: { where: { excluded: false } } } },
} satisfies Prisma.VaultTagSelect

function tagView(
  tag: Prisma.VaultTagGetPayload<{ select: typeof tagViewSelect }>
): TagView {
  return {
    id: tag.id,
    name: tag.name,
    ruleSource: tag.ruleSource as RuleSource | null,
    ruleText: tag.ruleText,
    fileCount: tag._count.files,
  }
}

export async function listTags(userId: string): Promise<TagView[]> {
  // Count each of this account's tags through the (tagId, excluded) index.
  // Selecting `_count` with the list made PostgreSQL count the files of every
  // tag on the instance before joining this account's.
  const tags = await prisma.$queryRaw<
    (Omit<TagView, 'fileCount'> & { fileCount: bigint })[]
  >`
    SELECT tag.id, tag.name, tag."ruleSource", tag."ruleText",
      (SELECT COUNT(*) FROM "VaultFileTag" link
        WHERE link."tagId" = tag.id AND link.excluded = false) AS "fileCount"
    FROM "VaultTag" tag
    WHERE tag."userId" = ${userId}
    ORDER BY tag."normalizedName" ASC
  `
  return tags.map((tag) => ({ ...tag, fileCount: Number(tag.fileCount) }))
}

export async function createTag(userId: string, input: TagInput) {
  const tag = await prisma.vaultTag.create({
    data: { ...input, userId, normalizedName: nameKey(input.name) },
    select: tagViewSelect,
  })
  return tagView(tag)
}

/** Renames a tag or changes its rule; files it already labels keep it. */
export async function updateTag(userId: string, id: string, input: TagInput) {
  const tag = await prisma.vaultTag.update({
    where: { id, userId },
    data: { ...input, normalizedName: nameKey(input.name) },
    select: tagViewSelect,
  })
  return tagView(tag)
}

/** Removes a tag from its files and from the upload profiles that select it. */
export async function deleteTag(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockUploadProfiles(tx, userId)
    const removed = await tx.vaultTag.deleteMany({ where: { id, userId } })
    if (!removed.count) throw new TagError('Tag not found.', 404)
    await removeTagFromProfiles(tx, userId, id)
  })
}
