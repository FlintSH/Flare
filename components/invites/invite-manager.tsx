'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'

import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  Check,
  Copy,
  InfoIcon,
  Link2,
  Plus,
  RefreshCw,
  Share2,
  TriangleAlert,
} from 'lucide-react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { MetaLine } from '@/components/profile/meta-line'
import { RoleBadges, RoleChecklist } from '@/components/roles/role-badges'
import {
  destructiveActionClassName,
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/settings/form-styles'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardDescription } from '@/components/ui/card'
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

import { apiRequest } from '@/lib/client/request'
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
import { canGrantRole } from '@/lib/permissions/policy'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { SessionScoped, useAccountQuery } from '@/hooks/use-account-query'
import { usePermissions } from '@/hooks/use-permissions'
import { useRoles } from '@/hooks/use-roles'
import { useToast } from '@/hooks/use-toast'

type ListResponse = {
  invites: InviteView[]
  pagination: { total: number; pageCount: number; page: number; limit: number }
  policy: InvitePolicyView
}
type Scope = 'mine' | 'all'
type StatusFilter = 'active' | 'ended' | 'all'

const INVITES_FAILED = 'Invites are unavailable. Try again.'

const statusVariants = {
  active: 'success',
  paused: 'warning',
  used: 'neutral',
  expired: 'neutral',
  revoked: 'danger',
} as const satisfies Record<InviteStatus, string>
const statusLabels: Record<InviteStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  used: 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
}

function StatusPill({ status }: { status: InviteStatus }) {
  return <Badge variant={statusVariants[status]}>{statusLabels[status]}</Badge>
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
    ? [
        `${invite.uses} ${invite.uses === 1 ? 'person' : 'people'} joined`,
        'no use limit',
      ]
    : [
        `${invite.uses} of ${invite.maxUses} ${invite.maxUses === 1 ? 'use' : 'uses'}`,
      ]
}

/** Remounts per account and browser session so another account's invites never flash. */
export function InviteManager({ context }: { context: 'profile' | 'users' }) {
  return (
    <SessionScoped>
      {({ userId }) => <InviteWorkspace userId={userId} context={context} />}
    </SessionScoped>
  )
}

function InviteWorkspace({
  userId,
  context,
}: {
  userId: string
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
  const list = useAccountQuery<ListResponse>(
    'invites',
    `/api/invites?scope=${scope}&status=${status}&page=${page}&limit=20`,
    {
      fallback: INVITES_FAILED,
      placeholderData: (previous) => previous,
      refetchOnWindowFocus: true,
    }
  )
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
      await apiRequest(`/api/invites/${encodeURIComponent(revoking.id)}`, {
        method: 'DELETE',
        signal: controller.signal,
        fallback: INVITES_FAILED,
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
      {/* The card header used on the other tabs: a plain title, the card
          description below it, actions at the top right (after the
          description on phones), and 24px to the content. */}
      <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h2 className="font-semibold leading-none tracking-tight">
            {context === 'profile' ? 'Invite people' : 'Invite links'}
          </h2>
          <CardDescription className="max-w-xl">
            Anyone with an active link can create an account, even while
            registration is closed. Links stop working when they are used up,
            expire, or are revoked.
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-start">
          {policy?.canCreate && (
            <Button onClick={() => setCreating(true)} disabled={atLimit}>
              <Plus aria-hidden="true" />
              Create invite
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void list.refetch()}
            disabled={list.isFetching}
            aria-label="Refresh invites"
          >
            <RefreshCw
              className={cn(list.isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {limits && policy && (
        <Alert
          variant={atLimit ? 'warning' : 'info'}
          role="status"
          data-testid="invite-limits"
        >
          {atLimit ? (
            <TriangleAlert aria-hidden="true" />
          ) : (
            <InfoIcon aria-hidden="true" />
          )}
          <AlertDescription>
            {atLimit
              ? `You have ${policy.activeCount} active ${policy.activeCount === 1 ? 'invite' : 'invites'}, the most you can have at once. Revoke one or wait for one to be used or expire.`
              : `You can have up to ${limits.activeInvites} active ${limits.activeInvites === 1 ? 'invite' : 'invites'} (${policy.activeCount} now).`}{' '}
            Each link works{' '}
            {limits.usesPerInvite === 1
              ? 'once'
              : `up to ${limits.usesPerInvite} times`}{' '}
            and expires within {limits.lifetimeDays}{' '}
            {limits.lifetimeDays === 1 ? 'day' : 'days'}.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {manageAll && (
          <div className="w-full space-y-2 sm:w-44">
            <Label htmlFor="invite-scope">Created by</Label>
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
        <div className="w-full space-y-2 sm:w-44">
          <Label htmlFor="invite-status">Show</Label>
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
      </div>

      {list.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading invites…
        </p>
      )}
      {list.isError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{list.error.message}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {list.isSuccess && invites.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Link2
            className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">
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
              className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {invite.note || 'Invite link'}
                  </span>
                  <StatusPill status={invite.status} />
                </div>
                <MetaLine
                  className="text-xs text-muted-foreground"
                  items={[
                    ...usage(invite).map((text, index) => ({
                      key: `usage-${index}`,
                      text,
                    })),
                    {
                      key: 'lifetime',
                      text: lifetime(invite),
                      title: invite.revokedAt
                        ? absolute(invite.revokedAt)
                        : invite.expiresAt
                          ? absolute(invite.expiresAt)
                          : undefined,
                    },
                  ]}
                />
                {invite.status === 'paused' && (
                  <p className="text-xs text-warning">
                    Paused because its creator can no longer invite people or
                    grant its roles. It resumes if that access returns.
                  </p>
                )}
                {/* A long creator name may wrap; "Created …" stays whole. */}
                <MetaLine
                  className="text-xs text-muted-foreground"
                  items={[
                    ...(scope === 'all'
                      ? [
                          {
                            key: 'creator',
                            text: `Created by ${invite.creator.id === userId ? 'you' : invite.creator.name || 'a deleted account'}`,
                            wrap: true,
                          },
                        ]
                      : []),
                    {
                      key: 'created',
                      text: `Created ${formatDistanceToNow(
                        new Date(invite.createdAt),
                        { addSuffix: true }
                      )}`,
                      title: absolute(invite.createdAt),
                    },
                  ]}
                />
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
                    <Copy aria-hidden="true" />
                    Copy link
                  </Button>
                )}
                {invite.canRevoke && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-danger/10 hover:text-destructive"
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
            <AlertDialogDescription className="break-words">
              {revoking?.note ? (
                <span className="font-medium text-foreground">
                  “{revoking.note}”
                </span>
              ) : (
                'This link'
              )}{' '}
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
              className={destructiveActionClassName}
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
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy: InvitePolicyView
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
  const roles = useRoles({ enabled: open && policy.canGrantRoles })
  const grantable = (roles.data?.roles ?? []).filter((role) =>
    canGrantRole(user, role)
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
      const result = await apiRequest<{ invite: InviteView }>('/api/invites', {
        body: {
          note,
          maxUses: uses === 'unlimited' ? null : Number(uses),
          expiresInHours: expiry === 'never' ? null : Number(expiry),
          roleIds,
        },
        fallback: INVITES_FAILED,
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
      {/* The form keeps its actions in view while the fields scroll; the
          short result view scrolls as a whole, like other dialogs. */}
      <DialogContent className={created ? undefined : formDialogClassName}>
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
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <MetaLine
                className="text-sm text-muted-foreground"
                items={[
                  { key: 'uses', text: describeUses(created.maxUses) },
                  {
                    key: 'expires',
                    text: created.expiresAt
                      ? `Expires ${absolute(created.expiresAt)}`
                      : 'Never expires',
                  },
                  ...(created.roles.length > 0
                    ? [
                        {
                          key: 'roles',
                          text: `Grants ${created.roles.map((role) => role.name).join(', ')}`,
                          wrap: true,
                        },
                      ]
                    : []),
                ]}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
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
                    <Share2 className="h-4 w-4" aria-hidden="true" />
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
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle>Create an invite link</DialogTitle>
              <DialogDescription>
                The link lets someone create an account on this instance, even
                while registration is closed.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              {/* Fields scroll between the title and the actions. */}
              <div ref={scrollFadeRef} className={formDialogBodyClassName}>
                <div className="space-y-2">
                  <Label htmlFor="invite-note">
                    Note{' '}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="invite-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={INVITE_NOTE_MAX}
                    placeholder="Who is this for?"
                    autoComplete="off"
                  />
                  <p className="text-pretty text-xs text-muted-foreground">
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
                            value={
                              option === null ? 'unlimited' : String(option)
                            }
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
                              option.hours === null
                                ? 'never'
                                : String(option.hours)
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
                    <p className="text-pretty text-xs text-muted-foreground">
                      Everyone applies automatically. Add roles only for people
                      who need more access.
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
                    <RoleChecklist
                      roles={grantable}
                      selected={roleIds}
                      onChange={setRoleIds}
                    />
                    {grantsAdministrator && (
                      <Alert variant="destructive">
                        <TriangleAlert aria-hidden="true" />
                        <AlertDescription>
                          Anyone who uses this link becomes a full administrator
                          of this instance. Prefer a single-use link with a
                          short expiry.
                        </AlertDescription>
                      </Alert>
                    )}
                  </fieldset>
                )}
              </div>
              {/* Outside the scrolling fields, so it shows wherever they're
                  scrolled to. */}
              {error && (
                <p
                  role="alert"
                  className="mt-4 shrink-0 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <DialogFooter className={formDialogFooterClassName}>
                <Button
                  type="button"
                  variant="outline"
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
