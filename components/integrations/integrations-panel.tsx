'use client'

import { FormEvent, type ReactNode, useState } from 'react'

import Link from 'next/link'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  Info,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
} from 'lucide-react'

import { PermissionGate } from '@/components/roles/permission-gate'
import { MetaLine } from '@/components/shared/meta-line'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { apiRequest } from '@/lib/client/request'
import {
  API_SCOPE_CATALOG,
  scopeUsable,
} from '@/lib/integrations/bearer-routes'
import {
  CONNECTION_NAME_MAX_LENGTH,
  WEBHOOK_URL_MAX_LENGTH,
} from '@/lib/integrations/limits'
import { allows } from '@/lib/permissions/actions'

import { useAccountQuery } from '@/hooks/use-account-query'
import { usePermissions } from '@/hooks/use-permissions'

type Token = {
  id: string
  name: string
  scopes: string[]
  profileId: string | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  /** Issued before end-to-end encryption: its uploads are plain files. */
  predatesEncryption: boolean
}
type Hook = { id: string; name: string; url: string; enabled: boolean }
type Delivery = {
  id: string
  eventId: string
  webhookId: string
  status: string
  attempts: number
  lastError: string | null
  createdAt: string
  availableAt: string
}
type Snapshot = {
  tokens: Token[]
  webhooks: Hook[]
  deliveries: Delivery[]
  profiles: { id: string; name: string }[]
  /** The upload token from before encryption still works. */
  legacyUploadToken?: boolean
}
// Card titles that are also headings, so each card is reachable by heading.
const cardTitle = 'font-semibold leading-none tracking-tight'
// One header layout for cards with actions, as on the other profile tabs:
// title and description on the left, actions at the top right. On phones the
// actions follow the description.
const cardHeaderRow =
  'flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between'
const deliveryTone = (status: string) =>
  status === 'failed'
    ? 'danger'
    : status === 'delivered'
      ? 'success'
      : 'neutral'
// Text links, underlined like the other links on the profile tabs.
const tipLinkClassName =
  'inline-flex items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * A pointer to another tab. Tips sit between the cards, so they take the
 * card surface and its 24px inner edges; the info icon and the text link
 * mark them as guidance rather than content. Both tips on this tab use it.
 */
function Tip({
  title,
  children,
  action,
}: {
  title?: string
  children: ReactNode
  action: ReactNode
}) {
  return (
    <Card className="flex gap-3 p-6 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-2 sm:flex-row sm:items-start sm:justify-between">
        {/* The lead line is in the text colour; a description under a
            title is muted, like a card description. */}
        <div className="min-w-0 space-y-1">
          {title && <h2 className="font-medium">{title}</h2>}
          <p
            className={
              title
                ? 'max-w-xl text-pretty text-muted-foreground'
                : 'text-pretty'
            }
          >
            {children}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </Card>
  )
}

export function IntegrationsPanel({
  embedded = false,
  active = true,
  onSetupTool,
}: {
  embedded?: boolean
  /** False while the panel's section is hidden; it then stops polling. */
  active?: boolean
  onSetupTool?: () => void
}) {
  const { can, user } = usePermissions()
  // Delivery statuses change on their own, so a visible panel polls.
  const snapshot = useAccountQuery<Snapshot>(
    'integrations',
    '/api/integrations',
    {
      enabled: active,
      refetchInterval: 5000,
      retry: false,
      fallback: 'Could not load integrations.',
    }
  )
  const data = snapshot.data
  const refresh = snapshot.refetch
  const [actionError, setError] = useState('')
  const error = actionError || snapshot.error?.message
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<'token' | 'webhook' | null>(null)
  const [secret, setSecret] = useState<{ value: string; kind: string } | null>(
    null
  )
  const [copied, setCopied] = useState(false)
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])

  async function run(command: Record<string, unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{
        secret?: string
        secretKind?: string
      }>('/api/integrations', {
        body: command,
        fallback: 'Could not save integration.',
        whole: true,
      })
      if (result.secret) {
        setSecret({ value: result.secret, kind: result.secretKind ?? '' })
        setCopied(false)
        setForm(null)
      }
      setNotice(message)
      await refresh()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save integration.'
      )
    } finally {
      setBusy(false)
    }
  }
  function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const days = Number(values.get('days'))
    void run(
      {
        action: 'create-token',
        name: values.get('name'),
        scopes: selectedScopes,
        profileId: values.get('profileId') || null,
        expiresAt: days
          ? new Date(Date.now() + days * 86_400_000).toISOString()
          : null,
      },
      'Token created.'
    )
  }
  function createHook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    void run(
      {
        action: 'create-webhook',
        name: values.get('name'),
        url: values.get('url'),
      },
      'Webhook connected. Copy the signing secret into your receiver.'
    )
  }

  const hookName = (delivery: Delivery) =>
    data?.webhooks.find((hook) => hook.id === delivery.webhookId)?.name ||
    'Webhook'
  const eventName = (delivery: Delivery) =>
    delivery.eventId.startsWith('test:') ? 'Test event' : 'File ready'
  const retryButton = (delivery: Delivery, className?: string) =>
    delivery.status === 'failed' && (
      <Button
        size="sm"
        variant="outline"
        className={className}
        disabled={busy}
        onClick={() =>
          void run(
            { action: 'retry-delivery', id: delivery.id },
            'Delivery queued for retry.'
          )
        }
      >
        Retry
      </Button>
    )

  return (
    <div
      className={
        embedded
          ? 'min-w-0 space-y-6'
          : 'container mx-auto max-w-6xl space-y-6 pb-10'
      }
    >
      {!embedded && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            Your workflow, connected
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Connect your favorite tools to Flare. Give each connection the
            access it needs and keep uploads moving your way.
          </p>
        </div>
      )}
      {allows(user, 'uploaderTools') && (
        <Tip
          title="Setting up a screenshot tool?"
          action={
            <Link
              href="/dashboard/profile?section=uploads#upload-tools"
              onNavigate={onSetupTool}
              className={tipLinkClassName}
            >
              Set up a tool
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        >
          ShareX, Flameshot, Spectacle, iTake, and Bash get a configuration with
          its own upload token. No API key to create here.
        </Tip>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {secret && (
        <div className="space-y-3 rounded-2xl border border-primary/40 bg-primary/10 p-6">
          <h2 className="font-semibold">
            Save your{' '}
            {secret.kind === 'token' ? 'API token' : 'webhook signing secret'}
          </h2>
          <p className="text-sm text-muted-foreground">
            This is the only time it will be shown. Copy it into your tool
            before closing this message.
          </p>
          <div className="flex flex-wrap gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-background p-3 text-sm">
              {secret.value}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret.value)
                  setCopied(true)
                } catch {
                  setError('Select and copy the secret above.')
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy secret'}
            </Button>
          </div>
          <Button variant="ghost" onClick={() => setSecret(null)}>
            I saved it
          </Button>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <PermissionGate permission="tokens.manage">
          <Card className="min-w-0">
            <CardHeader className={cardHeaderRow}>
              <div className="min-w-0 space-y-1.5">
                <h2 className={cardTitle}>API tokens</h2>
                <CardDescription>
                  Optional keys for custom apps and scripts that need specific
                  permissions, an expiration date, or separate revocation.
                </CardDescription>
              </div>
              {/* Peer card actions share the outline style. */}
              <Button
                variant="outline"
                className="shrink-0 self-start"
                onClick={() => setForm(form === 'token' ? null : 'token')}
              >
                <Plus />
                New token
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              {form === 'token' && (
                <form
                  onSubmit={createToken}
                  className="space-y-4 rounded-xl border bg-muted/30 p-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="token-name">Connection name</Label>
                    <Input
                      id="token-name"
                      name="name"
                      placeholder="My automation script"
                      required
                      maxLength={CONNECTION_NAME_MAX_LENGTH}
                    />
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">
                      Allowed actions
                    </legend>
                    {API_SCOPE_CATALOG.filter(({ scope }) =>
                      scopeUsable(scope, can)
                    ).map(({ scope: value, label, description }) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selectedScopes.includes(value)}
                          onChange={(event) =>
                            setSelectedScopes(
                              event.target.checked
                                ? [...selectedScopes, value]
                                : selectedScopes.filter(
                                    (scope) => scope !== value
                                  )
                            )
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            {label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="space-y-2">
                    <Label htmlFor="token-profile">Upload profile</Label>
                    <NativeSelect
                      id="token-profile"
                      name="profileId"
                      disabled={!selectedScopes.includes('files:upload')}
                    >
                      <option value="">No profile binding</option>
                      {data?.profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">
                      Bind an uploader to a profile to keep its upload defaults
                      consistent.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="token-expiry">Expires after</Label>
                    <NativeSelect
                      id="token-expiry"
                      name="days"
                      defaultValue="90"
                    >
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="365">1 year</option>
                      <option value="0">Never</option>
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setForm(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={busy || !selectedScopes.length}
                    >
                      Create token
                    </Button>
                  </div>
                </form>
              )}
              {data?.legacyUploadToken && (
                <p
                  className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-pretty text-xs leading-relaxed"
                  data-legacy-token-note
                >
                  Your upload token from before encryption still works, and
                  tools that use it upload plain files.{' '}
                  <Link
                    href="/dashboard/profile?section=uploads"
                    className="font-medium underline underline-offset-4"
                  >
                    Replace it under Screenshot tools
                  </Link>
                  .
                </p>
              )}
              {/* Each token is an inset, like each webhook beside it. */}
              <div className="space-y-3">
                {!data && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading tokens…
                  </p>
                )}
                {data?.tokens.length === 0 && (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No API tokens yet. A screenshot tool configuration creates
                    its own.
                  </p>
                )}
                {data?.tokens.map((token) => {
                  const tokenScopes = token.scopes.filter((scope) =>
                    scopeUsable(scope, can)
                  )
                  return (
                    <div
                      key={token.id}
                      className="rounded-xl border bg-muted/30 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-medium">
                            {token.name}
                          </h3>
                          <MetaLine
                            className="mt-1 text-xs text-muted-foreground"
                            items={[
                              {
                                key: 'use',
                                text: token.revokedAt
                                  ? 'Revoked'
                                  : token.expiresAt &&
                                      new Date(token.expiresAt) <= new Date()
                                    ? 'Expired'
                                    : token.lastUsedAt
                                      ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                                      : 'Not used yet',
                              },
                              ...(!token.revokedAt && token.expiresAt
                                ? [
                                    {
                                      key: 'expires',
                                      text: `Expires ${new Date(token.expiresAt).toLocaleDateString()}`,
                                    },
                                  ]
                                : []),
                              // A token from before encryption belongs to a
                              // tool that cannot encrypt (spec, section 14.4).
                              ...(!token.revokedAt &&
                              token.predatesEncryption &&
                              token.scopes.includes('files:upload')
                                ? [
                                    {
                                      key: 'plain',
                                      text: 'From before encryption: uploads plain files only',
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                        {!token.revokedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-destructive hover:bg-danger/10 hover:text-destructive"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                { action: 'revoke-token', id: token.id },
                                'Token revoked.'
                              )
                            }
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                      {(tokenScopes.length > 0 || token.profileId) && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {tokenScopes.map((scope) => (
                            <Badge key={scope}>
                              {API_SCOPE_CATALOG.find(
                                (entry) => entry.scope === scope
                              )?.label || scope}
                            </Badge>
                          ))}
                          {/* The bound profile is a different kind of chip
                              from the permissions: outlined, with an icon. */}
                          {token.profileId && (
                            <Badge variant="outline">
                              <SlidersHorizontal aria-hidden="true" />
                              <span className="sr-only">Upload profile: </span>
                              {data.profiles.find(
                                (profile) => profile.id === token.profileId
                              )?.name || 'Bound profile unavailable'}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </PermissionGate>
        <PermissionGate permission="webhooks.manage">
          <Card className="min-w-0">
            <CardHeader className={cardHeaderRow}>
              <div className="min-w-0 space-y-1.5">
                <h2 className={cardTitle}>Webhooks</h2>
                <CardDescription>
                  Tell your other tools when a file is ready. Connect
                  automations, notifications, and your own services.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                className="shrink-0 self-start"
                onClick={() => setForm(form === 'webhook' ? null : 'webhook')}
              >
                <Plus />
                Add webhook
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              {form === 'webhook' && (
                <form
                  onSubmit={createHook}
                  className="space-y-4 rounded-xl border bg-muted/30 p-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="webhook-name">Connection name</Label>
                    <Input
                      id="webhook-name"
                      name="name"
                      placeholder="My automation server"
                      required
                      maxLength={CONNECTION_NAME_MAX_LENGTH}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">Receiver URL</Label>
                    <Input
                      id="webhook-url"
                      name="url"
                      type="url"
                      placeholder="https://automation.example.com/flare"
                      required
                      maxLength={WEBHOOK_URL_MAX_LENGTH}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your receiver gets signed file metadata when your uploads
                      finish. File contents and passwords are never included.
                    </p>
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setForm(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={busy}>
                      Connect webhook
                    </Button>
                  </div>
                </form>
              )}
              <div className="space-y-3">
                {!data && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading webhooks…
                  </p>
                )}
                {data?.webhooks.length === 0 && (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Connect a receiver to start automating your uploads.
                  </p>
                )}
                {data?.webhooks.map((hook) => (
                  <div
                    key={hook.id}
                    className="rounded-xl border bg-muted/30 p-4"
                  >
                    {/* Status follows the title on its line, like every
                        status badge on the profile tabs. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="min-w-0 break-words text-sm font-medium">
                        {hook.name}
                      </h3>
                      <Badge variant={hook.enabled ? 'success' : 'neutral'}>
                        {hook.enabled ? 'Enabled' : 'Paused'}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {hook.url}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !hook.enabled}
                        onClick={() =>
                          void run(
                            { action: 'test-webhook', id: hook.id },
                            'Test queued. Delivery status updates automatically.'
                          )
                        }
                      >
                        <Send />
                        Send test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            {
                              action: 'toggle-webhook',
                              id: hook.id,
                              enabled: !hook.enabled,
                            },
                            hook.enabled
                              ? 'Webhook paused. Pending deliveries cancelled.'
                              : 'Webhook enabled.'
                          )
                        }
                      >
                        {hook.enabled ? 'Pause' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-danger/10 hover:text-destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            { action: 'delete-webhook', id: hook.id },
                            'Webhook deleted.'
                          )
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </PermissionGate>
      </div>
      <PermissionGate permission="webhooks.manage">
        <Card className="min-w-0">
          <CardHeader className={cardHeaderRow}>
            <div className="min-w-0 space-y-1.5">
              <h2 className={cardTitle}>Delivery history</h2>
              <CardDescription>
                Your latest 50 deliveries. History is kept for 30 days.
              </CardDescription>
            </div>
            {/* Reloads tokens and webhooks too; the list also updates on its
                own every few seconds. */}
            <Button
              variant="outline"
              className="shrink-0 self-start"
              onClick={() => void refresh()}
              disabled={busy}
              aria-label="Refresh delivery history"
            >
              <RefreshCw />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {!data && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading deliveries…
              </p>
            )}
            {data?.deliveries.length === 0 && (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Send a test or upload a file to see deliveries here.
              </p>
            )}
            {!!data?.deliveries.length && (
              <>
                {/* Phones: one stacked entry per delivery, in the same
                    bordered list as the table. */}
                <ul
                  className="divide-y rounded-xl border sm:hidden"
                  aria-label="Deliveries"
                >
                  {data.deliveries.map((delivery) => (
                    <li key={delivery.id} className="p-4">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 break-words text-sm font-medium">
                          {hookName(delivery)}
                        </p>
                        <Badge
                          variant={deliveryTone(delivery.status)}
                          className="capitalize"
                        >
                          {delivery.status}
                        </Badge>
                      </div>
                      <MetaLine
                        className="mt-1 text-xs text-muted-foreground"
                        items={[
                          { key: 'event', text: eventName(delivery) },
                          {
                            key: 'attempts',
                            text: `${delivery.attempts} / 5 attempts`,
                          },
                        ]}
                      />
                      {delivery.lastError && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {delivery.lastError}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(delivery.createdAt).toLocaleString()}
                      </p>
                      {retryButton(delivery, 'mt-3')}
                    </li>
                  ))}
                </ul>
                {/* Drawn like the short links table: a bordered box with a
                    filled header row. */}
                <div className="hidden overflow-hidden rounded-xl border sm:block">
                  <Table aria-label="Deliveries">
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="pl-4">
                          Connection / event
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempts</TableHead>
                        {/* Dates end on their header, as in the short links
                            table. */}
                        <TableHead className="text-right">Created</TableHead>
                        <TableHead className="pr-3">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.deliveries.map((delivery) => (
                        <TableRow key={delivery.id}>
                          <TableCell className="py-3 pl-4">
                            <p className="font-medium">{hookName(delivery)}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {eventName(delivery)}
                            </p>
                            {delivery.lastError && (
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                {delivery.lastError}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={deliveryTone(delivery.status)}
                              className="capitalize"
                            >
                              {delivery.status}
                            </Badge>
                          </TableCell>
                          {/* Cells at the table's size, like the short links
                              table: numbers in the text colour, dates muted. */}
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {delivery.attempts} / 5
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                            {new Date(delivery.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="pr-3 text-right">
                            {retryButton(delivery)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </PermissionGate>
      {/* A tip, not an empty slot: dashed outlines mean empty or drop
          targets. */}
      <Tip
        action={
          <Link
            href="/dashboard/profile?section=uploads"
            className={tipLinkClassName}
          >
            Explore workflows
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        Pair your connection with an upload profile to make every upload feel
        automatic.
      </Tip>
    </div>
  )
}
