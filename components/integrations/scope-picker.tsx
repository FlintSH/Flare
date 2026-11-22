'use client'

import { useId, useState } from 'react'

import { SetupOption } from '@/components/shared/setup-option'
import { RadioGroup } from '@/components/ui/radio-group'

import {
  API_SCOPE_CATALOG,
  MCP_SCOPE,
  scopeWorksOverApi,
} from '@/lib/integrations/bearer-routes'
import { scopeAvailable } from '@/lib/mcp/catalog'
import { agentScopeChoices } from '@/lib/mcp/clients'
import { ADMIN_CONNECTION_DAYS } from '@/lib/oauth/constants'
import type { Permission } from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

type ScopeEntry = (typeof API_SCOPE_CATALOG)[number]

/** The catalog's groups, as the picker names them. Agent access stands alone. */
const GROUPS = [
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Short links' },
  { id: 'account', label: 'Account' },
  { id: 'administration', label: 'Administration' },
] as const

/** What a picker's choices are for: the rules on how long they last differ. */
export type ScopeCredential = 'token' | 'connection'

/**
 * The line under the Administration group. A token's limit is told beside
 * its expiry, where it applies; a connection has no expiry to choose.
 */
export const ADMINISTRATION_NOTE: Record<ScopeCredential, string> = {
  token: 'These let the agent act on other accounts and the instance itself.',
  connection: `These let the agent act on other accounts and the instance itself, and a connection that holds one ends after ${ADMIN_CONNECTION_DAYS} days.`,
}

/** Why a scope the connection does not hold cannot be ticked in Edit permissions. */
export const SIGN_IN_ONLY_REASON = 'Connect the agent again to grant this.'

/**
 * The scopes a token can hold besides Agent access, for an account that
 * `can`. `administration` says whether administration through MCP is on.
 */
export function offeredScopes(
  can: (permission: Permission) => boolean,
  mcp: boolean,
  administration: boolean
): ScopeEntry[] {
  return API_SCOPE_CATALOG.filter(
    ({ scope }) =>
      scope !== MCP_SCOPE && scopeAvailable(scope, can, mcp, administration)
  )
}

/**
 * The checkboxes for a token's scopes, limited to what the account's role
 * can use. While the MCP server is off this is the plain list of REST scopes.
 * While it is on, either Agent access is a checkbox that reveals the scopes
 * only agents use (`agent="optional"`, the token form), or the token is for
 * an agent and all of them show (`agent="always"`); with those scopes in view
 * the list is long enough to group under Files, Short links, Account and,
 * while administration through MCP is on, Administration.
 */
export function ScopePicker({
  selected,
  onChange,
  can,
  mcp,
  administration,
  credential,
  agent = 'optional',
  only,
  locked = [],
  narrow = false,
}: {
  selected: readonly string[]
  onChange: (scopes: string[]) => void
  can: (permission: Permission) => boolean
  /** Whether the MCP server is on. */
  mcp: boolean
  /** Whether administration through MCP is on. */
  administration: boolean
  credential: ScopeCredential
  agent?: 'optional' | 'always'
  /** Show no scope outside this list, such as what a sign-in asked for. */
  only?: readonly string[]
  /** Scopes shown that cannot be ticked; see `SIGN_IN_ONLY_REASON`. */
  locked?: readonly string[]
  /** One column at every width, for a card too narrow for two. */
  narrow?: boolean
}) {
  const id = useId()
  const agentAccess = API_SCOPE_CATALOG.find(({ scope }) => scope === MCP_SCOPE)
  const agentOn = mcp && (agent === 'always' || selected.includes(MCP_SCOPE))
  const shown = offeredScopes(can, mcp, administration).filter(
    ({ scope }) =>
      (agentOn || scopeWorksOverApi(scope)) && (!only || only.includes(scope))
  )
  const columns = cn('grid gap-2', !narrow && 'sm:grid-cols-2')

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

  const row = ({ scope, label, description }: ScopeEntry) => {
    // A locked scope that is still ticked can be unticked, not ticked again.
    const lockedOff = locked.includes(scope) && !selected.includes(scope)
    return (
      <label
        key={scope}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
          lockedOff && 'cursor-not-allowed'
        )}
      >
        <input
          type="checkbox"
          // The shared checkbox has no look of its own for off.
          className={cn('mt-0.5', lockedOff && 'cursor-not-allowed opacity-50')}
          checked={selected.includes(scope)}
          disabled={lockedOff}
          aria-describedby={lockedOff ? `${id}-${scope}-locked` : undefined}
          onChange={(event) => toggle(scope, event.target.checked)}
        />
        <span className="min-w-0">
          <span
            className={cn(
              'block text-sm font-medium',
              lockedOff && 'text-muted-foreground'
            )}
          >
            {label}
          </span>
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
          {lockedOff && (
            <span
              id={`${id}-${scope}-locked`}
              className="mt-1 block text-pretty text-xs font-medium text-muted-foreground"
            >
              {SIGN_IN_ONLY_REASON}
            </span>
          )}
        </span>
      </label>
    )
  }

  if (!mcp) return <div className="space-y-2">{shown.map(row)}</div>

  return (
    <div className="space-y-3">
      {agent === 'optional' && agentAccess && row(agentAccess)}
      {agentOn ? (
        GROUPS.map((group) => {
          const scopes = shown.filter((entry) => entry.group === group.id)
          if (!scopes.length) return null
          const note = group.id === 'administration'
          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${id}-${group.id}`}
              aria-describedby={note ? `${id}-${group.id}-note` : undefined}
              className="space-y-2"
            >
              <div className="space-y-0.5">
                <p
                  id={`${id}-${group.id}`}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {group.label}
                </p>
                {note && (
                  <p
                    id={`${id}-${group.id}-note`}
                    className="text-pretty text-xs text-muted-foreground"
                  >
                    {ADMINISTRATION_NOTE[credential]}
                  </p>
                )}
              </div>
              <div className={columns}>{scopes.map(row)}</div>
            </div>
          )
        })
      ) : (
        // The few REST scopes name their own subject; headings would only
        // repeat it.
        <div className={columns}>{shown.map(row)}</div>
      )}
    </div>
  )
}

/** Brings the checkboxes Custom adds into view; on a phone they open below the fold. */
const reveal = (element: HTMLElement | null) =>
  element?.scrollIntoView({ block: 'nearest' })

/**
 * What an agent may do, as the dialogs and the consent screen pick it: a
 * preset, or Custom with each scope ticked by hand. `available` is what the
 * account's role can use; see `agentScopeChoices` for `ceiling` and `held`.
 * Pass the result to `AgentScopes` and send `scopes`.
 */
export function useAgentScopes(
  available: readonly string[],
  limits: { ceiling?: readonly string[]; held?: readonly string[] } = {}
) {
  const start = agentScopeChoices(available, limits)
  // Null until the person picks: the picker then shows what it starts on,
  // which is only known once the session has said what the role allows.
  const [picked, setPicked] = useState<string | null>(null)
  const [ticked, setTicked] = useState<string[] | null>(null)
  const { offered, presets } = start
  const choice = picked ?? start.choice
  const custom = ticked ?? start.scopes
  // The chosen preset may be one this role cannot tell from a smaller one.
  const preset =
    choice === 'custom'
      ? undefined
      : (presets.find((candidate) => candidate.id === choice) ?? presets[0])
  const scopes = preset ? preset.scopes : custom
  return {
    offered,
    presets,
    preset,
    custom,
    setCustom: setTicked,
    /** What to grant. */
    scopes,
    /** Whether there is something to pick and nothing is picked. */
    incomplete: offered.length > 0 && scopes.length === 0,
    /** Whether the role, not the request, is why nothing is offered. */
    roleAllowsNothing: available.length === 0,
    /** Whether the person has picked, rather than the picker's start showing. */
    picked: picked !== null,
    choose(value: string) {
      // Custom starts from what was chosen, not from nothing.
      if (value === 'custom') setTicked(scopes)
      setPicked(value)
    },
  }
}

/**
 * `only` already holds what the role can use and the instance allows, so
 * nothing more is filtered.
 */
const everything = () => true

/** The presets and Custom, with the checkboxes Custom opens. */
export function AgentScopes({
  picker,
  credential,
  locked,
  disabled,
  narrow = false,
}: {
  picker: ReturnType<typeof useAgentScopes>
  credential: ScopeCredential
  /** Scopes shown that cannot be ticked; see `SIGN_IN_ONLY_REASON`. */
  locked?: readonly string[]
  disabled?: boolean
  /** One column at every width, for a card too narrow for two. */
  narrow?: boolean
}) {
  const id = useId()
  const { offered, presets, preset, custom } = picker
  if (!offered.length)
    return (
      <p className="text-pretty text-sm text-muted-foreground">
        Your role allows no file, short link or account setting actions, so the
        agent will only see your account details.
      </p>
    )
  return (
    <fieldset disabled={disabled}>
      <legend id={`${id}-actions`} className="mb-2 text-sm font-medium">
        Allowed actions
      </legend>
      {presets.length > 0 && (
        <RadioGroup
          value={preset?.id ?? 'custom'}
          onValueChange={picker.choose}
          aria-labelledby={`${id}-actions`}
          className={cn(!narrow && 'sm:grid-cols-2')}
        >
          {presets.map((candidate) => (
            <SetupOption
              key={candidate.id}
              id={`${id}-preset-${candidate.id}`}
              value={candidate.id}
              selected={preset?.id === candidate.id}
              title={candidate.label}
              description={candidate.description}
              className="p-3"
            />
          ))}
          <SetupOption
            id={`${id}-preset-custom`}
            value="custom"
            selected={!preset}
            title="Custom"
            description="Pick each action yourself."
            className="p-3"
          />
        </RadioGroup>
      )}
      {!preset && (
        // Brought into view when the person picks Custom, not when the
        // picker opens on it.
        <div
          ref={picker.picked ? reveal : undefined}
          className={cn(presets.length > 0 && 'mt-3')}
        >
          <ScopePicker
            selected={custom}
            onChange={picker.setCustom}
            can={everything}
            mcp
            // Like the role, whether administration is on is already in
            // `only`: its scopes are there only while it is.
            administration
            credential={credential}
            agent="always"
            only={offered}
            locked={locked}
            narrow={narrow}
          />
        </div>
      )}
    </fieldset>
  )
}
