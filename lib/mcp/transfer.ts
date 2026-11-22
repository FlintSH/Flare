import type { Prisma } from '@prisma/client'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { hashApiToken } from '@/lib/integrations/tokens'
import { SWEEP_BATCH, inBatches } from '@/lib/oauth/cleanup'
import { isLinkToken, newLinkToken } from '@/lib/security/link-token'
import type { UploadRequestOptions } from '@/lib/uploads/schema'

import type { AgentPrincipal } from './auth'
import { ToolError } from './tool'

/** How long a download URL works. It can be used again, so ranges and resumes work. */
export const DOWNLOAD_MINUTES = 10
/** How long an upload URL waits for its one upload to start. */
export const UPLOAD_MINUTES = 15
/**
 * How long an upload URL is kept for the upload that took it. Its minutes
 * are for starting, and a large file can take far longer to arrive.
 */
export const UPLOAD_HOLD_HOURS = 24
/**
 * The transfer URLs of one kind a credential may have outstanding. Downloads
 * and uploads are counted apart, so reading many files cannot block uploads.
 */
export const MAX_OUTSTANDING_TRANSFERS = 20

/** A credential already has as many transfer URLs of one kind as it may. */
export class TransferLimitError extends ToolError {
  constructor(kind: string) {
    super(
      kind === 'upload'
        ? `This connection already has ${MAX_OUTSTANDING_TRANSFERS} upload URLs waiting. Use them, or wait: one that was never used expires ${UPLOAD_MINUTES} minutes after it was made, and one whose upload never finished after ${UPLOAD_HOLD_HOURS} hours.`
        : // A download link can be used again and again, so using one frees nothing.
          `This connection already has ${MAX_OUTSTANDING_TRANSFERS} download links waiting. Wait a few minutes for them to expire.`
    )
    this.name = 'TransferLimitError'
  }
}

export const TRANSFER_PATH = '/api/mcp/transfer'

/** What an upload URL fixes when it is made; the upload request cannot change any of it. */
export type UploadTransfer = {
  /** Replaces the name the upload request gives the file. */
  filename?: string
  options: UploadRequestOptions
  /** The file password as the file will store it; the password itself is never kept. */
  passwordHash?: string | null
}

type TransferRow = Prisma.AgentTransferGetPayload<object>

// A digest for looking up a high-entropy secret, as named tokens use.
const secretHash = hashApiToken

async function createTransfer(
  principal: AgentPrincipal,
  origin: string,
  minutes: number,
  data: Pick<Prisma.AgentTransferUncheckedCreateInput, 'kind'> &
    Partial<
      Pick<Prisma.AgentTransferUncheckedCreateInput, 'fileId' | 'options'>
    >
) {
  const owner = {
    userId: principal.user.id,
    credential: principal.credentialKey,
  }
  const now = new Date()
  const secret = newLinkToken()
  const expiresAt = new Date(now.getTime() + minutes * 60_000)
  // The account's row lock makes the count and the new row one step, so
  // simultaneous calls cannot pass the limit together.
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, owner.userId)
    // Expired URLs are cleared as new ones are made, on top of the periodic sweep.
    await tx.agentTransfer.deleteMany({
      where: { ...owner, expiresAt: { lte: now } },
    })
    if (
      (await tx.agentTransfer.count({
        where: { ...owner, kind: data.kind },
      })) >= MAX_OUTSTANDING_TRANSFERS
    )
      throw new TransferLimitError(data.kind)
    await tx.agentTransfer.create({
      data: { ...owner, ...data, secretHash: secretHash(secret), expiresAt },
    })
  })
  return {
    url: `${origin}${TRANSFER_PATH}/${secret}`,
    expires_at: expiresAt.toISOString(),
  }
}

/** A URL that downloads one of the account's files for the next few minutes. */
export function createDownloadUrl(
  principal: AgentPrincipal,
  origin: string,
  fileId: string
) {
  return createTransfer(principal, origin, DOWNLOAD_MINUTES, {
    kind: 'download',
    fileId,
  })
}

/** A URL that takes one upload with the options fixed here. */
export function createUploadUrl(
  principal: AgentPrincipal,
  origin: string,
  upload: UploadTransfer
) {
  return createTransfer(principal, origin, UPLOAD_MINUTES, {
    kind: 'upload',
    options: upload as Prisma.InputJsonValue,
  })
}

/** The unexpired transfer a URL's secret names, of the kind the request is for. */
export async function findTransfer(
  secret: string,
  kind: 'download' | 'upload'
): Promise<TransferRow | null> {
  if (!isLinkToken(secret)) return null
  const transfer = await prisma.agentTransfer.findUnique({
    where: { secretHash: secretHash(secret) },
  })
  return transfer && transfer.kind === kind && transfer.expiresAt > new Date()
    ? transfer
    : null
}

/**
 * Take an upload URL for this request. Only one request gets it: a second
 * one, even a simultaneous one, is refused. From here the row is kept for the
 * upload using it: publication has to find it, so the sweep of expired URLs
 * must not take it from under a file that is still arriving.
 */
export async function claimUpload(id: string): Promise<boolean> {
  const now = new Date()
  const { count } = await prisma.agentTransfer.updateMany({
    where: { id, claimedAt: null, expiresAt: { gt: now } },
    data: {
      claimedAt: now,
      expiresAt: new Date(now.getTime() + UPLOAD_HOLD_HOURS * 3_600_000),
    },
  })
  return count === 1
}

/**
 * Give an upload URL back when its upload failed before a file was
 * published, with the time it had: it can be used again until then.
 */
export async function releaseUpload(id: string): Promise<void> {
  try {
    const held = await prisma.agentTransfer.findUnique({
      where: { id },
      select: { createdAt: true },
    })
    if (!held) return
    await prisma.agentTransfer.updateMany({
      where: { id },
      data: {
        claimedAt: null,
        expiresAt: new Date(held.createdAt.getTime() + UPLOAD_MINUTES * 60_000),
      },
    })
  } catch {
    // A URL that cannot be given back stays taken until it is swept.
  }
}

/** The upload a URL fixed, read back from its row. */
export function uploadOf(transfer: TransferRow): UploadTransfer {
  return (transfer.options ?? { options: {} }) as UploadTransfer
}

/**
 * Removes expired transfer URLs; the periodic maintenance runs it. Like
 * every sweep it takes only rows nobody else holds and leaves the rest to
 * its next run (see `inBatches`), and it compares times as UTC without a
 * zone, as Prisma keeps them.
 */
export async function deleteExpiredTransfers(now = new Date()) {
  return inBatches(
    () => prisma.$executeRaw`
      WITH gone AS MATERIALIZED (
        SELECT "id" FROM "AgentTransfer"
        WHERE "expiresAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY "id" LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "AgentTransfer" USING gone
      WHERE "AgentTransfer"."id" = gone."id"
    `
  )
}

/**
 * Remove an upload URL in the transaction that publishes its file, and say
 * whether it was there to remove. The URL is then gone exactly when the file
 * exists, so it can never publish a second one, and a publication that rolls
 * back leaves it to be released. False means the URL was already gone, taken
 * with the connection it was made for or used by another publication, and
 * the caller must publish nothing.
 */
export async function consumeUpload(
  tx: Prisma.TransactionClient,
  id: string
): Promise<boolean> {
  const { count } = await tx.agentTransfer.deleteMany({ where: { id } })
  return count === 1
}
