'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Check,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  Share2,
  UserPlus,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { RoleBadges } from '@/components/roles/role-badges'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  INVITE_NOTE_MAX,
  type InvitePolicyView,
  type InviteStatus,
  type InviteView,
  describeUses,
  expiryOptionsFor,
  inviteUrl,
  usesOptionsFor,
} from '@/lib/invites/policy'
import type { RoleSummary } from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

type ListResponse = {
  invites: InviteView[]
  pagination: { total: number; pageCount: number; page: number; limit: number }
  policy: InvitePolicyView
}
type Scope = 'mine' | 'all'
type StatusFilter = 'active' | 'ended' | 'all'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(result.error || 'Invites are unavailable. Try again.')
  return result
}

const statusStyles: Record<InviteStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  paused: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  used: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
  revoked: 'bg-red-500/10 text-red-700 dark:text-red-400',
}
const statusLabels: Record<InviteStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  used: 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
}

function StatusPill({ status }: { status: InviteStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        statusStyles[status]
      )}
    >
      {statusLabels[status]}
    </span>
  )
}

function absolute(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function lifetime(invite: InviteView) {
  if (invite.revokedAt)
    return `Revoked ${formatDistanceToNow(new Date(invite.revokedAt), { addSuffix: true })}`
  if (!invite.expiresAt) return 'Never expires'
  const expires = new Date(invite.expiresAt)
  return `${expires <= new Date() ? 'Expired' : 'Expires'} ${formatDistanceToNow(expires, { addSuffix: true })}`
}

function usage(invite: InviteView) {
  return invite.maxUses === null
    ? `${invite.uses} ${invite.uses === 1 ? 'person' : 'people'} joined · no use limit`
    : `${invite.uses} of ${invite.maxUses} ${invite.maxUses === 1 ? 'use' : 'uses'}`
}

/** Remounts per account and browser session so another account's invites never flash. */
export function InviteManager({ context }: { context: 'profile' | 'users' }) {
  const { data: session, status } = useSession()
  if (status !== 'authenticated' || !session?.user?.id) return null
  return (
    <InviteWorkspace
      key={JSON.stringify([session.user.id, session.user.sessionId])}
      userId={session.user.id}
      sessionId={session.user.sessionId}
      context={context}
    />
  )
}

function InviteWorkspace({
  userId,
  sessionId,
  context,
}: {
  userId: string
  sessionId?: string
  context: 'profile' | 'users'
}) {
  const { can } = usePermissions()
  const { toast } = useToast()
  const manageAll = context === 'users' && can('invites.manage')
  const [scope, setScope] = useState<Scope>(manageAll ? 'all' : 'mine')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<InviteView | null>(null)
  const [busy, setBusy] = useState(false)
  const lifecycle = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    return () => {
      controller.abort()
      if (lifecycle.current === controller) lifecycle.current = null
    }
  }, [])
  const list = useQuery({
    queryKey: ['invites', userId, sessionId, scope, status, page],
    queryFn: ({ signal }) =>
      request<ListResponse>(
        `/api/invites?scope=${scope}&status=${status}&page=${page}&limit=20`,
        { signal }
      ),
    staleTime: 0,
    gcTime: 0,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
  })
  const policy = list.data?.policy
  const limits = policy?.limits ?? null
  const atLimit = Boolean(
    limits && policy && policy.activeCount >= limits.activeInvites
  )

  async function revoke() {
    const controller = lifecycle.current
    if (!revoking || busy || !controller || controller.signal.aborted) return
    const active = () =>
      lifecycle.current === controller && !controller.signal.aborted
    setBusy(true)
    try {
      await request(`/api/invites/${encodeURIComponent(revoking.id)}`, {
        method: 'DELETE',
        signal: controller.signal,
      })
      if (!active()) return
      setRevoking(null)
      toast({
        title: 'Invite revoked',
        description: 'The link no longer works. Existing accounts are kept.',
      })
      await list.refetch()
    } catch (error) {
      if (!active()) return
      toast({
        title: 'Could not revoke the invite',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      if (active()) setBusy(false)
    }
  }

  async function copy(invite: InviteView) {
    if (!invite.token) return
    try {
      await navigator.clipboard.writeText(
        inviteUrl(window.location.origin, invite.token)
      )
      toast({ title: 'Invite link copied' })
    } catch {
      toast({
        title: 'Could not copy the link',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  const invites = list.data?.invites ?? []
  const pagination = list.data?.pagination
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            {context === 'profile' ? 'Invite people' : 'Invite links'}
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Anyone with an active link can create an account, even while
            registration is closed. Links stop working when they are used up,
            expire, or are revoked.
          </p>
        </div>
        {policy?.canCreate && (
          <Button
            className="shrink-0 self-start"
            onClick={() => setCreating(true)}
            disabled={atLimit}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Create invite
          </Button>
        )}
      </div>

      {limits && policy && (
        <p
          className="rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground"
          data-testid="invite-limits"
        >
          {atLimit
            ? `You have ${policy.activeCount} active ${policy.activeCount === 1 ? 'invite' : 'invites'}, the most you can have at once. Revoke one or wait for one to be used or expire.`
            : `You can have up to ${limits.activeInvites} active ${limits.activeInvites === 1 ? 'invite' : 'invites'} (${policy.activeCount} now).`}{' '}
          Each link works{' '}
          {limits.usesPerInvite === 1
            ? 'once'
            : `up to ${limits.usesPerInvite} times`}{' '}
          and expires within {limits.lifetimeDays}{' '}
          {limits.lifetimeDays === 1 ? 'day' : 'days'}.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {manageAll && (
          <div className="w-full space-y-1.5 sm:w-44">
            <Label htmlFor="invite-scope" className="text-xs">
              Created by
            </Label>
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as Scope)
                setPage(1)
              }}
            >
              <SelectTrigger id="invite-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone</SelectItem>
                <SelectItem value="mine">Me</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="w-full space-y-1.5 sm:w-44">
          <Label htmlFor="invite-status" className="text-xs">
            Show
          </Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as StatusFilter)
              setPage(1)
            }}
          >
            <SelectTrigger id="invite-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active invites</SelectItem>
              <SelectItem value="ended">Ended invites</SelectItem>
              <SelectItem value="all">All invites</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
          aria-label="Refresh invites"
        >
          <RefreshCw
            className={cn('mr-2 h-4 w-4', list.isFetching && 'animate-spin')}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      {list.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading invites…
        </p>
      )}
      {list.isError && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{list.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void list.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {list.isSuccess && invites.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Link2
            className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="font-medium">
            {status === 'ended' ? 'No ended invites' : 'No invites yet'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === 'ended'
              ? 'Used, expired, and revoked invites appear here.'
              : policy?.canCreate
                ? 'Create a link and send it to someone you want to join.'
                : 'Invites people create will appear here.'}
          </p>
        </div>
      )}
      {invites.length > 0 && (
        <ul className="space-y-3" aria-label="Invites">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">
                    {invite.note || 'Invite link'}
                  </span>
                  <StatusPill status={invite.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {usage(invite)} ·{' '}
                  <span
                    title={
                      invite.revokedAt
                        ? absolute(invite.revokedAt)
                        : invite.expiresAt
                          ? absolute(invite.expiresAt)
                          : undefined
                    }
                  >
                    {lifetime(invite)}
                  </span>
                </p>
                {invite.status === 'paused' && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Paused because its creator can no longer invite people or
                    grant its roles. It resumes if that access returns.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {scope === 'all' &&
                    `Created by ${invite.creator.id === userId ? 'you' : invite.creator.name || 'a deleted account'} · `}
                  <span title={absolute(invite.createdAt)}>
                    Created{' '}
                    {formatDistanceToNow(new Date(invite.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </p>
                {invite.roles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Grants</span>
                    <RoleBadges roles={invite.roles} />
                  </div>
                )}
                {invite.memberCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Joined:{' '}
                    {invite.members
                      .map((member) => member.name || 'Unnamed account')
                      .join(', ')}
                    {invite.memberCount > invite.members.length &&
                      ` and ${invite.memberCount - invite.members.length} more`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 self-start">
                {invite.token && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(invite)}
                    aria-label={`Copy link for ${invite.note || 'invite'}`}
                  >
                    <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                    Copy link
                  </Button>
                )}
                {invite.canRevoke && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevoking(invite)}
                    disabled={busy}
                    aria-label={`Revoke ${invite.note || 'invite'}`}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pagination && pagination.pageCount > 1 && (
        <nav
          aria-label="Invite pages"
          className="flex items-center justify-between gap-3 text-sm"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page <= 1 || list.isFetching}
            onClick={() => setPage(pagination.page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {pagination.page} of {pagination.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={
              pagination.page >= pagination.pageCount || list.isFetching
            }
            onClick={() => setPage(pagination.page + 1)}
          >
            Next
          </Button>
        </nav>
      )}

      {policy?.canCreate && (
        <CreateInviteDialog
          open={creating}
          onOpenChange={setCreating}
          policy={policy}
          userId={userId}
          sessionId={sessionId}
          onCreated={() => {
            setStatus('active')
            setPage(1)
            void list.refetch()
          }}
        />
      )}

      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && !busy && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.note ? `“${revoking.note}” ` : 'This link '}
              stops working immediately. Accounts that already joined with it
              are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? 'Revoking…' : 'Revoke invite'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateInviteDialog({
  open,
  onOpenChange,
  policy,
  userId,
  sessionId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy: InvitePolicyView
  userId: string
  sessionId?: string
  onCreated: () => void
}) {
  const { user } = usePermissions()
  const { brand } = useAppearance()
  const expiryOptions = expiryOptionsFor(policy.limits)
  const usesOptions = usesOptionsFor(policy.limits)
  const defaultExpiry =
    [...expiryOptions]
      .reverse()
      .find((option) => option.hours !== null && option.hours <= 168)?.hours ??
    expiryOptions[0].hours
  const [note, setNote] = useState('')
  const [uses, setUses] = useState(String(usesOptions[0]))
  const [expiry, setExpiry] = useState(String(defaultExpiry))
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<InviteView | null>(null)
  const [copied, setCopied] = useState(false)
  const roles = useQuery({
    queryKey: ['invite-roles', userId, sessionId],
    queryFn: ({ signal }) =>
      request<{ roles: RoleSummary[] }>('/api/roles', { signal }),
    enabled: open && policy.canGrantRoles,
    staleTime: 0,
    gcTime: 0,
  })
  const administrator = user?.permissions?.includes('administrator')
  const highest = Math.max(
    0,
    ...(user?.roles ?? []).map((role) => role.position)
  )
  const grantable = (roles.data?.roles ?? []).filter(
    (role) =>
      role.systemKey !== 'everyone' &&
      (administrator ||
        (role.position < highest &&
          !role.permissions.includes('administrator') &&
          role.permissions.every((permission) =>
            (user?.permissions as readonly string[] | undefined)?.includes(
              permission
            )
          )))
  )
  const grantsAdministrator = grantable.some(
    (role) =>
      roleIds.includes(role.id) && role.permissions.includes('administrator')
  )
  const link = created?.token
    ? inviteUrl(window.location.origin, created.token)
    : ''

  function reset() {
    setNote('')
    setUses(String(usesOptions[0]))
    setExpiry(String(defaultExpiry))
    setRoleIds([])
    setError('')
    setCreated(null)
    setCopied(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await request<{ invite: InviteView }>('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note,
          maxUses: uses === 'unlimited' ? null : Number(uses),
          expiresInHours: expiry === 'never' ? null : Number(expiry),
          roleIds,
        }),
      })
      setCreated(result.invite)
      onCreated()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not create the invite.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('Your browser blocked clipboard access. Select and copy it.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Your invite link is ready</DialogTitle>
              <DialogDescription>
                Send it to the person you want to invite. You can copy it again
                from your invite list while it is active.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label htmlFor="created-invite-link">Invite link</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="created-invite-link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button onClick={() => void copyLink()} className="shrink-0">
                  {copied ? (
                    <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {describeUses(created.maxUses)} ·{' '}
                {created.expiresAt
                  ? `Expires ${absolute(created.expiresAt)}`
                  : 'Never expires'}
                {created.roles.length > 0 &&
                  ` · Grants ${created.roles.map((role) => role.name).join(', ')}`}
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              {typeof navigator !== 'undefined' &&
                typeof navigator.share === 'function' && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator
                        .share({ title: `Join ${brand.name}`, url: link })
                        .catch(() => {})
                    }
                  >
                    <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Share…
                  </Button>
                )}
              <Button
                onClick={() => {
                  onOpenChange(false)
                  reset()
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create an invite link</DialogTitle>
              <DialogDescription>
                The link lets someone create an account on this instance, even
                while registration is closed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="invite-note">Note (optional)</Label>
              <Input
                id="invite-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={INVITE_NOTE_MAX}
                placeholder="Who is this for?"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Only you and invite managers see this note.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite-uses">Uses</Label>
                <Select value={uses} onValueChange={setUses}>
                  <SelectTrigger id="invite-uses">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usesOptions.map((option) => (
                      <SelectItem
                        key={String(option)}
                        value={option === null ? 'unlimited' : String(option)}
                      >
                        {option === null
                          ? 'No limit'
                          : option === 1
                            ? '1 person'
                            : `${option} people`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-expiry">Expires after</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="invite-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryOptions.map((option) => (
                      <SelectItem
                        key={String(option.hours)}
                        value={
                          option.hours === null ? 'never' : String(option.hours)
                        }
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {policy.canGrantRoles && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Roles for new accounts
                </legend>
                <p className="text-xs text-muted-foreground">
                  Everyone applies automatically. Add roles only for people who
                  need more access.
                </p>
                {roles.isPending && (
                  <p className="text-sm text-muted-foreground">
                    Loading roles…
                  </p>
                )}
                {roles.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {roles.error.message}
                  </p>
                )}
                {roles.isSuccess && grantable.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No additional roles you can grant.
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {grantable.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="accent-[hsl(var(--primary))]"
                        checked={roleIds.includes(role.id)}
                        onChange={(event) =>
                          setRoleIds(
                            event.target.checked
                              ? [...roleIds, role.id]
                              : roleIds.filter((id) => id !== role.id)
                          )
                        }
                      />
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: role.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{role.name}</span>
                    </label>
                  ))}
                </div>
                {grantsAdministrator && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
                  >
                    Anyone who uses this link becomes a full administrator of
                    this instance. Prefer a single-use link with a short expiry.
                  </p>
                )}
              </fieldset>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false)
                  reset()
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create invite link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
