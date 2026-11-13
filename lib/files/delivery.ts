import { headers } from 'next/headers'

import type { Prisma } from '@prisma/client'
import { once } from 'node:events'
import { ReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { parseByteRange } from '@/lib/http/byte-range'
import { readJson } from '@/lib/http/request'
import { loggers } from '@/lib/logger'
import { clientIp } from '@/lib/security/client-ip'
import { sanitizeDisplayName } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'

import {
  type FileAccessDenied,
  type FileAccessInfo,
  checkFileAccess,
  retryAfterMinutes,
} from './access'
import { contentDisposition } from './content-disposition'

const logger = loggers.files

export type FileLocator =
  | { id: string }
  /** A public file directly inside the folder shared with this token. */
  | { id: string; sharedFolder: string }
  /** A stored `urlPath`, as `/api/files/{urlPath}` names it. */
  | { urlPath: string }
  /** A share link `/{userUrlId}/{filename}`, also under the owner's vanity ID. */
  | { userUrlId: string; filename: string }

type Found<S extends Prisma.FileSelect> = Prisma.FileGetPayload<{ select: S }>

/** A name typed with spaces also finds the dashed name Flare stored. */
function withDashes(name: string) {
  return name.includes(' ') ? [name, name.replace(/ /g, '-')] : [name]
}

async function findByPath<S extends Prisma.FileSelect>(
  urlPaths: string[],
  select: S
) {
  for (const urlPath of urlPaths) {
    const file = await prisma.file.findUnique({ where: { urlPath }, select })
    if (file) return file as Found<S>
  }
  return null
}

export async function findFile<S extends Prisma.FileSelect>(
  locator: FileLocator,
  select: S
): Promise<Found<S> | null> {
  if ('sharedFolder' in locator)
    // Only while the file is public and directly in the folder that link
    // shares: moving it, making it private or unsharing the folder hides it.
    return (await prisma.file.findFirst({
      where: {
        id: locator.id,
        visibility: 'PUBLIC',
        folder: { shareToken: locator.sharedFolder },
      },
      select,
    })) as Found<S> | null
  if ('id' in locator)
    return (await prisma.file.findUnique({
      where: { id: locator.id },
      select,
    })) as Found<S> | null
  // `/api/files/{urlPath}` has never accepted vanity IDs.
  if ('urlPath' in locator)
    return findByPath(withDashes(locator.urlPath), select)
  const { userUrlId, filename } = locator
  const names = withDashes(filename)
  const file = await findByPath(
    names.map((name) => `/${userUrlId}/${name}`),
    select
  )
  if (file) return file
  const owner = await prisma.user.findUnique({
    where: { vanityId: userUrlId },
    select: { urlId: true },
  })
  return owner
    ? findByPath(
        names.map((name) => `/${owner.urlId}/${name}`),
        select
      )
    : null
}

/** What access checks and byte serving read from every file a route sends. */
const deliveredFields = {
  id: true,
  name: true,
  userId: true,
  visibility: true,
  password: true,
  path: true,
  mimeType: true,
} satisfies Prisma.FileSelect

export type DeliveredFile = Found<typeof deliveredFields>

type Session = Awaited<ReturnType<typeof getAccessSession>>

export type FileGrant<F> = {
  file: F
  session: Session
  /** The file password the request carried, if any. */
  password: string | null
}

function retryAfter(access: FileAccessDenied): Record<string, string> {
  return access.retryAfterSeconds
    ? { 'Retry-After': String(access.retryAfterSeconds) }
    : {}
}

/**
 * What a kind of route answers when it can't send the file: no file matches,
 * or the requester may not read it. Denials are masked as checkFileAccess
 * decides: a private file is 404 like a missing one.
 */
type Refusal = {
  missing(): Response
  denied(access: FileAccessDenied): Response
}

const missing = () => new Response(null, { status: 404 })

/** Routes that send stored bytes. No cache may keep a refusal in their place. */
const content: Refusal = {
  missing,
  denied: (access) =>
    new Response(null, {
      status: access.status,
      headers: { 'Cache-Control': 'private, no-store', ...retryAfter(access) },
    }),
}

const refusals = {
  content,
  thumbnail: {
    missing: () => new Response('File not found', { status: 404 }),
    denied: content.denied,
  },
  /** The `/direct` video lookup, whose refusals carry no cache directive. */
  lookup: {
    missing,
    denied: (access) =>
      new Response(null, {
        status: access.status,
        headers: retryAfter(access),
      }),
  },
  api: {
    missing: () =>
      Response.json(
        { success: false, error: 'File not found' },
        { status: 404 }
      ),
    denied: (access) =>
      Response.json(
        {
          success: false,
          error:
            access.reason === 'private'
              ? 'Unauthorized'
              : access.reason === 'password_rate_limited'
                ? `Too many incorrect passwords for this file. Try again in ${retryAfterMinutes(access)} min.`
                : 'Password required',
        },
        { status: access.status, headers: retryAfter(access) }
      ),
  },
} satisfies Record<string, Refusal>

/**
 * The file password a request carries: in the JSON body of a POST, otherwise
 * in the `password` query parameter. A POST body that isn't JSON carries none.
 */
async function requestPassword(request: Request): Promise<string | null> {
  if (request.method !== 'POST')
    return new URL(request.url).searchParams.get('password')
  try {
    const body = (await readJson(request)) as { password?: string }
    return body.password || null
  } catch {
    return null
  }
}

/**
 * The file a route request names, if the requester may read it, judged by
 * their browser session, the file password they sent and, for password
 * attempt limits, their address. Otherwise the answer of the route's kind of
 * `refusal`. The file becomes the request's audit target, and a denial is
 * recorded as one even when the answer masks it as 404.
 */
export async function authorizeFile<S extends Prisma.FileSelect = object>(
  request: Request,
  locator: FileLocator,
  refusal: keyof typeof refusals,
  select?: S
): Promise<FileGrant<Found<typeof deliveredFields & S>> | Response> {
  // The session also names the request's actor in the audit log, so it is read
  // even when no file matches.
  const [session, found, password] = await Promise.all([
    getAccessSession(),
    findFile(locator, {
      ...deliveredFields,
      ...select,
    } as typeof deliveredFields & S),
    requestPassword(request),
  ])
  const answer: Refusal = refusals[refusal]
  if (!found) return answer.missing()
  // TypeScript can't see the selected fields through the generic payload.
  const file = found as typeof found & DeliveredFile
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  const access = await checkFileAccess(file, session, password, {
    requester: clientIp(request.headers),
  })
  if (access.allowed) return { file, session, password }
  setAuditOutcome('denied')
  return answer.denied(access)
}

/**
 * Whether a page's visitor may read `file`, judged by their browser session,
 * the file password from the page's query and their address.
 */
export async function checkPageAccess(
  file: FileAccessInfo,
  password: string | undefined
) {
  const [session, requestHeaders] = await Promise.all([
    getAccessSession(),
    headers(),
  ])
  const access = await checkFileAccess(file, session, password, {
    requester: clientIp(requestHeaders),
  })
  return { session, access }
}

async function count(id: string, total: 'views' | 'downloads') {
  await prisma.file.update({
    where: { id },
    data:
      total === 'views'
        ? { views: { increment: 1 } }
        : { downloads: { increment: 1 } },
  })
}

/** A share page adds a view only when its visitor may see the file. */
export function countView(id: string) {
  return count(id, 'views')
}

export type Delivery = {
  /** Show the bytes or save them. Thumbnails send no disposition. */
  disposition?: 'inline' | 'attachment'
  /**
   * Render the bytes in a sandbox with an opaque origin, so stored HTML, SVG
   * or XML opened directly can't run script as Flare.
   */
  sandbox?: boolean
  /**
   * `Cache-Control` for a public file without a password. Every other file
   * gets `private, no-store`: shared caches key on the URL alone.
   */
  publicCache?: string
  /**
   * The total this response adds to. A download counts as soon as the request
   * is authorized; a view counts only a GET whose bytes are about to be sent.
   */
  count?: 'views' | 'downloads'
  /** Let storage send a download from a signed URL when it has one (S3). */
  signedRedirect?: boolean
  /** Send the whole object without reading its size: no ranges or length. */
  whole?: boolean
  /** More headers for full and partial content. */
  headers?: Record<string, string>
}

/**
 * `Cache-Control` for bytes of `file`: `publicCache` for a public file without
 * a password, and `private, no-store` for every other file, because shared
 * caches key on the URL alone.
 */
export function cacheHeaders(
  file: Pick<DeliveredFile, 'visibility' | 'password'>,
  publicCache?: string
): Record<string, string> {
  const cache =
    file.visibility === 'PRIVATE' || file.password
      ? 'private, no-store'
      : publicCache
  return cache ? { 'Cache-Control': cache } : {}
}

/**
 * Send the stored bytes of a file the requester may read, honoring one
 * `Range` header. A stored object that is gone answers 404; other storage
 * failures are thrown.
 */
export async function serveFile(
  request: Request,
  file: DeliveredFile,
  delivery: Delivery
): Promise<Response> {
  const cacheControl = cacheHeaders(file, delivery.publicCache)
  if (delivery.count === 'downloads') await count(file.id, 'downloads')
  const storage = await getStorageProvider()
  const guard: Record<string, string> = {
    ...(delivery.sandbox ? { 'Content-Security-Policy': 'sandbox' } : {}),
    'X-Content-Type-Options': 'nosniff',
  }
  // The header keeps a `..` in a name, as archive members need, but stored
  // files have always been sent without one.
  const name = sanitizeDisplayName(file.name)
  try {
    if (delivery.signedRedirect) {
      const url = await storage.getDownloadUrl(file.path, name)
      if (url)
        return new Response(null, {
          status: 302,
          headers: { Location: url, ...cacheControl },
        })
    }
    const contentHeaders = {
      'Content-Type': file.mimeType,
      ...(delivery.disposition && {
        'Content-Disposition': contentDisposition(name, delivery.disposition),
      }),
      ...guard,
      ...delivery.headers,
      ...cacheControl,
    }
    if (delivery.whole)
      return await respond(
        request,
        file,
        delivery,
        await storage.getFileStream(file.path),
        { headers: contentHeaders }
      )
    const size = await storage.getFileSize(file.path)
    // HTTP defines ranges for GET only; Next.js answers HEAD with GET.
    const range =
      request.method === 'POST'
        ? null
        : parseByteRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable')
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Accept-Ranges': 'bytes',
          ...guard,
        },
      })
    if (!range)
      return await respond(
        request,
        file,
        delivery,
        await storage.getFileStream(file.path),
        {
          headers: {
            ...contentHeaders,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(size),
          },
        }
      )
    return await respond(
      request,
      file,
      delivery,
      await storage.getFileStream(file.path, range),
      {
        status: 206,
        headers: {
          ...contentHeaders,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      }
    )
  } catch (error) {
    if (!isMissingObject(error)) throw error
    logger.error('File serve error:', error as Error)
    return new Response(null, { status: 404 })
  }
}

/**
 * Answer with `body`, which this function owns until the response does: if
 * anything fails first, the stream is destroyed. Local files open
 * asynchronously, so a missing one fails here, before a view is counted.
 */
async function respond(
  request: Request,
  file: DeliveredFile,
  delivery: Delivery,
  body: Readable,
  init: ResponseInit
): Promise<Response> {
  let failure: Error | null = body.errored
  const onError = (error: Error) => {
    failure = error
  }
  // Keep errors handled and bytes paused until the open and the count finish.
  body.on('error', onError)
  body.pause()
  try {
    if (body.destroyed)
      throw failure ?? new Error('Storage stream closed before serving')
    if (body instanceof ReadStream && body.pending) await once(body, 'open')
    if (failure) throw failure
    // Invalid headers throw here, before a view is counted.
    const checkedHeaders = new Headers(init.headers)
    if (delivery.count === 'views' && request.method === 'GET')
      await count(file.id, 'views')
    if (failure) throw failure
    const response = new Response(
      Readable.toWeb(body) as ReadableStream<Uint8Array>,
      { ...init, headers: checkedHeaders }
    )
    // The response body now owns errors and cancellation.
    body.off('error', onError)
    return response
  } catch (error) {
    if (body.closed) {
      body.off('error', onError)
    } else {
      // Keep the listener through asynchronous destruction.
      body.once('close', () => body.off('error', onError))
      body.destroy()
    }
    throw error
  }
}
