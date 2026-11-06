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

export async function listTags(userId: string) {
  const tags = await prisma.vaultTag.findMany({
    where: { userId },
    orderBy: { normalizedName: 'asc' },
    select: tagViewSelect,
  })
  return tags.map(tagView)
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
