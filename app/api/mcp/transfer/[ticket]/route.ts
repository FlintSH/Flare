import type { Prisma } from '@prisma/client'

import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { readConfig } from '@/lib/config'
import { type DeliveredFile, findFile, serveFile } from '@/lib/files/delivery'
import { HttpError } from '@/lib/http/errors'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import { tokenUsable } from '@/lib/integrations/tokens'
import { type AgentPrincipal, credentialPrincipal } from '@/lib/mcp/auth'
import { TOOL_CATALOG, type ToolName, toolAllowed } from '@/lib/mcp/catalog'
import { mcpEnabled, mcpNotFound } from '@/lib/mcp/settings'
import {
  claimUpload,
  consumeUpload,
  findTransfer,
  releaseUpload,
  uploadOf,
} from '@/lib/mcp/transfer'
import { connectionHolds } from '@/lib/oauth/connections'
import { uploadLimiter } from '@/lib/security/rate-limit'
import { directUpload } from '@/lib/uploads/direct'
import { uploadRoutes } from '@/lib/uploads/http'

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
 * Who a transfer was made for, if they may still use the tool it came from.
 * Everything is read from the row and the database as they are now: the
 * request carries no credential and none is looked for.
 */
async function holder(
  transfer: Transfer,
  tool: ToolName
): Promise<AgentPrincipal | null> {
  const principal = await credentialPrincipal(transfer.credential)
  return principal &&
    principal.user.id === transfer.userId &&
    toolAllowed(tool, principal)
    ? principal
    : null
}

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

export const GET = whileOn(
  transfers(
    async (request, { params }: Context) => {
      const transfer = await findTransfer((await params).ticket, 'download')
      if (!transfer) return notFound()
      if (!(await holder(transfer, 'read_file'))) return refused()
      const file: DeliveredFile | null = transfer.fileId
        ? await findFile({ id: transfer.fileId }, deliveredFields)
        : null
      if (!file) return notFound()
      // The link was made for the account's own file and opens no one else's.
      if (file.userId !== transfer.userId) return refused()
      setAuditTarget({ type: 'file', id: file.id, name: file.name })
      // Not a visit: nothing is counted, and no session or password is asked.
      const response = await serveFile(request, file, {
        disposition: 'attachment',
      })
      // A stored object that is gone answers like a file that is.
      if (response.status === 404) return notFound()
      response.headers.set('Cache-Control', 'no-store')
      return response
    },
    { audit: { action: 'mcp.transfer.download', category: 'mcp' } }
  )
)

/**
 * The last check on an upload, in the transaction that publishes it: the
 * server is still on, the credential the URL was made for is still usable
 * and still holds what the URL needs, and the URL itself is still there.
 *
 * The credential is read under a lock that lasts to the commit. For an agent
 * that signed in, `connectionHolds` takes its connection's row; for a named
 * token, the upload has already taken the token's row. Disconnecting,
 * revoking or editing either waits for this file or is seen here: a file is
 * never published after its credential's end has committed. The upload reads
 * the account's role again itself.
 *
 * The URL is removed in the same transaction, so it publishes one file and
 * no more. One that is already gone, taken with its connection or used by
 * another publication, publishes nothing.
 */
function publishCheck(transfer: Transfer, principal: AgentPrincipal) {
  const scopes = TOOL_CATALOG.create_upload_url.scopes
  const needed = [MCP_SCOPE, ...scopes]
  const connectionId = principal.user.agentConnection?.id
  /** Whether the credential, as the transaction holds it, may still upload. */
  const stillAllowed = async (tx: Prisma.TransactionClient) => {
    if (connectionId) return connectionHolds(tx, connectionId, scopes)
    const tokenId = principal.user.apiToken?.id
    const token = tokenId
      ? await tx.apiToken.findUnique({ where: { id: tokenId } })
      : null
    return Boolean(
      token &&
      tokenUsable(token) &&
      needed.every((scope) => token.scopes.includes(scope))
    )
  }
  return async (tx: Prisma.TransactionClient) => {
    if (
      !(await stillAllowed(tx)) ||
      !(await readConfig(tx)).settings.general.mcp.enabled ||
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
