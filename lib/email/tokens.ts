import type { Prisma } from '@prisma/client'
import { createHash, randomBytes } from 'node:crypto'

export type EmailTokenPurpose =
  'verify' | 'reset' | 'change' | 'change_approval'

export function hashEmailToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueEmailToken(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    email: string
    purpose: EmailTokenPurpose
    expiresAt: Date
  }
) {
  const token = randomBytes(32).toString('base64url')
  await tx.emailToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  const record = await tx.emailToken.create({
    data: { ...input, tokenHash: hashEmailToken(token) },
  })
  return { token, record }
}

export async function consumeEmailToken(
  tx: Prisma.TransactionClient,
  token: string,
  purposes: EmailTokenPurpose[]
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('This email link is invalid or expired.')
  const record = await tx.emailToken.findUnique({
    where: { tokenHash: hashEmailToken(token) },
  })
  if (
    !record ||
    record.consumedAt ||
    record.expiresAt <= new Date() ||
    !purposes.includes(record.purpose as EmailTokenPurpose)
  ) {
    throw new Error('This email link is invalid or expired.')
  }
  // Account mutations and issuance take the same lock before touching tokens.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${record.userId} FOR UPDATE`
  const consumed = await tx.emailToken.updateMany({
    where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })
  if (consumed.count !== 1)
    throw new Error('This email link is invalid or expired.')
  return record
}

export async function invalidateEmailTokens(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.emailToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  })
}
