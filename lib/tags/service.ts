import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { type RuleSource, matchesTagRule } from '@/lib/tags/schema'

export class TagError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'TagError'
  }
}

export const tagViewSelect = {
  id: true,
  name: true,
  ruleSource: true,
  ruleText: true,
  _count: { select: { files: { where: { excluded: false } } } },
} satisfies Prisma.VaultTagSelect

export function tagView(
  tag: Prisma.VaultTagGetPayload<{ select: typeof tagViewSelect }>
) {
  return {
    id: tag.id,
    name: tag.name,
    ruleSource: tag.ruleSource as RuleSource | null,
    ruleText: tag.ruleText,
    fileCount: tag._count.files,
  }
}

export async function validateOwnedTagIds(
  userId: string,
  tagIds: string[],
  transaction?: Prisma.TransactionClient
): Promise<string[]> {
  const ids = [...new Set(tagIds)]
  if (ids.length > 20) throw new TagError('Choose up to 20 tags.')
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

/** Explicit backfill. Editing a rule never silently retags the existing vault. */
export async function applyTagToExistingFiles(
  userId: string,
  tagId: string
): Promise<number> {
  const tag = await prisma.vaultTag.findFirst({
    where: { id: tagId, userId },
    select: { id: true, ruleSource: true, ruleText: true },
  })
  if (!tag) throw new TagError('Tag not found.', 404)
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
