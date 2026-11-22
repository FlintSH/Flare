'use client'

import { useEffect, useState } from 'react'

import { AlertCircle } from 'lucide-react'

import { useAttention, watchRestore } from '@/components/auth/attention'
import {
  AgentScopes,
  useAgentScopes,
} from '@/components/integrations/scope-picker'
import { adminConnectionEnd } from '@/components/integrations/shared'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { holdsAdminScope } from '@/lib/integrations/bearer-routes'
import {
  type ReturnDestination,
  destinationLabel,
  returnDestination,
} from '@/lib/mcp/clients'
import { AUTHORIZE_PATH } from '@/lib/oauth/constants'
import { cn } from '@/lib/utils'

const FAILED = 'Could not finish the connection. Try again.'

/**
 * How Allow is drawn while the page does not have the person's attention:
 * exactly as a button that is off. It is marked `aria-disabled` and not
 * turned off, so someone using the keyboard keeps their place on it while
 * they are away, and it is still announced as unavailable.
 */
const UNATTENDED =
  'aria-disabled:pointer-events-none aria-disabled:border-control aria-disabled:bg-transparent aria-disabled:text-muted-foreground aria-disabled:opacity-50 aria-disabled:shadow-none aria-disabled:grayscale'

type Decision = 'approve' | 'deny'

/**
 * The consent screen of an agent's sign-in: what is asking, where the browser
 * goes back to, which account, what the agent may do, and the decision.
 * Either decision posts the request back and follows the address the server
 * answers with, which leads to the client. A sign-in grants at least one
 * action, so an account that can be given none can only cancel.
 *
 * Allow does nothing until the page has been in front of the person for a
 * moment, and again whenever it stops being: a click meant for another page
 * must not be able to grant access. Cancel grants nothing, so it never
 * waits. Nothing here acts without script: there is no form to submit and no
 * link, only buttons whose handlers arrive with the script.
 */
export function ConnectForm({
  request,
  clientName,
  destination,
  account,
  available,
  ceiling,
}: {
  /** The signed request, posted back exactly as it arrived. */
  request: string
  /** The name the client gave itself, ready to show. */
  clientName: string
  destination: ReturnDestination
  /** The name of the signed-in account. */
  account: string
  /** The scopes the account's role can use, or null when it may not connect agents. */
  available: readonly string[] | null
  /** The most the client asked for; empty leaves the choice to the person. */
  ceiling: readonly string[]
}) {
  const picker = useAgentScopes(available ?? [], { ceiling })
  const [busy, setBusy] = useState<Decision | null>(null)
  const [left, setLeft] = useState<Decision | null>(null)
  const [error, setError] = useState('')
  const grantable = picker.offered.length > 0
  const attention = useAttention()

  // Going back to this page can bring it out of the browser's cache as it
  // was left: waiting on a navigation that is over, or saying it is done.
  // The request is good for ten minutes, and the server says so if it is not.
  useEffect(
    () =>
      watchRestore(() => {
        setBusy(null)
        setLeft(null)
      }),
    []
  )

  async function decide(decision: Decision) {
    setBusy(decision)
    setError('')
    try {
      const { redirect } = await apiRequest<{ redirect?: string }>(
        AUTHORIZE_PATH,
        {
          body: { request, decision, scopes: picker.scopes },
          fallback: FAILED,
          whole: true,
        }
      )
      // Never an address the browser would run instead of leaving for.
      if (!redirect || !returnDestination(redirect)) throw new Error(FAILED)
      // A website or a program on this device answers with a page of its
      // own. An app opened through its scheme leaves this one in place, so
      // it says what happened. Either way the request is spent: the
      // buttons stay off.
      window.location.assign(redirect)
      if (destination.kind === 'app') setLeft(decision)
    } catch (error) {
      setBusy(null)
      // A refusal says why, such as a request that has expired.
      setError(error instanceof RefusedRequest ? error.message : FAILED)
    }
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
        <dt className="text-muted-foreground">Agent</dt>
        <dd className="truncate font-medium" title={clientName}>
          {clientName}
        </dd>
        <dt className="text-muted-foreground">Returns to</dt>
        <dd className="break-words font-medium">
          {destinationLabel(destination, true)}
        </dd>
        <dt className="text-muted-foreground">Account</dt>
        <dd className="truncate font-medium" title={account}>
          {account}
        </dd>
      </dl>
      {grantable && !left && (
        <div className="space-y-2">
          <AgentScopes
            picker={picker}
            credential="connection"
            disabled={busy !== null}
            narrow
          />
          {/* Beside the choice that sets it. Never on the first drawing,
              which ticks no administration scope, so the server's date and
              the browser's cannot disagree. */}
          {holdsAdminScope(picker.scopes) && (
            <p className="text-pretty text-sm text-muted-foreground">
              This connection ends on {adminConnectionEnd()}.
            </p>
          )}
        </div>
      )}
      {available && !grantable && (
        <p className="text-pretty text-sm text-muted-foreground">
          {picker.roleAllowsNothing
            ? 'Your role allows no file, short link or account setting actions, so there is nothing to allow.'
            : 'Your role allows none of the actions this agent asked for, so there is nothing to allow.'}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {left ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {left === 'approve'
            ? // The browser may have asked before opening the app, and Flare
              // cannot tell whether the answer was no.
              'Allowed. You can close this tab. If the app did not open, reload this page and allow again.'
            : 'Cancelled. You can close this tab.'}
        </p>
      ) : (
        <div className={cn('grid gap-2', grantable && 'grid-cols-2')}>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy !== null}
            onClick={() => void decide('deny')}
          >
            {busy === 'deny' ? (
              <>
                <Icons.spinner className="animate-spin" aria-hidden="true" />
                Cancelling…
              </>
            ) : (
              'Cancel'
            )}
          </Button>
          {grantable && (
            <Button
              type="button"
              className={cn('h-11', UNATTENDED)}
              disabled={busy !== null || picker.incomplete}
              aria-disabled={!attention.attended || undefined}
              onClick={() => {
                // Asked now, not as last drawn: see `useAttention`.
                if (attention.holds()) void decide('approve')
              }}
            >
              {busy === 'approve' ? (
                <>
                  <Icons.spinner className="animate-spin" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                'Allow'
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
