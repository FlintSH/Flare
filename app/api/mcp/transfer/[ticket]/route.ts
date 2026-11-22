import type { Prisma } from '@prisma/client'

import { archiveRoutes } from '@/lib/archives/http'
import {
  readArchiveEntry,
  readSharedArchiveEntry,
} from '@/lib/archives/service'
import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { checkFileAccess } from '@/lib/files/access'
import { type DeliveredFile, findFile, serveFile } from '@/lib/files/delivery'
import { HttpError } from '@/lib/http/errors'
import { apiResponse } from '@/lib/http/response'
import { type RouteContract, routes } from '@/lib/http/route'
import { type AgentPrincipal, credentialPrincipal } from '@/lib/mcp/auth'
import {
  TOOL_CATALOG,
  type ToolName,
  moderationAllowed,
  toolAllowed,
} from '@/lib/mcp/catalog'
import {
  archiveActor,
  credentialHolds,
  moderatorArchiveAccess,
} from '@/lib/mcp/publish-check'
import { mcpEnabled, mcpNotFound } from '@/lib/mcp/settings'
import { ToolError } from '@/lib/mcp/tool'
import {
  type TransferKind,
  type TransferMode,
  claimExport,
  claimUpload,
  consumeUpload,
  endExport,
  entryOf,
  findTransfer,
  modeOf,
  releaseExport,
  releaseUpload,
  uploadOf,
} from '@/lib/mcp/transfer'
import { uploadLimiter } from '@/lib/security/rate-limit'
import { directUpload } from '@/lib/uploads/direct'
import { uploadRoutes } from '@/lib/uploads/http'
import { exportAccountData } from '@/lib/users/export'
import { newExportId } from '@/lib/users/export-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ ticket: string }> }
type Transfer = NonNullable<Awaited<ReturnType<typeof findTransfer>>>

/**
 * Transfer URLs carry their own secret and are made for curl, so they stay
 * closed to pages on other sites: the default CORS kind opens only the routes
 * named tokens call, and this is not one. No cache or referrer may keep one.
 */
const transfers = routes('/api/mcp/transfer/[ticket]', {
  failure: { message: 'The transfer could not be completed.' },
  headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
})

/**
 * The one answer for a URL that cannot be used, whatever the reason: unknown,
 * expired, of the other kind, or made for a credential that may no longer use
 * it. It is also what the MCP endpoint answers while the server is off.
 */
function notFound(): Response {
  const response = mcpNotFound()
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** The same answer, recorded as the refusal it is. */
function refused(): Response {
  setAuditOutcome('denied')
  return notFound()
}

/**
 * Who a transfer was made for, if they may still use the tool it came from
 * in the mode the row records: as the owner (`toolAllowed`), or as a
 * moderator (`moderationAllowed`: the `admin:content` scope, which counts
 * only while administration through MCP is on, and the role's `content.*`
 * permission). One mode's standing never passes the other's recheck.
 * Everything is read from the row and the database as they are now: the
 * request carries no credential and none is looked for.
 */
async function holder(
  transfer: Transfer,
  tool: ToolName,
  mode: TransferMode = { as: 'owner' }
): Promise<AgentPrincipal | null> {
  const principal = await credentialPrincipal(transfer.credential)
  const allowed = mode.as === 'owner' ? toolAllowed : moderationAllowed
  return principal &&
    principal.user.id === transfer.userId &&
    allowed(tool, principal)
    ? principal
    : null
}

/** The account whose file a download link may send: the owner's own, or the moderated one. */
const fileOwner = (transfer: Transfer, mode: TransferMode) =>
  mode.as === 'owner' ? transfer.userId : mode.accountId

/** While the server is off nothing is here and nothing is recorded, as at the endpoint. */
function whileOn(
  handler: (request: Request, context: Context) => Promise<Response>
) {
  return async (request: Request, context: Context) =>
    (await mcpEnabled()) ? handler(request, context) : notFound()
}

const deliveredFields = {
  id: true,
  name: true,
  userId: true,
  visibility: true,
  password: true,
  path: true,
  mimeType: true,
} satisfies Prisma.FileSelect

/** One of the account's files, whole or in ranges, for as long as its link lasts. */
async function sendFile(request: Request, transfer: Transfer) {
  const mode = modeOf(transfer)
  if (!mode) return refused()
  const principal = await holder(transfer, 'read_file', mode)
  if (!principal) return refused()
  const file: DeliveredFile | null = transfer.fileId
    ? await findFile({ id: transfer.fileId }, deliveredFields)
    : null
  if (!file) return notFound()
  // The link was made for one account's file and opens no one else's.
  if (file.userId !== fileOwner(transfer, mode)) return refused()
  // A moderator opens it as the delivery rules let a moderator, by role.
  if (mode.as === 'moderator') {
    const access = await checkFileAccess(file, {
      user: { id: principal.user.id, permissions: principal.user.permissions },
    })
    if (!access.allowed || !access.canModerate) return refused()
  }
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  // Not a visit: nothing is counted, and no session or password is asked.
  const response = await serveFile(request, file, {
    disposition: 'attachment',
  })
  // A stored object that is gone answers like a file that is.
  if (response.status === 404) return notFound()
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * One entry of an archive among the account's files, through the reader the
 * library's own archive browser uses. The row names the archive and the
 * entry; the request adds only a `Range`.
 */
async function sendEntry(request: Request, transfer: Transfer) {
  const mode = modeOf(transfer)
  if (!mode) return refused()
  const principal = await holder(transfer, 'read_file', mode)
  if (!principal) return refused()
  const entry = entryOf(transfer)
  const file =
    transfer.fileId && entry
      ? await findFile(
          { id: transfer.fileId },
          { id: true, name: true, userId: true }
        )
      : null
  if (!file || !entry) return notFound()
  if (file.userId !== fileOwner(transfer, mode)) return refused()
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  let response: Response
  try {
    // Not a visit either: the reader counts nothing and asks for no session.
    if (mode.as === 'owner')
      response = await readArchiveEntry(
        await archiveActor(principal, 'read_file'),
        file.id,
        entry,
        request,
        false
      )
    else {
      // The reader share pages use, with the moderator as the viewer: its
      // checks read the moderator's role, never the owner's.
      const access = await moderatorArchiveAccess(
        principal,
        mode.accountId,
        file.id
      )
      if (!access) return notFound()
      response = await readSharedArchiveEntry(access, entry, request, {
        inline: false,
        requester: `user:${principal.user.id}`,
      })
    }
  } catch (error) {
    // The credential ended, or the role changed, while the entry was found.
    if (
      error instanceof ToolError ||
      (error instanceof HttpError && [401, 403].includes(error.status))
    )
      return refused()
    // The archive, or the entry in it, is no longer there.
    if (error instanceof HttpError && error.status === 404) return notFound()
    throw error
  }
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * `body` once its first bytes have arrived, so an export that fails before
 * any byte is sent fails here, and not inside an answer already under way.
 * `ended` runs once, when the body has been read to its end, broke off, or
 * was given up on.
 */
async function begun(
  body: ReadableStream<Uint8Array>,
  ended: () => Promise<void>
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader()
  const opening = await reader.read()
  if (opening.done) throw new Error('The export ended before it sent anything')
  let first: Uint8Array | undefined = opening.value
  let over = false
  const end = async () => {
    if (over) return
    over = true
    await ended()
  }
  // Read only as it is asked for, so a slow download still slows the export.
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) {
        controller.enqueue(first)
        first = undefined
        return
      }
      try {
        const next = await reader.read()
        if (!next.done) return controller.enqueue(next.value)
        await end()
        controller.close()
      } catch (error) {
        await end()
        controller.error(error)
      }
    },
    async cancel(reason) {
      await end()
      await reader.cancel(reason)
    },
  })
}

/**
 * The account's data export, once. The row says whose export it is, and
 * nothing in the request can change what is exported.
 */
async function sendExport(request: Request, transfer: Transfer) {
  const principal = await holder(transfer, 'export_account')
  if (!principal) return refused()
  setAuditTarget({
    type: 'user',
    id: principal.user.id,
    name: principal.name ?? undefined,
  })
  const headers = { 'Content-Type': 'application/zip' }
  const inUse = () =>
    new HttpError(
      409,
      'This export URL is in use by another download, or was already used. If that download fails before it starts the URL can be used again; otherwise call export_account for a new one.'
    )
  // Next.js answers HEAD with GET and never reads the body. Asking what is
  // here takes nothing: the URL is still to be used, unless a download has it.
  if (request.method === 'HEAD') {
    if (transfer.claimedAt) throw inUse()
    return new Response(null, { headers })
  }
  // One request gets the URL, even of two that arrive together.
  if (!(await claimExport(transfer.id))) throw inUse()
  try {
    const { filename, body } = await exportAccountData(principal.user.id, {
      // Its own, so nobody else's progress stream can follow this export.
      exportId: newExportId(),
      signal: request.signal,
    })
    // From its first byte the URL is used up; it goes when the download ends.
    const sent = await begun(body, () => endExport(transfer.id))
    return new Response(sent, {
      headers: {
        ...headers,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    // Not a byte was sent: give the URL back, so the same command can be run
    // again until it expires.
    await releaseExport(transfer.id)
    // An account deleted this instant answers like a URL that went with it.
    if (error instanceof HttpError && error.status === 404) return notFound()
    throw error
  }
}

/**
 * What a `GET` handler is given: the row its URL names, already looked for.
 * The audit names a request before its handler runs, and it is the row that
 * says what a download is. A failure to read the row is kept and thrown
 * inside the handler, where it is answered and recorded like any other.
 */
type Sought = { transfer: Transfer | null } | { failure: unknown }

/** A `GET` for one kind of URL, recorded under that kind's own action. */
const sending = (
  kind: TransferKind,
  send: (request: Request, transfer: Transfer) => Promise<Response>,
  contract: Partial<RouteContract> = {}
) =>
  transfers<Sought>(
    async (request, sought) => {
      if ('failure' in sought) throw sought.failure
      return sought.transfer ? send(request, sought.transfer) : notFound()
    },
    {
      ...contract,
      audit: { action: `mcp.transfer.${kind}`, category: 'mcp' },
    }
  )

/** What a `GET` serves, by the kind of the URL. */
const downloads = {
  download: sending('download', sendFile),
  // The reader's own failures answer as the archive routes answer them.
  'archive-entry': sending('archive-entry', sendEntry, {
    translate: archiveRoutes.translate,
  }),
  export: sending('export', sendExport),
}

const isDownload = (kind: string): kind is keyof typeof downloads =>
  Object.hasOwn(downloads, kind)

export const GET = whileOn(async (request, { params }) => {
  const sought: Sought = await findTransfer(
    (await params).ticket,
    Object.keys(downloads) as TransferKind[]
  ).then(
    (transfer) => ({ transfer }),
    (failure: unknown) => ({ failure })
  )
  const kind = 'transfer' in sought ? sought.transfer?.kind : undefined
  // A URL that names nothing is recorded as the plain download it asked for.
  return downloads[kind && isDownload(kind) ? kind : 'download'](
    request,
    sought
  )
})

/**
 * The last check on an upload, in the transaction that publishes it: the
 * server is still on, the credential the URL was made for is still usable
 * and still holds what the URL needs, and the URL itself is still there.
 *
 * The credential is read under a lock that lasts to the commit (see
 * `credentialHolds`): an agent that signed in has its connection's row taken
 * there, and the upload has already taken a named token's row. Disconnecting,
 * revoking or editing either waits for this file or is seen here: a file is
 * never published after its credential's end has committed. The upload reads
 * the account's role again itself.
 *
 * The URL is removed in the same transaction, so it publishes one file and
 * no more. One that is already gone, taken with its connection or used by
 * another publication, publishes nothing.
 */
function publishCheck(transfer: Transfer, principal: AgentPrincipal) {
  const { scopes } = TOOL_CATALOG.create_upload_url
  return async (tx: Prisma.TransactionClient) => {
    if (
      !(await credentialHolds(tx, principal, scopes)) ||
      !(await consumeUpload(tx, transfer.id))
    )
      throw new HttpError(
        403,
        'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.'
      )
  }
}

export const POST = whileOn(
  transfers(
    async (request, { params }: Context) => {
      const transfer = await findTransfer((await params).ticket, 'upload')
      if (!transfer) return notFound()
      const principal = await holder(transfer, 'create_upload_url')
      if (!principal) return refused()
      // One request gets the URL, even of two that arrive together.
      if (!(await claimUpload(transfer.id)))
        throw new HttpError(
          409,
          'This upload URL is in use by another upload, or was already used. If that upload fails the URL can be used again; otherwise call create_upload_url for a new one.'
        )
      try {
        try {
          await uploadLimiter.consume(transfer.credential)
        } catch {
          throw new HttpError(429, 'Too many requests', {
            headers: { 'Retry-After': String(uploadLimiter.duration) },
          })
        }
        const { options, filename, passwordHash } = uploadOf(transfer)
        // The URL fixed every option when it was made; the form's fields and
        // the request's headers and query are not read.
        return apiResponse(
          await directUpload(request, principal.user, {
            options,
            filename,
            passwordHash,
            authorize: publishCheck(transfer, principal),
          })
        )
      } catch (error) {
        // Nothing was published, or the URL would be gone: give it back, so
        // the same command can be run again until it expires.
        await releaseUpload(transfer.id)
        throw error
      }
    },
    {
      ...uploadRoutes,
      audit: { action: 'mcp.transfer.upload', category: 'mcp' },
    }
  )
)
