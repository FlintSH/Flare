'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

import Link from 'next/link'

import {
  ArrowUpRight,
  Camera,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Send,
  Webhook,
} from 'lucide-react'

import { PermissionGate } from '@/components/roles/permission-gate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { usePermissions } from '@/hooks/use-permissions'

type Token = {
  id: string
  name: string
  scopes: string[]
  profileId: string | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
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
}
const scopes = [
  ['files:upload', 'Upload files', 'Send screenshots and files'],
  ['files:read', 'Read files', 'List your files and metadata'],
  ['urls:read', 'Read short links', 'List your shortened URLs'],
  ['urls:write', 'Manage short links', 'Create and delete your short links'],
] as const
const panel =
  'min-w-0 rounded-xl border bg-card text-card-foreground p-5 shadow-sm sm:p-6'
const selectStyle =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

export function IntegrationsPanel({
  embedded = false,
  onSetupTool,
}: {
  embedded?: boolean
  onSetupTool?: () => void
}) {
  const { can } = usePermissions()
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<'token' | 'webhook' | null>(null)
  const [secret, setSecret] = useState<{ value: string; kind: string } | null>(
    null
  )
  const [copied, setCopied] = useState(false)
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not load integrations.')
      setData(result)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not load integrations.'
      )
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  async function run(command: Record<string, unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not save integration.')
      if (result.secret) {
        setSecret({ value: result.secret, kind: result.secretKind })
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

  return (
    <div
      className={
        embedded
          ? 'min-w-0 space-y-6'
          : 'container mx-auto max-w-6xl space-y-6 pb-10'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!embedded && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
                Your workflow, connected
              </p>
              <h1 className="text-3xl font-bold tracking-tight">
                Integrations
              </h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">
                Connect your favorite tools to Flare. Give each connection the
                access it needs and keep uploads moving your way.
              </p>
            </>
          )}
          {embedded && (
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              Manage custom app access and webhook delivery history.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <PermissionGate permission="files.upload">
        <PermissionGate permission="tokens.manage">
          <section className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-start gap-3">
              <Camera className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-1.5">
                <h2 className="font-semibold">Setting up a screenshot tool?</h2>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                  ShareX, iTake, Flameshot, Spectacle, and Bash have
                  ready-to-use downloads with your upload token included. No API
                  key setup needed.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link
                href="/dashboard/profile?section=uploads#upload-tools"
                onNavigate={onSetupTool}
              >
                Set up a tool
                <ArrowUpRight />
              </Link>
            </Button>
          </section>
        </PermissionGate>
      </PermissionGate>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {secret && (
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5 space-y-3">
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
          <section className={panel}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold">API tokens</h2>
              </div>
              <Button
                size="sm"
                onClick={() => setForm(form === 'token' ? null : 'token')}
              >
                <Plus />
                New token
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Optional keys for custom apps and scripts that need specific
              permissions, an expiration date, or separate revocation.
            </p>
            {form === 'token' && (
              <form
                onSubmit={createToken}
                className="mt-5 space-y-4 rounded-xl border bg-background/70 p-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="token-name">Connection name</Label>
                  <Input
                    id="token-name"
                    name="name"
                    placeholder="My automation script"
                    required
                    maxLength={80}
                  />
                </div>
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">
                    Allowed actions
                  </legend>
                  {scopes
                    .filter(
                      ([scope]) =>
                        ({
                          'files:upload': can('files.upload'),
                          'files:read': can('files.read'),
                          'urls:read': can('links.read'),
                          'urls:write':
                            can('links.create') || can('links.delete'),
                        })[scope]
                    )
                    .map(([value, label, description]) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 accent-[hsl(var(--primary))]"
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
                  <select
                    id="token-profile"
                    name="profileId"
                    className={selectStyle}
                    disabled={!selectedScopes.includes('files:upload')}
                  >
                    <option value="">No profile binding</option>
                    {data?.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Bind an uploader to a profile to keep its upload defaults
                    consistent.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="token-expiry">Expires after</Label>
                  <select
                    id="token-expiry"
                    name="days"
                    className={selectStyle}
                    defaultValue="90"
                  >
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="0">Never</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy || !selectedScopes.length}
                  >
                    Create token
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            <div className="mt-5 divide-y">
              {data?.tokens.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No API tokens yet. Built-in tool downloads work without one.
                </p>
              )}
              {data?.tokens.map((token) => (
                <div key={token.id} className="py-4 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{token.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {token.revokedAt
                          ? 'Revoked'
                          : token.expiresAt &&
                              new Date(token.expiresAt) <= new Date()
                            ? 'Expired'
                            : token.lastUsedAt
                              ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                              : 'Not used yet'}
                        {!token.revokedAt &&
                          token.expiresAt &&
                          ` · Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    {!token.revokedAt && (
                      <Button
                        variant="outline"
                        size="sm"
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {token.scopes
                      .filter(
                        ([scope]) =>
                          ({
                            'files:upload': can('files.upload'),
                            'files:read': can('files.read'),
                            'urls:read': can('links.read'),
                            'urls:write':
                              can('links.create') || can('links.delete'),
                          })[scope]
                      )
                      .map((scope) => (
                        <span
                          key={scope}
                          className="rounded-md bg-muted px-2 py-1 text-xs"
                        >
                          {scopes.find(([value]) => value === scope)?.[1] ||
                            scope}
                        </span>
                      ))}
                    {token.profileId && (
                      <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                        {data.profiles.find(
                          (profile) => profile.id === token.profileId
                        )?.name || 'Bound profile unavailable'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </PermissionGate>
        <PermissionGate permission="webhooks.manage">
          <section className={panel}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <Webhook className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold">Webhooks</h2>
              </div>
              <Button
                size="sm"
                onClick={() => setForm(form === 'webhook' ? null : 'webhook')}
              >
                <Plus />
                Add webhook
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Tell your other tools when a file is ready. Connect automations,
              notifications, and your own services.
            </p>
            {form === 'webhook' && (
              <form
                onSubmit={createHook}
                className="mt-5 space-y-4 rounded-xl border bg-background/70 p-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="webhook-name">Connection name</Label>
                  <Input
                    id="webhook-name"
                    name="name"
                    placeholder="My automation server"
                    required
                    maxLength={80}
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
                    maxLength={2048}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your receiver gets signed file metadata when your uploads
                    finish. File contents and passwords are never included.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>
                    Connect webhook
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            <div className="mt-5 space-y-3">
              {data?.webhooks.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Connect a receiver to start automating your uploads.
                </p>
              )}
              {data?.webhooks.map((hook) => (
                <div key={hook.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{hook.name}</h3>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${hook.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                    >
                      {hook.enabled ? 'Enabled' : 'Paused'}
                    </span>
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
                      variant="ghost"
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
                      variant="ghost"
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
          </section>
        </PermissionGate>
      </div>
      <PermissionGate permission="webhooks.manage">
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Delivery history</h2>
            <p className="text-xs text-muted-foreground">
              Latest 50 deliveries · History kept for 30 days
            </p>
          </div>
          {!data && (
            <p className="py-6 text-sm text-muted-foreground">
              Loading your connections…
            </p>
          )}
          {data?.deliveries.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Send a test or upload a file to see deliveries here.
            </p>
          )}
          {!!data?.deliveries.length && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-medium">Connection / event</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Attempts</th>
                    <th className="pb-3 font-medium">Created</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium">
                          {data.webhooks.find(
                            (hook) => hook.id === delivery.webhookId
                          )?.name || 'Webhook'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {delivery.eventId.startsWith('test:')
                            ? 'Test event'
                            : 'File ready'}
                        </p>
                        {delivery.lastError && (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                            {delivery.lastError}
                          </p>
                        )}
                      </td>
                      <td className="pr-4">
                        <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">
                          {delivery.status}
                        </span>
                      </td>
                      <td className="pr-4">{delivery.attempts} / 5</td>
                      <td className="pr-4 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(delivery.createdAt).toLocaleString()}
                      </td>
                      <td>
                        {delivery.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="outline"
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
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PermissionGate>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm">
        <p className="text-muted-foreground">
          Pair your connection with an upload profile to make every upload feel
          automatic.
        </p>
        <Link
          href="/dashboard/profile?section=uploads"
          className="inline-flex items-center gap-1 font-medium text-primary"
        >
          Explore workflows
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
