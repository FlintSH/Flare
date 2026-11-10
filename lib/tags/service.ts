import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { type RuleSource, matchesTagRule } from '@/lib/tags/schema'
import { PROFILE_TAG_LIMIT } from '@/lib/uploads/schema'

export class TagError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message)
    this.name = 'TagError'
  }
}

export async function validateOwnedTagIds(
  userId: string,
  tagIds: string[],
  transaction?: Prisma.TransactionClient
): Promise<string[]> {
  const ids = [...new Set(tagIds)]
  if (ids.length > PROFILE_TAG_LIMIT)
    throw new TagError(`Choose up to ${PROFILE_TAG_LIMIT} tags.`)
  if (!ids.length) return ids
  const count = await (transaction ?? prisma).vaultTag.count({
    where: { userId, id: { in: ids } },
  })
  if (count !== ids.length)
    throw new TagError(
      'One or more tags are unavailable. Choose your tags again.'
    )
  return ids
}

export async function applyProfileTags(
  transaction: Prisma.TransactionClient,
  file: { id: string; userId: string },
  tagIds: string[]
): Promise<void> {
  const ids = await validateOwnedTagIds(file.userId, tagIds, transaction)
  if (!ids.length) return
  await transaction.vaultFileTag.createMany({
    data: ids.map((tagId) => ({ fileId: file.id, tagId })),
    skipDuplicates: true,
  })
}

/** Called after a file name or OCR text is saved; safe to repeat on retries. */
export async function applyAutomaticTags(
  fileId: string,
  source: RuleSource,
  transaction?: Prisma.TransactionClient
): Promise<number> {
  const db = transaction ?? prisma
  const file = await db.file.findUnique({
    where: { id: fileId },
    select: { id: true, userId: true, name: true, ocrText: true },
  })
  if (!file) return 0
  const tags = await db.vaultTag.findMany({
    where: { userId: file.userId, ruleSource: source },
    select: { id: true, ruleText: true },
  })
  const text = source === 'filename' ? file.name : file.ocrText
  const matching = tags.filter((tag) =>
    matchesTagRule(text, tag.ruleText ?? '')
  )
  if (!matching.length) return 0
  // Existing associations include exclusions, so skipDuplicates preserves both
  // manual additions and removals across automatic processing and retries.
  const result = await db.vaultFileTag.createMany({
    data: matching.map((tag) => ({ fileId, tagId: tag.id })),
    skipDuplicates: true,
  })
  return result.count
}

export async function changeFileTags(
  userId: string,
  input: { fileIds: string[]; tagId: string; action: 'add' | 'remove' }
): Promise<number> {
  const fileIds = [...new Set(input.fileIds)]
  return prisma.$transaction(async (tx) => {
    const tag = await tx.vaultTag.findFirst({
      where: { id: input.tagId, userId },
      select: { id: true },
    })
    if (!tag) throw new TagError('Tag not found.', 404)
    const ownedFiles = await tx.file.count({
      where: { id: { in: fileIds }, userId },
    })
    if (ownedFiles !== fileIds.length)
      throw new TagError('One or more files are unavailable.', 404)
    const excluded = input.action === 'remove'
    await tx.vaultFileTag.createMany({
      data: fileIds.map((fileId) => ({ fileId, tagId: tag.id, excluded })),
      skipDuplicates: true,
    })
    await tx.vaultFileTag.updateMany({
      where: { fileId: { in: fileIds }, tagId: tag.id },
      data: { excluded },
    })
    return fileIds.length
  })
}

/**
 * Adds a tag to files that its rule matches, as the owner's browser found
 * them (docs/e2ee-spec.md, section 9.8.3). The server cannot read the rule
 * of a sealed tag. A tag that the owner removed from a file by hand stays
 * removed, as with every automatic rule.
 */
export async function applyTagToFiles(
  userId: string,
  tagId: string,
  fileIds: string[]
): Promise<number> {
  const ids = [...new Set(fileIds)]
  return prisma.$transaction(async (tx) => {
    const tag = await tx.vaultTag.findFirst({
      where: { id: tagId, userId },
      select: { id: true },
    })
    if (!tag) throw new TagError('Tag not found.', 404)
    const owned = await tx.file.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true },
    })
    if (!owned.length) return 0
    const result = await tx.vaultFileTag.createMany({
      data: owned.map((file) => ({ fileId: file.id, tagId: tag.id })),
      skipDuplicates: true,
    })
    return result.count
  })
}

/** Explicit backfill. Editing a rule never silently retags the existing vault. */
export async function applyTagToExistingFiles(
  userId: string,
  tagId: string
): Promise<number> {
  const tag = await prisma.vaultTag.findFirst({
    where: { id: tagId, userId },
    select: {
      id: true,
      ruleSource: true,
      ruleText: true,
      sealedTagMetadata: true,
    },
  })
  if (!tag) throw new TagError('Tag not found.', 404)
  if (tag.sealedTagMetadata)
    throw new TagError(
      'The rule of this tag is encrypted, so the server cannot apply it. Apply it in Flare, in a browser where your keys are unlocked.',
      409
    )
  if (!tag.ruleSource || !tag.ruleText)
    throw new TagError(
      'Add an automatic rule before applying it to existing files.'
    )

  let cursor: string | undefined
  let count = 0
  // Read bounded pages and compare in JS so '%' and '_' remain literal text.
  // A fixed boundary avoids sweeping uploads arriving while this scan runs.
  const through = new Date()
  for (;;) {
    const files = await prisma.file.findMany({
      where: {
        userId,
        uploadedAt: { lte: through },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true, name: true, ocrText: true },
    })
    if (!files.length) break
    const matching = files.filter((file) =>
      matchesTagRule(
        tag.ruleSource === 'filename' ? file.name : file.ocrText,
        tag.ruleText!
      )
    )
    if (matching.length) {
      const result = await prisma.vaultFileTag.createMany({
        data: matching.map((file) => ({ fileId: file.id, tagId })),
        skipDuplicates: true,
      })
      count += result.count
    }
    if (files.length < 500) break
    cursor = files[files.length - 1].id
  }
  return count
}
