'use client'

import { type FormEvent, type ReactNode, useId, useState } from 'react'

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { AlertCircle, ChevronDown, ExternalLink, Info } from 'lucide-react'

import {
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/shared/form-styles'
import { SetupOption } from '@/components/shared/setup-option'
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
import { NativeSelect } from '@/components/ui/native-select'
import { RadioGroup } from '@/components/ui/radio-group'

import { apiRequest } from '@/lib/client/request'
import { MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import { CONNECTION_NAME_MAX_LENGTH } from '@/lib/integrations/limits'
import {
  AGENT_CLIENTS,
  AGENT_PRESETS,
  type AgentClientId,
  type AgentLink,
  type AgentSnippet,
  DEFAULT_AGENT_PRESET,
  type TokenClient,
  agentClient,
} from '@/lib/mcp/clients'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { usePermissions } from '@/hooks/use-permissions'

import { CopyButton } from './copy-button'
import { ScopePicker, offeredScopes } from './scope-picker'
import { DEFAULT_TOKEN_LIFETIME, TOKEN_LIFETIMES, tokenExpiry } from './shared'

const CREATE_FAILED = 'Could not create the token.'

/** A token named "Other" would say nothing in the token list. */
const tokenName = (client: { id: string; label: string }) =>
  client.id === 'other' ? 'Agent' : client.label

/** Brings the checkboxes Custom adds into view; on a phone they open below the fold. */
const reveal = (element: HTMLElement | null) =>
  element?.scrollIntoView({ block: 'nearest' })

/**
 * The presets this account can tell apart: each keeps only the scopes the
 * role can use, in the catalog's order, and one that adds nothing to the one
 * before it is left out.
 */
function offeredPresets(offered: readonly string[]) {
  const presets: {
    id: string
    label: string
    description: string
    scopes: string[]
  }[] = []
  for (const preset of AGENT_PRESETS) {
    const held: readonly string[] = preset.scopes
    const scopes = offered.filter((scope) => held.includes(scope))
    const last = presets.at(-1)
    if (scopes.length && scopes.length !== last?.scopes.length)
      presets.push({ ...preset, scopes })
  }
  return presets
}

/**
 * Connect an agent: pick the client, pick what it may do, then get that
 * client's steps with a new token filled in. The method area under the
 * client picker holds the token form today; browser sign-in takes that
 * place later, with this form behind "Use a token instead".
 *
 * `children` holds the `DialogTrigger` that opens it, so focus returns to
 * that button when the dialog closes.
 */
export function ConnectAgentDialog({
  url,
  onCreated,
  children,
}: {
  /** The MCP endpoint clients connect to. */
  url: string
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
  busy,
  onBusyChange,
  onCreated,
  onClose,
}: {
  url: string
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onCreated: () => void
  onClose: () => void
}) {
  const id = useId()
  const { can } = usePermissions()
  const [clientId, setClientId] = useState<AgentClientId>(AGENT_CLIENTS[0].id)
  const client = agentClient(clientId)
  const offered = offeredScopes(can, true).map(({ scope }) => scope)
  const presets = offeredPresets(offered)
  const [choice, setChoice] = useState<string>(DEFAULT_AGENT_PRESET)
  const [custom, setCustom] = useState<string[]>([])
  // The default preset may be one this role cannot tell from a smaller one.
  const preset =
    choice === 'custom'
      ? undefined
      : (presets.find((candidate) => candidate.id === choice) ?? presets[0])
  const scopes = preset ? preset.scopes : custom
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
    if (client.method !== 'token') return
    onBusyChange(true)
    setError('')
    try {
      const result = await apiRequest<{ secret?: string }>(
        '/api/integrations',
        {
          body: {
            action: 'create-token',
            name,
            scopes: [MCP_SCOPE, ...scopes],
            expiresAt: tokenExpiry(Number(lifetime)),
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
      <AgentSteps
        client={created.client}
        url={url}
        token={created.token}
        onClose={onClose}
      />
    )

  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>Connect an agent</DialogTitle>
        <DialogDescription>
          Flare creates a token for the agent and shows the steps for your
          client.
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
              {AGENT_CLIENTS.map((candidate) => (
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
          {client.method === 'sign-in' ? (
            <Alert variant="info" role="status">
              <Info aria-hidden="true" />
              <AlertDescription>{client.unavailable}</AlertDescription>
            </Alert>
          ) : (
            <>
              {offered.length > 0 ? (
                <fieldset disabled={busy}>
                  <legend
                    id={`${id}-actions`}
                    className="mb-2 text-sm font-medium"
                  >
                    Allowed actions
                  </legend>
                  <RadioGroup
                    value={preset?.id ?? 'custom'}
                    onValueChange={(value) => {
                      // Custom starts from what was chosen, not from nothing.
                      if (value === 'custom') setCustom(scopes)
                      setChoice(value)
                    }}
                    aria-labelledby={`${id}-actions`}
                    className="sm:grid-cols-2"
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
                  {!preset && (
                    <div ref={reveal} className="mt-3">
                      <ScopePicker
                        selected={custom}
                        onChange={setCustom}
                        can={can}
                        mcp
                        agent="always"
                      />
                    </div>
                  )}
                </fieldset>
              ) : (
                <p className="text-pretty text-sm text-muted-foreground">
                  Your role allows no file or short link actions, so the agent
                  will only see your account details.
                </p>
              )}
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
                  <NativeSelect
                    id={`${id}-lifetime`}
                    value={lifetime}
                    onChange={(event) => setLifetime(event.target.value)}
                    disabled={busy}
                  >
                    {TOKEN_LIFETIMES.map(([days, label]) => (
                      <option key={days} value={days}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter className={formDialogFooterClassName}>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            {client.method === 'token' ? 'Cancel' : 'Close'}
          </Button>
          {client.method === 'token' && (
            <Button
              type="submit"
              disabled={
                busy || !name.trim() || (!scopes.length && offered.length > 0)
              }
            >
              {busy ? 'Creating…' : 'Create token'}
            </Button>
          )}
        </DialogFooter>
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

/** A one-click install. The address holds the token, so it is never shown. */
function InstallLink({ link }: { link: AgentLink }) {
  return (
    <div className="space-y-1.5">
      <Button asChild>
        <a href={link.href} rel="noreferrer">
          <ExternalLink aria-hidden="true" />
          {link.label}
        </a>
      </Button>
      <p className="text-pretty text-xs text-muted-foreground">{link.note}</p>
    </div>
  )
}

/** The client's steps with the new token filled in. Shown once. */
function AgentSteps({
  client,
  url,
  token,
  onClose,
}: {
  client: TokenClient
  url: string
  token: string
  onClose: () => void
}) {
  const { steps, snippets, links } = client.setup(url, token)
  // What no step uses is another way to do the same.
  const others = snippets.filter(
    (candidate) => !steps.some((step) => step.snippet === candidate.id)
  )
  const numbered = steps.length > 1
  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>
          {client.id === 'other'
            ? 'Connect your client'
            : `Connect ${client.label}`}
        </DialogTitle>
        <DialogDescription>
          The token is shown only this once. Copy what you need before you close
          this.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollFadeRef} className={formDialogBodyClassName}>
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
            </CollapsibleContent>
          </Collapsible>
        </div>
        <DialogFooter className={formDialogFooterClassName}>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    </>
  )
}
