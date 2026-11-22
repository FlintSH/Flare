import { getConfig } from '@/lib/config'

/** Whether an administrator has turned the MCP server on. */
export async function mcpEnabled(): Promise<boolean> {
  return (await getConfig()).settings.general.mcp.enabled
}

/** What every MCP route answers while the server is off: nothing is there. */
export function mcpNotFound(): Response {
  return Response.json(
    { error: 'Not found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } }
  )
}
