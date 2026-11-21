'use client'

import { useId } from 'react'

import {
  API_SCOPE_CATALOG,
  MCP_SCOPE,
  scopeWorksOverApi,
} from '@/lib/integrations/bearer-routes'
import { scopeAvailable } from '@/lib/mcp/catalog'
import type { Permission } from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

type ScopeEntry = (typeof API_SCOPE_CATALOG)[number]

/** The catalog's groups, as the picker names them. Agent access stands alone. */
const GROUPS = [
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Short links' },
] as const

/** The scopes a token can hold besides Agent access, for an account that `can`. */
export function offeredScopes(
  can: (permission: Permission) => boolean,
  mcp: boolean
): ScopeEntry[] {
  return API_SCOPE_CATALOG.filter(
    ({ scope }) => scope !== MCP_SCOPE && scopeAvailable(scope, can, mcp)
  )
}

/**
 * The checkboxes for a token's scopes, limited to what the account's role
 * can use. While the MCP server is off this is the plain list of REST scopes.
 * While it is on, either Agent access is a checkbox that reveals the scopes
 * only agents use (`agent="optional"`, the token form), or the token is for
 * an agent and all of them show (`agent="always"`); with those scopes in view
 * the list is long enough to group under Files and Short links.
 */
export function ScopePicker({
  selected,
  onChange,
  can,
  mcp,
  agent = 'optional',
}: {
  selected: readonly string[]
  onChange: (scopes: string[]) => void
  can: (permission: Permission) => boolean
  /** Whether the MCP server is on. */
  mcp: boolean
  agent?: 'optional' | 'always'
}) {
  const id = useId()
  const agentAccess = API_SCOPE_CATALOG.find(({ scope }) => scope === MCP_SCOPE)
  const agentOn = mcp && (agent === 'always' || selected.includes(MCP_SCOPE))
  const shown = offeredScopes(can, mcp).filter(
    ({ scope }) => agentOn || scopeWorksOverApi(scope)
  )

  function toggle(scope: string, checked: boolean) {
    if (checked) return onChange([...selected, scope])
    onChange(
      selected.filter((held) =>
        // Without Agent access, the scopes only agents use mean nothing.
        scope === MCP_SCOPE
          ? held !== MCP_SCOPE && scopeWorksOverApi(held)
          : held !== scope
      )
    )
  }

  const row = ({ scope, label, description }: ScopeEntry) => (
    <label
      key={scope}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
    >
      <input
        type="checkbox"
        className="mt-0.5"
        checked={selected.includes(scope)}
        onChange={(event) => toggle(scope, event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {/* In the grouped columns a description can wrap, so it sets its
            own line height there. */}
        <span
          className={cn(
            'text-xs text-muted-foreground',
            mcp && 'mt-0.5 block text-pretty'
          )}
        >
          {description}
        </span>
      </span>
    </label>
  )

  if (!mcp) return <div className="space-y-2">{shown.map(row)}</div>

  return (
    <div className="space-y-3">
      {agent === 'optional' && agentAccess && row(agentAccess)}
      {agentOn ? (
        GROUPS.map((group) => {
          const scopes = shown.filter((entry) => entry.group === group.id)
          if (!scopes.length) return null
          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${id}-${group.id}`}
              className="space-y-2"
            >
              <p
                id={`${id}-${group.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {group.label}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">{scopes.map(row)}</div>
            </div>
          )
        })
      ) : (
        // The few REST scopes name their own subject; headings would only
        // repeat it.
        <div className="grid gap-2 sm:grid-cols-2">{shown.map(row)}</div>
      )}
    </div>
  )
}
