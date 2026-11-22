import type { Prisma } from '@prisma/client'

import { getConfig, readConfig } from '@/lib/config'

/** Whether an administrator has turned the MCP server on. */
export async function mcpEnabled(): Promise<boolean> {
  return (await getConfig()).settings.general.mcp.enabled
}

/**
 * Whether an administrator lets agents administer the instance: only then
 * can a credential hold or use an `admin:*` scope. Pass a transaction to read
 * the settings as it sees them; otherwise the saved settings are read.
 *
 * Neither MCP setting can be changed through MCP. A tool that writes
 * settings must never accept or pass on anything under `general.mcp`.
 */
export async function administrationOn(
  tx?: Pick<Prisma.TransactionClient, 'config'>
): Promise<boolean> {
  const config = tx ? await readConfig(tx) : await getConfig()
  return config.settings.general.mcp.administration
}

/** What every MCP route answers while the server is off: nothing is there. */
export function mcpNotFound(): Response {
  return Response.json(
    { error: 'Not found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } }
  )
}
