import type { Prisma } from '@prisma/client'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { z } from 'zod'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import { type SessionInfo, checkFileAccess } from '@/lib/files/access'
import { getUserAccess, lockRoleChanges } from '@/lib/permissions/server'
import { rateLimit } from '@/lib/security/rate-limit'
import { isSameOriginRequest } from '@/lib/security/request-origin'

import { ArchiveError } from './errors'
import { archiveBody } from './http'
import type { ArchiveOperation } from './operation'
import { ARCHIVE_LIMITS } from './shared'

export const sharedArchiveSchema = z
  .object({ password: z.string().max(1024).optional() })
  .strict()
export const sharedArchiveEntrySchema = sharedArchiveSchema.extend({
  path: z.string().min(1).max(ARCHIVE_LIMITS.pathLength),
})

// Share routes can be compiled into separate Next bundles. Keep one budget per
// process, matching the operation cap, rather than one limiter per route module.
const limiterKey = Symbol.for('flare.archive.share-rate-limit')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const limiter = (processState[limiterKey] ??= new RateLimiterMemory({
  points: 30,
  duration: 60,
  keyPrefix: 'archive-share',
})) as RateLimiterMemory

export const SHARED_ARCHIVE_BODY_TIMEOUT_MS = 5_000
export const SHARED_ARCHIVE_PENDING_BODIES = 32
const bodyKey = Symbol.for('flare.archive.pending-share-bodies')
const pendingBodies = (processState[bodyKey] ??=
  new Set<symbol>()) as Set<symbol>

/** Untrusted slow bodies never reserve archive workers or staging directories. */
export async function sharedArchiveBody(request: Request, allowForm = false) {
  if (pendingBodies.size >= SHARED_ARCHIVE_PENDING_BODIES)
    throw new ArchiveError(
      'Too many pending archive requests. Try again shortly.',
      429
    )
  const pending = Symbol()
  pendingBodies.add(pending)
  const controller = new AbortController()
  const abort = () =>
    controller.abort(new ArchiveError('Archive request was cancelled.', 408))
  const timer = setTimeout(
    () =>
      controller.abort(
        new ArchiveError(
          'Shared archive request body exceeded the five-second time limit.',
          408
        )
      ),
    SHARED_ARCHIVE_BODY_TIMEOUT_MS
  )
  timer.unref()
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  try {
    controller.signal.throwIfAborted()
    return await archiveBody(request, controller.signal, allowForm)
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
    pendingBodies.delete(pending)
  }
}

export async function sharedArchiveGuard(request: Request) {
  if (request.headers.has('authorization'))
    throw new ArchiveError(
      'API credentials cannot authorize shared archives.',
      401
    )
  if (!isSameOriginRequest(request)) throw new ArchiveError('Forbidden', 403)
  return rateLimit(request, limiter)
}

const sharedSourceSelect = {
  id: true,
  userId: true,
  name: true,
  path: true,
  mimeType: true,
  storageTarget: true,
  visibility: true,
  password: true,
} satisfies Prisma.FileSelect
type SharedSource = Prisma.FileGetPayload<{ select: typeof sharedSourceSelect }>
type Viewer = { id: string; sessionVersion: number } | null
export type SharedArchiveAccess = {
  file: SharedSource
  viewer: Viewer
  verifiedPasswordHash: string | null
}

async function currentSession(
  viewer: Viewer,
  tx?: Prisma.TransactionClient
): Promise<SessionInfo> {
  if (!viewer) return null
  const client = tx ?? prisma
  const user = await client.user.findUnique({ where: { id: viewer.id } })
  if (!user || user.sessionVersion !== viewer.sessionVersion) return null
  const email = tx ? await getEmailConfigForUpdate(tx) : await getEmailConfig()
  if (requiresEmailVerification(user, email)) return null
  return { user: { id: user.id, ...(await getUserAccess(user.id, client)) } }
}

function denied(access: Awaited<ReturnType<typeof checkFileAccess>>) {
  if (access.allowed) return
  throw new ArchiveError(
    access.reason === 'private'
      ? 'Archive not found.'
      : access.reason === 'password_required'
        ? 'Enter the file password to browse this archive.'
        : 'The file password is incorrect.',
    access.status
  )
}

export async function authorizeSharedArchive(
  id: string,
  password?: string
): Promise<SharedArchiveAccess> {
  const [file, session] = await Promise.all([
    prisma.file.findUnique({ where: { id }, select: sharedSourceSelect }),
    getAccessSession(),
  ])
  if (!file) throw new ArchiveError('Archive not found.', 404)
  const viewer =
    session?.user?.id && typeof session.user.sessionVersion === 'number'
      ? { id: session.user.id, sessionVersion: session.user.sessionVersion }
      : null
  const access = await checkFileAccess(
    file,
    await currentSession(viewer),
    password
  )
  denied(access)
  return {
    file,
    viewer,
    // Only the visitor-password branch actually compares the supplied password.
    verifiedPasswordHash:
      access.allowed && !access.isOwner && !access.canModerate
        ? file.password
        : null,
  }
}

/** No bcrypt or storage I/O while holding locks; recheck the exact verified hash. */
export async function recheckSharedArchive(
  access: SharedArchiveAccess,
  operation: ArchiveOperation
) {
  operation.signal.throwIfAborted()
  await prisma.$transaction(
    async (tx) => {
      await lockRoleChanges(tx)
      // File deletion may lock File before updating its owner's quota. Do not
      // hold a User row lock while waiting here; read fresh session authority
      // after acquiring the source lock instead.
      await tx.$queryRaw`SELECT id FROM "File" WHERE id = ${access.file.id} FOR SHARE`
      const file = await tx.file.findUnique({
        where: { id: access.file.id },
        select: sharedSourceSelect,
      })
      if (!file) throw new ArchiveError('Archive not found.', 404)
      const checkedFile = {
        ...file,
        password:
          file.password === access.verifiedPasswordHash ? null : file.password,
      }
      denied(
        await checkFileAccess(
          checkedFile,
          await currentSession(access.viewer, tx)
        )
      )
      if (
        file.userId !== access.file.userId ||
        file.name !== access.file.name ||
        file.path !== access.file.path ||
        file.mimeType !== access.file.mimeType ||
        JSON.stringify(file.storageTarget) !==
          JSON.stringify(access.file.storageTarget)
      )
        throw new ArchiveError(
          'The source archive changed. Refresh and try again.',
          409
        )
      // Expiration is worker-applied throughout sharing. A completed DELETE or
      // SET_PRIVATE is observed above; a scheduled deadline alone is not a ban.
      operation.signal.throwIfAborted()
    },
    {
      timeout: operation.transactionTimeout(),
      maxWait: Math.min(10_000, operation.transactionTimeout()),
    }
  )
}
