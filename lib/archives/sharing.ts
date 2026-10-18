import type { Prisma } from '@prisma/client'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { z } from 'zod'

import { setAuditActor, setAuditOutcome, setAuditTarget } from '@/lib/audit'
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
import { ARCHIVE_BROWSE_LIMITS } from './shared'
import {
  createArchiveUnlock,
  secureCookies,
  verifyArchiveUnlock,
} from './unlock'

const password = z.string().max(1024).optional()
export const sharedArchiveSchema = z
  .object({
    password,
    /** Return 202 with progress instead of waiting for a slow listing. */
    progress: z.boolean().optional(),
    /** Skip entries the browser already received while polling. */
    after: z.number().int().min(0).optional(),
  })
  .strict()
export const sharedArchiveEntrySchema = z
  .object({
    password,
    path: z.string().min(1).max(ARCHIVE_BROWSE_LIMITS.pathLength),
  })
  .strict()

// Share routes can be compiled into separate Next bundles. Keep one budget per
// process rather than one limiter per route module. Listings poll while a slow
// archive is read; entry reads include image loads and media seeking.
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
export const SHARED_ARCHIVE_RATE_LIMITS = {
  listing: 120,
  entry: 600,
} as const
const limiters = (processState[Symbol.for('flare.archive.share-limits')] ??= {
  listing: new RateLimiterMemory({
    points: SHARED_ARCHIVE_RATE_LIMITS.listing,
    duration: 60,
    keyPrefix: 'archive-share',
  }),
  entry: new RateLimiterMemory({
    points: SHARED_ARCHIVE_RATE_LIMITS.entry,
    duration: 60,
    keyPrefix: 'archive-share-entry',
  }),
}) as Record<'listing' | 'entry', RateLimiterMemory>

export const SHARED_ARCHIVE_BODY_TIMEOUT_MS = 5_000
export const SHARED_ARCHIVE_PENDING_BODIES = 32
const bodyKey = Symbol.for('flare.archive.pending-share-bodies')
const pendingBodies = (processState[bodyKey] ??=
  new Set<symbol>()) as Set<symbol>

/** Untrusted slow bodies never reserve archive reads or indexing work. */
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

export async function sharedArchiveGuard(
  request: Request,
  kind: 'listing' | 'entry'
) {
  if (request.headers.has('authorization'))
    throw new ArchiveError(
      'API credentials cannot authorize shared archives.',
      401
    )
  if (!isSameOriginRequest(request)) throw new ArchiveError('Forbidden', 403)
  return rateLimit(request, limiters[kind])
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
  /** This request submitted the file password and it matched. */
  passwordChecked: boolean
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
  setAuditActor({ id: user.id, name: user.name })
  return { user: { id: user.id, ...(await getUserAccess(user.id, client)) } }
}

function denied(access: Awaited<ReturnType<typeof checkFileAccess>>) {
  if (access.allowed) return
  setAuditOutcome('denied')
  throw new ArchiveError(
    access.reason === 'private'
      ? 'Archive not found.'
      : access.reason === 'password_required'
        ? 'Enter the file password to browse this archive.'
        : 'The file password is incorrect.',
    access.status,
    true
  )
}

/**
 * Check a shared archive request. A visitor proves a file password either in
 * the body or with an unlock cookie issued after an earlier password check.
 */
export async function authorizeSharedArchive(
  id: string,
  password?: string,
  unlock: string | null = null
): Promise<SharedArchiveAccess> {
  const [file, session] = await Promise.all([
    prisma.file.findUnique({ where: { id }, select: sharedSourceSelect }),
    getAccessSession(),
  ])
  if (!file) throw new ArchiveError('Archive not found.', 404)
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  const viewer =
    session?.user?.id && typeof session.user.sessionVersion === 'number'
      ? { id: session.user.id, sessionVersion: session.user.sessionVersion }
      : null
  // A valid unlock satisfies only the password; visibility still applies.
  const unlocked =
    !password && verifyArchiveUnlock(unlock, file.id, file.password)
  const access = await checkFileAccess(
    unlocked ? { ...file, password: null } : file,
    await currentSession(viewer),
    password
  )
  denied(access)
  // Only the visitor-password branch actually compares the supplied password.
  const visitor = access.allowed && !access.isOwner && !access.canModerate
  return {
    file,
    viewer,
    verifiedPasswordHash: visitor ? file.password : null,
    passwordChecked: visitor && !!file.password && !!password,
  }
}

/**
 * Issue an unlock cookie when this request checked a submitted visitor
 * password. Using a cookie never renews it, so it lasts one hour at most.
 */
export function withArchiveUnlock(
  response: Response,
  access: SharedArchiveAccess,
  request: Request
) {
  if (
    access.passwordChecked &&
    access.verifiedPasswordHash &&
    response.status < 300
  )
    response.headers.append(
      'Set-Cookie',
      createArchiveUnlock(
        access.file.id,
        access.verifiedPasswordHash,
        secureCookies(request)
      )
    )
  return response
}

/** The source must still be shared the same way and unchanged. */
async function assertSharedSource(
  access: SharedArchiveAccess,
  file: SharedSource | null,
  session: () => Promise<SessionInfo>
) {
  if (!file) throw new ArchiveError('Archive not found.', 404)
  const checkedFile = {
    ...file,
    password:
      file.password === access.verifiedPasswordHash ? null : file.password,
  }
  denied(await checkFileAccess(checkedFile, await session()))
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
}

/** No bcrypt or storage I/O while holding locks; recheck the exact verified hash. */
export async function recheckSharedArchive(
  access: SharedArchiveAccess,
  signal: AbortSignal
) {
  signal.throwIfAborted()
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
      await assertSharedSource(access, file, () =>
        currentSession(access.viewer, tx)
      )
      // Expiration is worker-applied throughout sharing. A completed DELETE or
      // SET_PRIVATE is observed above; a scheduled deadline alone is not a ban.
      signal.throwIfAborted()
    },
    { timeout: 10_000, maxWait: 10_000 }
  )
}

/**
 * The same rules as {@link recheckSharedArchive}, read without locks. Partial
 * listings are polled every second and shouldn't queue behind role or file
 * writes; the finished listing and every file read use the locked recheck.
 */
export async function confirmSharedArchive(
  access: SharedArchiveAccess,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const file = await prisma.file.findUnique({
    where: { id: access.file.id },
    select: sharedSourceSelect,
  })
  await assertSharedSource(access, file, () => currentSession(access.viewer))
  signal.throwIfAborted()
}
