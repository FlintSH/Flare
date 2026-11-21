import { auditRequest, setAuditOutcome } from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'
import { applyCors, originAllowed, preflight } from '@/lib/http/cors'
import { authenticateAgent } from '@/lib/mcp/auth'
import { TOOL_CATALOG, type ToolName } from '@/lib/mcp/catalog'
import { type McpRequestExtra, mcpHandler } from '@/lib/mcp/server'
import { mcpEnabled, mcpNotFound } from '@/lib/mcp/settings'
import { publicOrigin } from '@/lib/security/public-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROUTE = '/api/mcp'
/** MCP requests are small JSON documents; file bytes travel by transfer URL. */
const MAX_BODY_BYTES = 1024 * 1024

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })

/**
 * The request's body as text, or null once it passes the limit. The body is
 * read as it arrives and abandoned at the limit: a sender that states no
 * length, or never finishes, cannot make the server hold more than that.
 */
async function boundedText(request: Request): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** A request body as JSON, or undefined when it is not JSON. */
function parsed(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** The tool a JSON-RPC message calls, when it calls one this server has. */
function calledTool(message: unknown): ToolName | null {
  const { method, params } = (message ?? {}) as {
    method?: unknown
    params?: { name?: unknown }
  }
  const name = method === 'tools/call' && params?.name
  // Only the catalog's own rows: `toString` is not a tool.
  return typeof name === 'string' && Object.hasOwn(TOOL_CATALOG, name)
    ? (name as ToolName)
    : null
}

/**
 * Whether a JSON-RPC answer reports a failure: a protocol error, or a tool
 * result marked as one. 2025-era answers arrive framed as one server-sent
 * event.
 */
function answerFailed(body: string): boolean {
  const data = body.startsWith('{')
    ? body
    : (body.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5)
  const answer = parsed(data) as
    { error?: unknown; result?: { isError?: unknown } } | undefined
  return Boolean(answer?.error || answer?.result?.isError)
}

/** Records a request refused before it reached a tool, then answers it. */
const refuse = (request: Request, response: Response) =>
  auditRequest(
    request,
    { route: ROUTE, action: 'mcp.request', category: 'mcp' },
    async () => response
  )

async function serve(request: Request): Promise<Response> {
  if (!(await mcpEnabled())) return mcpNotFound()
  // Browsers on other sites may call only when the operator allowed them.
  if (!originAllowed(request, publicOrigin()?.origin ?? null))
    return refuse(
      request,
      json(403, { error: 'This origin may not use the MCP server.' })
    )
  // Stateless: there is no stream to open and no session to end.
  if (request.method !== 'POST')
    return refuse(
      request,
      json(405, { error: 'Method not allowed.' }, { Allow: 'POST' })
    )
  const tooLarge = () =>
    refuse(request, json(413, { error: 'Request body too large.' }))
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    return tooLarge()
  const body = await boundedText(request)
  if (body === null) return tooLarge()
  const message = parsed(body)
  // Batches left the protocol in 2025-06-18. Serving one would run several
  // tool calls under a single audit entry that names none of them.
  if (Array.isArray(message))
    return refuse(
      request,
      json(400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'Batch requests are not supported. Send one request at a time.',
        },
      })
    )
  const tool = calledTool(message)
  const response = await auditRequest(
    request,
    {
      route: ROUTE,
      action: tool ? `mcp.${tool}` : 'mcp.request',
      category: 'mcp',
      // Listing tools and negotiating a version change nothing: only a
      // refusal of them is worth a line. Every tool call is recorded.
      skipSuccess: !tool,
      read: tool ? TOOL_CATALOG[tool].annotations.readOnly : true,
    },
    async () => {
      const principal = await authenticateAgent(request)
      if (!principal) {
        setAuditOutcome('denied')
        return json(
          401,
          {
            error: 'unauthorized',
            error_description:
              'Send an API token that has Agent access as "Authorization: Bearer <token>". Create one in Flare under Profile, Integrations.',
          },
          { 'WWW-Authenticate': 'Bearer realm="Flare MCP"' }
        )
      }
      const answer = await mcpHandler().fetch(
        new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body,
          signal: request.signal,
        }),
        {
          authInfo: {
            token: '',
            clientId: principal.credentialKey,
            scopes: [...principal.scopes],
            extra: { principal, calling: tool } satisfies McpRequestExtra,
          },
        }
      )
      // Everything but a tool call passes through as it is: a client that
      // listens for changes holds its stream open for as long as it stays
      // connected, and waiting for that to end would hang it.
      if (!tool)
        return new Response(answer.body, {
          status: answer.status,
          headers: answer.headers,
        })
      // A tool's answer can be a stream that is still being written. Reading
      // it here keeps the tool inside this audited request, so the entry
      // records the target and outcome the tool set, not a success declared
      // early.
      const text = await answer.text()
      // Arguments the protocol layer rejects never reach the tool, which is
      // where an outcome is otherwise set; the answer still says it failed.
      if (!auditContext.getStore()?.outcome && answerFailed(text))
        setAuditOutcome('failure')
      return new Response(text, {
        status: answer.status,
        headers: answer.headers,
      })
    }
  )
  return applyCors(request, response, 'mcp')
}

export { serve as GET, serve as POST, serve as DELETE }
const answerPreflight = preflight('mcp')

/** While the server is off, even a preflight finds nothing here. */
export async function OPTIONS(request: Request): Promise<Response> {
  return (await mcpEnabled()) ? answerPreflight(request) : mcpNotFound()
}
