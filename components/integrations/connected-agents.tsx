'use client'

import { type FormEvent, useId, useState } from 'react'

import { AlertCircle } from 'lucide-react'

import {
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/shared/form-styles'
import { MetaLine } from '@/components/shared/meta-line'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { apiRequest } from '@/lib/client/request'
import {
  destinationLabel,
  returnDestination,
  shownClientName,
} from '@/lib/mcp/clients'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { usePermissions } from '@/hooks/use-permissions'

import { AgentScopes, offeredScopes, useAgentScopes } from './scope-picker'

/** An agent that signed in through the browser, as the integrations query lists it. */
export type AgentConnection = {
  id: string
  /** The name the client gave itself. It is shown as text and trusted for nothing. */
  clientName: string
  /** The redirect address its sign-in returned to. */
  returnsTo: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}

const SAVE_FAILED = 'Could not save the permissions.'

/**
 * The agents that signed in to this account: what each may do, with a way to
 * change that and to disconnect it. Nothing is drawn while there are none.
 * Agents that use a token are in the API tokens list instead.
 */
export function ConnectedAgents({
  connections,
  disabled,
  onDisconnect,
  onSaved,
}: {
  connections: readonly AgentConnection[]
  disabled?: boolean
  onDisconnect: (connection: AgentConnection) => void
  /** A connection's permissions changed; the list should load again. */
  onSaved: () => void
}) {
  const id = useId()
  const { can } = usePermissions()
  if (!connections.length) return null
  const available = offeredScopes(can, true)

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        Connected agents
      </h3>
      {/* Two to a row on wide screens, the width of the token and webhook
          entries in the cards below. */}
      <ul className="grid gap-3 xl:grid-cols-2">
        {connections.map((connection) => {
          const name = shownClientName(connection.clientName)
          const destination = returnDestination(connection.returnsTo)
          // Like a token's chips: only what the role can still use.
          const held = available.filter(({ scope }) =>
            connection.scopes.includes(scope)
          )
          return (
            <li
              key={connection.id}
              className="flex min-w-0 flex-col rounded-xl border bg-muted/30 p-4"
            >
              <h4 className="truncate text-sm font-medium" title={name}>
                {name}
              </h4>
              <MetaLine
                className="mt-1 text-xs text-muted-foreground"
                items={[
                  ...(destination
                    ? [
                        {
                          key: 'where',
                          text: destinationLabel(destination, false),
                        },
                      ]
                    : []),
                  {
                    key: 'connected',
                    text: `Connected ${new Date(connection.createdAt).toLocaleDateString()}`,
                  },
                  {
                    key: 'use',
                    text: connection.lastUsedAt
                      ? `Used ${new Date(connection.lastUsedAt).toLocaleDateString()}`
                      : 'Not used yet',
                  },
                ]}
              />
              {held.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {held.map(({ scope, label }) => (
                    <Badge key={scope}>{label}</Badge>
                  ))}
                </div>
              )}
              {/* Under the details, like a webhook's actions, and at the foot
                  so two entries side by side line theirs up. */}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <EditPermissionsDialog
                  connection={connection}
                  disabled={disabled}
                  onSaved={onSaved}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-danger/10 hover:text-destructive"
                  disabled={disabled}
                  onClick={() => onDisconnect(connection)}
                >
                  Disconnect
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The button that opens one agent's permissions, with its dialog. The button
 * is the dialog's trigger, so focus returns to it when the dialog closes.
 */
function EditPermissionsDialog({
  connection,
  disabled,
  onSaved,
}: {
  connection: AgentConnection
  disabled?: boolean
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Edit permissions
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!saving} className={formDialogClassName}>
        {/* Mounted with the dialog, so every opening starts from what the
            agent holds now. */}
        <EditPermissions
          connection={connection}
          saving={saving}
          onSavingChange={setSaving}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onSaved()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditPermissions({
  connection,
  saving,
  onSavingChange,
  onClose,
  onSaved,
}: {
  connection: AgentConnection
  saving: boolean
  onSavingChange: (saving: boolean) => void
  onClose: () => void
  onSaved: () => void
}) {
  const { can } = usePermissions()
  const picker = useAgentScopes(
    offeredScopes(can, true).map(({ scope }) => scope),
    { held: connection.scopes }
  )
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSavingChange(true)
    setError('')
    try {
      await apiRequest('/api/integrations', {
        body: {
          action: 'update-agent',
          id: connection.id,
          scopes: picker.scopes,
        },
        fallback: SAVE_FAILED,
        whole: true,
      })
      onSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : SAVE_FAILED)
    } finally {
      onSavingChange(false)
    }
  }

  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>Edit permissions</DialogTitle>
        <DialogDescription className="break-words">
          What {shownClientName(connection.clientName)} may do with your
          account.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollFadeRef} className={formDialogBodyClassName}>
          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AgentScopes picker={picker} disabled={saving} />
          <p className="text-pretty text-xs text-muted-foreground">
            A removed permission applies on the agent&apos;s next call. An added
            one appears once the client reloads its tools.
          </p>
        </div>
        <DialogFooter className={formDialogFooterClassName}>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          {/* A connection holds at least one permission. */}
          <Button type="submit" disabled={saving || !picker.scopes.length}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
