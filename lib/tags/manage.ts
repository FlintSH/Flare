import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'

import { lockUploadProfiles, lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { nameKey } from '@/lib/library/names'
import { wireBytes } from '@/lib/library/sealed-fields'
import { removeTagFromProfiles } from '@/lib/uploads/profiles'

import type { RuleSource, SealTagsInput, TagInput, TagView } from './schema'
import { TagError } from './service'

// An account's tags themselves. Kept apart from service.ts because deleting a
// tag edits upload profiles, which check their tags through service.ts.

/** A tag that has a sealed record stores this in place of its name (section 9.5.2). */
export const sealedTagKey = (id: string) => `/sealed/${id}`

const KEYS_REQUIRED =
  'This account keeps tag names and rules encrypted. Change tags in Flare, in a browser where your keys are unlocked.'

const tagViewSelect = {
  id: true,
  name: true,
  ruleSource: true,
  ruleText: true,
  sealedTagMetadata: true,
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
    sealed: wireBytes(tag.sealedTagMetadata),
  }
}

export async function listTags(userId: string) {
  const tags = await prisma.vaultTag.findMany({
    where: { userId },
    // The server cannot order sealed names: the client sorts what it opens.
    orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
    select: tagViewSelect,
  })
  return tags.map(tagView)
}

async function accountHasKeys(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountPublicKey: true },
  })
  return Boolean(user?.accountPublicKey)
}

/** The columns of a tag for its input: sealed, with no name and no rule, or plain. */
async function tagColumns(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  input: TagInput
) {
  const keyed = await accountHasKeys(tx, userId)
  if ('sealedTagMetadata' in input) {
    if (!keyed)
      throw new TagError(
        'Set up your encryption keys before storing sealed tags.',
        409
      )
    return {
      name: '',
      normalizedName: sealedTagKey(id),
      ruleSource: null,
      ruleText: null,
      sealedTagMetadata: input.sealedTagMetadata,
    }
  }
  if (keyed) throw new TagError(KEYS_REQUIRED, 409)
  return { ...input, normalizedName: nameKey(input.name) }
}

export async function createTag(userId: string, input: TagInput) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    // A sealed tag needs its ID for the key that stands in for its name.
    const id = `t${randomBytes(12).toString('hex')}`
    const tag = await tx.vaultTag.create({
      data: { id, userId, ...(await tagColumns(tx, userId, id, input)) },
      select: tagViewSelect,
    })
    return tagView(tag)
  })
}

/** Renames a tag or changes its rule; files it already labels keep it. */
export async function updateTag(userId: string, id: string, input: TagInput) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const tag = await tx.vaultTag.update({
      where: { id, userId },
      data: await tagColumns(tx, userId, id, input),
      select: tagViewSelect,
    })
    return tagView(tag)
  })
}

/**
 * Stores the sealed records that the owner's browser made for tags from
 * before encryption, and deletes their plain names and rules (section 9.5).
 * A tag that is sealed already is left as it is: two tabs can convert at
 * the same time.
 */
export async function sealTags(userId: string, input: SealTagsInput) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    if (!(await accountHasKeys(tx, userId)))
      throw new TagError('Set up your encryption keys first.', 409)
    let sealed = 0
    for (const entry of input.tags) {
      const changed = await tx.vaultTag.updateMany({
        where: { id: entry.id, userId, sealedTagMetadata: null },
        data: {
          name: '',
          normalizedName: sealedTagKey(entry.id),
          ruleSource: null,
          ruleText: null,
          sealedTagMetadata: entry.sealedTagMetadata,
        },
      })
      sealed += changed.count
    }
    // The plain names of these tags leave the audit records that were
    // written while the server had them: the events of each tag, and the
    // events of its files, which name the tag (section 9.5).
    const ids = input.tags.map((entry) => entry.id)
    const owned = (
      await tx.vaultTag.findMany({
        where: { userId, id: { in: ids }, sealedTagMetadata: { not: null } },
        select: { id: true },
      })
    ).map((tag) => tag.id)
    if (sealed && owned.length) {
      await tx.$executeRaw`
        UPDATE "AuditEvent" SET "targetName" = NULL,
          details = details #- '{before,name}' #- '{after,name}'
        WHERE "targetType" = 'tag' AND "targetId" = ANY(${owned})`
      await tx.$executeRaw`
        UPDATE "AuditEvent" SET details = details - 'tagName'
        WHERE "targetType" = 'file_tag' AND details ? 'tagName'
          AND (details->'after'->>'tagId' = ANY(${owned})
            OR details->'before'->>'tagId' = ANY(${owned}))`
    }
    return { sealed }
  })
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
