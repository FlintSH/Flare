'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  AlertCircle,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import {
  colorSwatchClassName,
  destructiveActionClassName,
  numberFieldClassName,
} from '@/components/settings/form-styles'
import { SaveBar } from '@/components/settings/save-bar'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { apiRequest } from '@/lib/client/request'
import { PERMISSION_GROUPS, hasPermission } from '@/lib/permissions/catalog'
import {
  type Access,
  ROLE_DEFAULTS,
  ROLE_LIMITS,
  canGrantPermissions,
  canManageRole,
  highestRolePosition,
  isEveryoneRole,
  roleCanHold,
} from '@/lib/permissions/policy'
import { cn } from '@/lib/utils'

import { type ListedRole as Role, readRoles } from '@/hooks/use-roles'
import { useToast } from '@/hooks/use-toast'

type Draft = {
  name: string
  description: string
  color: string
  position: number
  permissions: string[]
}
const blank: Draft = { name: '', ...ROLE_DEFAULTS, permissions: [] }

/**
 * Whether the actor may edit the role in the editor. A new role is judged as
 * it starts, not by its unsaved draft, so a position typed out of reach
 * can't lock the field that corrects it.
 */
export function canEditRole(
  actor: Access | null | undefined,
  selected: Role | undefined
) {
  return canManageRole(actor, selected ?? blank)
}

/**
 * The highest position the actor may give a role: one below their own
 * highest role, unless they're an administrator.
 */
export function maxRolePosition(actor: Access | null | undefined) {
  return hasPermission(actor, 'administrator')
    ? ROLE_LIMITS.position.max
    : Math.max(ROLE_LIMITS.position.min, highestRolePosition(actor) - 1)
}

/** Why a role can't be saved at this position, or null when it can. */
export function rolePositionProblem(
  actor: Access | null | undefined,
  position: number
) {
  const { min } = ROLE_LIMITS.position
  const max = maxRolePosition(actor)
  if (Number.isInteger(position) && position >= min && position <= max)
    return null
  return hasPermission(actor, 'administrator')
    ? `Use a whole number from ${min} to ${max.toLocaleString()}.`
    : `Use a whole number from ${min} to ${max.toLocaleString()}, below your highest role.`
}

export function RoleManager() {
  const { data: session, update } = useSession()
  const actor = session?.user
  const router = useRouter()
  const { toast } = useToast()
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [savedDraft, setSavedDraft] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<Role | 'new' | null>(
    null
  )
  const editorRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Set when someone picks a role or starts a new one, so the editor can be
  // brought into view once it has rendered.
  const reveal = useRef<'role' | 'new' | null>(null)
  // Set when "Discard changes" starts a new role: the dialog would otherwise
  // hand focus back to the button that opened it as it closes.
  const focusNameOnClose = useRef(false)
  const selected = roles.find((role) => role.id === selectedId)
  const isEveryone = isEveryoneRole(selected)
  const editable = canEditRole(actor, selected)
  const canToggle = (permission: string) =>
    roleCanHold(selected, permission) &&
    canGrantPermissions(actor, [permission])
  const dirty = draft !== null && JSON.stringify(draft) !== savedDraft
  const positionProblem =
    draft && editable && !isEveryone
      ? rolePositionProblem(actor, draft.position)
      : null

  const select = useCallback((role: Role | 'new') => {
    const next =
      role === 'new'
        ? { ...blank }
        : {
            name: role.name,
            description: role.description,
            color: role.color,
            position: role.position,
            permissions: [...role.permissions],
          }
    setSelectedId(role === 'new' ? null : role.id)
    setDraft(next)
    setSavedDraft(JSON.stringify(next))
    setError('')
    setQuery('')
  }, [])
  const load = useCallback(async () => {
    const { roles } = await readRoles()
    setRoles(roles)
    return roles
  }, [])
  useEffect(() => {
    let cancelled = false
    load()
      .then((loaded) => {
        if (!cancelled && loaded[0]) select(loaded[0])
      })
      .catch((error) => {
        if (!cancelled) setError(error.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load, select])

  function open(role: Role | 'new') {
    select(role)
    reveal.current = role === 'new' ? 'new' : 'role'
  }
  function requestSelection(role: Role | 'new') {
    if (dirty) setPendingSelection(role)
    else open(role)
  }
  useEffect(() => {
    const target = reveal.current
    if (!target || !draft) return
    reveal.current = null
    // Below lg the editor sits under the role list, often off screen.
    const stacked = window.matchMedia('(max-width: 1023px)').matches
    if (stacked)
      editorRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      })
    // Focus follows the scroll, so the next Tab continues in the editor.
    if (target === 'new') nameRef.current?.focus({ preventScroll: stacked })
    else if (stacked) headingRef.current?.focus({ preventScroll: true })
  }, [draft])
  function toggle(keys: string[], enabled: boolean) {
    setDraft(
      (current) =>
        current && {
          ...current,
          permissions: enabled
            ? [...new Set([...current.permissions, ...keys])]
            : current.permissions.filter((key) => !keys.includes(key)),
        }
    )
  }
  async function save() {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const body = isEveryone
        ? {
            description: draft.description,
            color: draft.color,
            permissions: draft.permissions,
          }
        : draft
      const result = await apiRequest<{ id?: string; role?: { id: string } }>(
        selectedId ? `/api/roles/${selectedId}` : '/api/roles',
        {
          method: selectedId ? 'PATCH' : 'POST',
          body,
          fallback: 'Could not save this role.',
        }
      )
      const loaded = await load()
      const saved =
        loaded.find(
          (role) => role.id === (selectedId || result.role?.id || result.id)
        ) || loaded.find((role) => role.name === draft.name)
      if (saved) select(saved)
      await update()
      router.refresh()
      toast({
        title: 'Role saved',
        description:
          'Permissions apply immediately, including existing sessions and integrations.',
      })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save this role.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/roles/${selected.id}`, {
        method: 'DELETE',
        fallback: 'Could not delete this role.',
      })
      const loaded = await load()
      if (loaded[0]) select(loaded[0])
      await update()
      router.refresh()
      toast({
        title: 'Role deleted',
        description:
          'Members retain permissions from their remaining roles and Everyone.',
      })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not delete this role.'
      )
    } finally {
      setBusy(false)
      setDeleting(false)
    }
  }

  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: group.permissions.filter((permission) =>
      `${group.label} ${permission.label} ${permission.description}`
        .toLowerCase()
        .includes(query.toLowerCase())
    ),
  })).filter((group) => group.permissions.length)

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <PageHeader
        eyebrow="Your community"
        title="Roles"
        description="Give people the access they need. Combine roles to build a workspace that works for everyone."
        actions={
          <Button
            onClick={() => requestSelection('new')}
            disabled={busy || !canManageRole(actor, blank)}
          >
            <Plus className="h-4 w-4" />
            Create role
          </Button>
        }
      />
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-12 text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading roles…
        </div>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-9">
          <aside className="min-w-0 space-y-5">
            <nav aria-label="Roles" className="space-y-1">
              {draft && !selectedId && (
                <div className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card px-3 py-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: draft.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {draft.name.trim() || 'New role'}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Not saved yet
                    </span>
                  </span>
                </div>
              )}
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => requestSelection(role)}
                  disabled={busy}
                  aria-current={selectedId === role.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    selectedId === role.id
                      ? 'border-border bg-card shadow-sm'
                      : 'border-transparent hover:bg-muted/40'
                  )}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {role.name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {isEveryoneRole(role)
                        ? 'Every account'
                        : `${role.memberCount} ${role.memberCount === 1 ? 'member' : 'members'}`}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </nav>
            {/* The same unboxed aside note as Settings and Profile. */}
            <div className="border-t border-border/60 px-3.5 pt-6 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mb-3 h-5 w-5" aria-hidden="true" />
              <p>
                Everyone is the baseline. Other roles add permissions; switching
                a permission off never removes access granted by another role.
              </p>
              <p className="mt-3">
                Higher positions can manage lower roles. Only administrators can
                grant access beyond their own permissions.
              </p>
            </div>
          </aside>
          <div className="min-w-0 space-y-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {draft && (
              <form
                id="role-editor"
                ref={editorRef}
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
                className="scroll-mt-24 space-y-5"
              >
                <section className={pagePanelClassName}>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <h2
                      ref={headingRef}
                      tabIndex={-1}
                      className="text-base font-semibold"
                    >
                      {selected ? selected.name : 'New role'}
                    </h2>
                    {selected && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {isEveryone
                          ? 'Applies to every account'
                          : `${selected.memberCount} ${selected.memberCount === 1 ? 'member' : 'members'}`}
                      </span>
                    )}
                  </div>
                  {!editable && (
                    <Alert variant="info" role="status" className="mb-5">
                      <Lock aria-hidden="true" />
                      <AlertDescription>
                        This role is at or above your highest role. You can
                        review its permissions; an administrator can change
                        them.
                      </AlertDescription>
                    </Alert>
                  )}
                  <fieldset
                    disabled={!editable || busy}
                    className="grid grid-cols-[minmax(0,1fr)_3.5rem] gap-x-3 gap-y-5 sm:grid-cols-[minmax(0,1fr)_110px] sm:gap-5"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="role-name">Role name</Label>
                      <Input
                        id="role-name"
                        ref={nameRef}
                        required
                        maxLength={ROLE_LIMITS.name}
                        disabled={isEveryone}
                        placeholder="For example, Moderator"
                        value={draft.name}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role-color">Color</Label>
                      <Input
                        id="role-color"
                        type="color"
                        className={cn(
                          'cursor-pointer p-1.5',
                          colorSwatchClassName
                        )}
                        value={draft.color}
                        onChange={(event) =>
                          setDraft({ ...draft, color: event.target.value })
                        }
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="role-description">
                        Description{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="role-description"
                        maxLength={ROLE_LIMITS.description}
                        placeholder="What is this role for?"
                        value={draft.description}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            description: event.target.value,
                          })
                        }
                      />
                    </div>
                    {!isEveryone && (
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="role-position">Position</Label>
                        <Input
                          id="role-position"
                          className={numberFieldClassName}
                          type="number"
                          inputMode="numeric"
                          min={ROLE_LIMITS.position.min}
                          max={maxRolePosition(actor)}
                          required
                          value={draft.position}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              position: Number(event.target.value),
                            })
                          }
                          aria-invalid={Boolean(positionProblem)}
                          aria-describedby="role-position-hint"
                        />
                        <p
                          id="role-position-hint"
                          className={cn(
                            'text-xs',
                            positionProblem
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          )}
                        >
                          {positionProblem ??
                            'Higher numbers rank above lower numbers. Roles at the same position cannot manage one another.'}
                        </p>
                      </div>
                    )}
                  </fieldset>
                </section>
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Permissions</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {draft.permissions.includes('administrator')
                          ? 'All permissions, including permissions added in the future.'
                          : `${draft.permissions.length} enabled in this role`}
                      </p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        aria-label="Search permissions"
                        className="pl-9"
                        placeholder="Find a permission…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </div>
                  </div>
                  {/* The shared note surface: a primary tint read as a
                      grey, disabled block in light themes. */}
                  {draft.permissions.includes('administrator') && (
                    <Alert variant="info" role="status">
                      <Shield aria-hidden="true" />
                      <AlertDescription>
                        <strong className="font-medium">
                          Administrator grants complete access.
                        </strong>{' '}
                        Individual switches below do not restrict this role.
                        Keep this permission for people you trust to manage the
                        whole instance.
                      </AlertDescription>
                    </Alert>
                  )}
                  {groups.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No permissions match your search.
                    </p>
                  )}
                  {groups.map((group) => {
                    const grantable = group.permissions
                      .map((permission) => permission.key)
                      .filter(canToggle)
                    const allEnabled =
                      grantable.length > 0 &&
                      grantable.every((key) => draft.permissions.includes(key))
                    return (
                      <section
                        key={group.id}
                        className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm backdrop-blur-xl"
                      >
                        <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-6 py-4">
                          <div>
                            <h3 className="text-base font-semibold">
                              {group.label}
                            </h3>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {group.description}
                            </p>
                          </div>
                          {editable &&
                            grantable.length > 1 &&
                            !draft.permissions.includes('administrator') && (
                              // Text ends on the switch column's edge.
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="-mr-3"
                                disabled={busy}
                                onClick={() => toggle(grantable, !allEnabled)}
                              >
                                {allEnabled ? 'Clear group' : 'Enable group'}
                              </Button>
                            )}
                        </header>
                        <div className="divide-y">
                          {group.permissions.map((permission) => {
                            const administratorOverride =
                              draft.permissions.includes('administrator') &&
                              permission.key !== 'administrator'
                            const disabled =
                              !editable ||
                              busy ||
                              administratorOverride ||
                              !canToggle(permission.key)
                            return (
                              <div
                                key={permission.key}
                                className="flex items-center justify-between gap-5 px-6 py-4"
                              >
                                <div>
                                  <Label
                                    htmlFor={`permission-${permission.key}`}
                                    className="text-sm"
                                  >
                                    {permission.label}
                                  </Label>
                                  <p
                                    id={`description-${permission.key}`}
                                    className="mt-1 text-xs leading-relaxed text-muted-foreground"
                                  >
                                    {permission.description}
                                  </p>
                                </div>
                                <Switch
                                  id={`permission-${permission.key}`}
                                  aria-describedby={`description-${permission.key}`}
                                  checked={
                                    administratorOverride ||
                                    draft.permissions.includes(permission.key)
                                  }
                                  disabled={disabled}
                                  onCheckedChange={(enabled) =>
                                    toggle([permission.key], enabled)
                                  }
                                />
                              </div>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </section>
                {/* Saving lives at the end of the editor column, in the
                    save bar every editor shares. It follows the screen only
                    while there is something to save, so it never hides the
                    form when nothing has changed. */}
                <SaveBar
                  sticky={dirty}
                  tone={!selected || dirty ? 'unsaved' : 'saved'}
                  title={
                    !selected
                      ? 'New role, not saved yet'
                      : dirty
                        ? 'Unsaved changes'
                        : 'All changes saved'
                  }
                >
                  {selected && !isEveryone && editable && (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive hover:bg-danger/10 hover:text-destructive"
                      disabled={busy}
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={busy || !editable || !dirty || !!positionProblem}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                    Save role
                  </Button>
                </SaveBar>
              </form>
            )}
          </div>
        </div>
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the role from {selected?.memberCount ?? 0}{' '}
              {selected?.memberCount === 1 ? 'member' : 'members'}. They keep
              permissions from Everyone and their other roles. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={destructiveActionClassName}
              onClick={(event) => {
                event.preventDefault()
                void remove()
              }}
            >
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null)
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (!focusNameOnClose.current) return
            focusNameOnClose.current = false
            event.preventDefault()
            nameRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to this role have not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                focusNameOnClose.current = pendingSelection === 'new'
                if (pendingSelection) open(pendingSelection)
                setPendingSelection(null)
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
