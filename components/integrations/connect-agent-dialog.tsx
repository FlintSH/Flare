'use client'

import { type FormEvent, type ReactNode, useId, useState } from 'react'

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { AlertCircle, ChevronDown, ExternalLink, Info } from 'lucide-react'

import {
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/shared/form-styles'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { apiRequest } from '@/lib/client/request'
import { MCP_SCOPE, holdsAdminScope } from '@/lib/integrations/bearer-routes'
import { CONNECTION_NAME_MAX_LENGTH } from '@/lib/integrations/limits'
import {
  AGENT_CLIENTS,
  type AgentClient,
  type AgentClientId,
  type AgentLink,
  type AgentSetup,
  type AgentSnippet,
  type TokenClient,
  agentClient,
  outOfReach,
} from '@/lib/mcp/clients'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { usePermissions } from '@/hooks/use-permissions'

import { CopyButton } from './copy-button'
import { AgentScopes, offeredScopes, useAgentScopes } from './scope-picker'
import { DEFAULT_TOKEN_LIFETIME, allowedLifetime, tokenExpiry } from './shared'
import { TokenLifetime } from './token-lifetime'

const CREATE_FAILED = 'Could not create the token.'

/** A token named "Other" would say nothing in the token list. */
const tokenName = (client: { id: string; label: string }) =>
  client.id === 'other' ? 'Agent' : client.label

const TOKEN_CLIENTS: readonly AgentClient[] = AGENT_CLIENTS.filter(
  (client) => client.method === 'token'
)

/**
 * Connect an agent: pick the client and follow its steps. The agent signs in
 * through the browser, so nothing is created here. "Use a token instead"
 * swaps the steps for a form that creates a named token and then shows that
 * client's steps with the token filled in.
 *
 * `children` holds the `DialogTrigger` that opens it, so focus returns to
 * that button when the dialog closes.
 */
export function ConnectAgentDialog({
  url,
  administration,
  onCreated,
  children,
}: {
  /** The MCP endpoint clients connect to. */
  url: string
  /** Whether administration through MCP is on. */
  administration: boolean
  /** A token now exists; the token list should load again. */
  onCreated: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The token is shown once, so a stray click outside must not close it.
  const [holdsSecret, setHoldsSecret] = useState(false)
  function change(next: boolean) {
    if (busy) return
    if (!next) setHoldsSecret(false)
    setOpen(next)
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      {children}
      <DialogContent
        showCloseButton={!busy}
        // A little wider than a form dialog: commands read better unbroken.
        className={cn(formDialogClassName, 'sm:max-w-xl')}
        onInteractOutside={(event) => {
          if (holdsSecret) event.preventDefault()
        }}
      >
        {/* Mounted with the dialog, so every opening starts from the defaults. */}
        <ConnectAgent
          url={url}
          administration={administration}
          busy={busy}
          onBusyChange={setBusy}
          onCreated={() => {
            setHoldsSecret(true)
            onCreated()
          }}
          onClose={() => change(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConnectAgent({
  url,
  administration,
  busy,
  onBusyChange,
  onCreated,
  onClose,
}: {
  url: string
  administration: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onCreated: () => void
  onClose: () => void
}) {
  const id = useId()
  const { can } = usePermissions()
  const [clientId, setClientId] = useState<AgentClientId>(AGENT_CLIENTS[0].id)
  const client = agentClient(clientId)
  // Only a client that takes a token is ever asked for one.
  const [withToken, setWithToken] = useState(false)
  const picker = useAgentScopes(
    offeredScopes(can, true, administration).map(({ scope }) => scope)
  )
  // Null follows the client's name until the person types their own.
  const [typedName, setTypedName] = useState<string | null>(null)
  const name = typedName ?? tokenName(client)
  const [lifetime, setLifetime] = useState<string>(DEFAULT_TOKEN_LIFETIME)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{
    client: TokenClient
    token: string
  } | null>(null)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!withToken || client.method !== 'token') return
    onBusyChange(true)
    setError('')
    try {
      const result = await apiRequest<{ secret?: string }>(
        '/api/integrations',
        {
          body: {
            action: 'create-token',
            name,
            scopes: [MCP_SCOPE, ...picker.scopes],
            expiresAt: tokenExpiry(
              Number(allowedLifetime(lifetime, holdsAdminScope(picker.scopes)))
            ),
          },
          fallback: CREATE_FAILED,
          whole: true,
        }
      )
      if (!result.secret) throw new Error(CREATE_FAILED)
      setCreated({ client, token: result.secret })
      onCreated()
    } catch (error) {
      setError(error instanceof Error ? error.message : CREATE_FAILED)
    } finally {
      onBusyChange(false)
    }
  }

  if (created)
    return (
      <>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {created.client.id === 'other'
              ? 'Connect your client'
              : `Connect ${created.client.label}`}
          </DialogTitle>
          <DialogDescription>
            The token is shown only this once. Copy what you need before you
            close this.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollFadeRef} className={formDialogBodyClassName}>
            <SetupSteps
              setup={created.client.setup(url, created.token)}
              token={created.token}
            />
          </div>
          <DialogFooter className={formDialogFooterClassName}>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </div>
      </>
    )

  const blocked = withToken ? null : outOfReach(client, url)
  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>Connect an agent</DialogTitle>
        <DialogDescription>
          {withToken
            ? 'Flare creates a token for the agent and shows the steps for your client.'
            : 'Add Flare to your client, then sign in through your browser.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={create} className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollFadeRef} className={formDialogBodyClassName}>
          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <p id={`${id}-client`} className="text-sm font-medium leading-none">
              Client
            </p>
            {/* A radio group drawn as chips: the arrow keys move between
                clients and Tab leaves the group. */}
            <RadioGroupPrimitive.Root
              aria-labelledby={`${id}-client`}
              value={clientId}
              onValueChange={(value) => {
                setClientId(value as AgentClientId)
                setError('')
              }}
              disabled={busy}
              className="flex flex-wrap gap-1.5"
            >
              {(withToken ? TOKEN_CLIENTS : AGENT_CLIENTS).map((candidate) => (
                <RadioGroupPrimitive.Item
                  key={candidate.id}
                  value={candidate.id}
                  data-flare-control=""
                  className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border bg-muted/30 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:text-foreground sm:h-8"
                >
                  {candidate.label}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </div>
          {withToken ? (
            <>
              <AgentScopes picker={picker} credential="token" disabled={busy} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${id}-name`}>Connection name</Label>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    onChange={(event) => setTypedName(event.target.value)}
                    required
                    maxLength={CONNECTION_NAME_MAX_LENGTH}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-lifetime`}>Expires after</Label>
                  <TokenLifetime
                    id={`${id}-lifetime`}
                    value={lifetime}
                    onChange={setLifetime}
                    scopes={picker.scopes}
                    disabled={busy}
                  />
                </div>
              </div>
            </>
          ) : blocked ? (
            <Alert variant="info" role="status">
              <Info aria-hidden="true" />
              <AlertDescription>{blocked}</AlertDescription>
            </Alert>
          ) : (
            // Keyed, so one client's opened "other ways" do not carry over.
            <SetupSteps key={client.id} setup={client.signIn(url)} />
          )}
        </div>
        {withToken ? (
          <DialogFooter
            className={cn(formDialogFooterClassName, 'sm:justify-between')}
          >
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setWithToken(false)
                setError('')
              }}
            >
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy || !name.trim() || picker.incomplete}
            >
              {busy ? 'Creating…' : 'Create token'}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter
            className={cn(
              formDialogFooterClassName,
              client.method === 'token' && 'sm:justify-between'
            )}
          >
            {client.method === 'token' && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setWithToken(true)}
              >
                Use a token instead
              </Button>
            )}
            <Button type="button" onClick={onClose}>
              {blocked ? 'Close' : 'Done'}
            </Button>
          </DialogFooter>
        )}
      </form>
    </>
  )
}

/**
 * A step's sentence, with the code it marks in backticks set as code and
 * kept on one line, so a flag is not split at its hyphens.
 */
function Prose({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 ? (
      <code
        key={index}
        className="whitespace-nowrap rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
      >
        {part}
      </code>
    ) : (
      part
    )
  )
}

/** One thing to copy: a command, a file's contents, or a single value. */
function Snippet({
  snippet,
  name,
  titled = false,
}: {
  snippet: AgentSnippet
  /** What the copy button copies, for its accessible name. */
  name: string
  /** Show where it goes; a step's own sentence already says. */
  titled?: boolean
}) {
  const file = snippet.language === 'json' || snippet.language === 'toml'
  return (
    <div className="space-y-1.5">
      {titled && (
        <div className="space-y-0.5 text-xs">
          <p className="font-medium">{snippet.title}</p>
          {snippet.note && (
            <p className="text-pretty text-muted-foreground">
              <Prose text={snippet.note} />
            </p>
          )}
        </div>
      )}
      <div className="flex items-start gap-1 rounded-lg border bg-background p-1.5 pl-3">
        {/* Long lines wrap rather than scroll, so a token is never cut off
            at the edge. The auto margin centres one line beside the copy
            button, which is taller on touch screens. */}
        <pre
          className={cn(
            'my-auto min-w-0 flex-1 whitespace-pre-wrap py-1.5 font-mono text-xs leading-relaxed',
            // A file keeps each value on its key's line and breaks at the
            // edge, so its indentation never ends up on a line of its own.
            file && 'break-all'
          )}
        >
          {/* In a command each word moves to the next line whole, so a flag
              is never split at one of its hyphens; only a word longer than a
              line, such as the token, breaks inside. */}
          {file
            ? snippet.code
            : snippet.code.split(/(\s+)/).map((part, index) =>
                index % 2 ? (
                  part
                ) : (
                  <span
                    key={index}
                    className="inline-block max-w-full [overflow-wrap:anywhere]"
                  >
                    {part}
                  </span>
                )
              )}
        </pre>
        <CopyButton
          value={snippet.code}
          name={name}
          variant="ghost"
          className="h-8 w-8 shrink-0"
        />
      </div>
    </div>
  )
}

/**
 * A one-click install. A link that holds a token is never shown and has a
 * note saying where the token goes; one that holds nothing secret can also
 * be copied, to open on the computer the client runs on.
 */
function InstallLink({ link }: { link: AgentLink }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={link.href} rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            {link.label}
          </a>
        </Button>
        {!link.note && (
          <CopyButton value={link.href} name="install link" label="Copy link" />
        )}
      </div>
      {link.note && (
        <p className="text-pretty text-xs text-muted-foreground">{link.note}</p>
      )}
    </div>
  )
}

/**
 * A client's steps, then the other ways to do the same. With `token`, the
 * token on its own is one of those ways.
 */
function SetupSteps({ setup, token }: { setup: AgentSetup; token?: string }) {
  const { steps, snippets, links } = setup
  // What no step uses is another way to do the same.
  const others = snippets.filter(
    (candidate) => !steps.some((step) => step.snippet === candidate.id)
  )
  const numbered = steps.length > 1
  return (
    <>
      <ol className="space-y-4">
        {steps.map((step, index) => {
          const snippet = snippets.find(({ id }) => id === step.snippet)
          const link = links.find(({ id }) => id === step.link)
          return (
            <li key={step.text} className="flex gap-3">
              {numbered && (
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted/30 text-xs font-medium text-muted-foreground"
                >
                  {index + 1}
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-pretty text-sm leading-6">
                  <Prose text={step.text} />
                </p>
                {snippet && (
                  <Snippet
                    snippet={snippet}
                    name={
                      snippet.language !== 'shell'
                        ? snippet.title
                        : numbered
                          ? `the command for step ${index + 1}`
                          : 'the command'
                    }
                  />
                )}
                {link && <InstallLink link={link} />}
              </div>
            </li>
          )
        })}
      </ol>
      {(others.length > 0 || token) && (
        <Collapsible className="rounded-xl border bg-muted/30">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Other ways to set it up
            <ChevronDown
              className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 px-4 pb-4">
            {others.map((other) => (
              <Snippet
                key={other.id}
                snippet={other}
                name={other.title}
                titled
              />
            ))}
            {token && (
              <Snippet
                snippet={{
                  id: 'token',
                  title: 'The token on its own',
                  language: 'text',
                  code: token,
                }}
                name="the token"
                titled
              />
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  )
}
