'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { createPortal } from 'react-dom'

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

import {
  PERMISSION_GROUPS,
  type RoleSummary,
  hasPermission,
} from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

type Role = RoleSummary & { memberCount: number }
type Draft = {
  name: string
  description: string
  color: string
  position: number
  permissions: string[]
}
const blank: Draft = {
  name: '',
  description: '',
  color: '#64748b',
  position: 1,
  permissions: [],
}

export function RoleManager() {
  const { data: session, update } = useSession()
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
  const selected = roles.find((role) => role.id === selectedId)
  const isEveryone = selected?.systemKey === 'everyone'
  const isAdministrator = hasPermission(session?.user, 'administrator')
  const highest = Math.max(
    0,
    ...(session?.user?.roles ?? []).map((role) => role.position)
  )
  const editable =
    isAdministrator ||
    ((selected?.position ?? draft?.position ?? 1) < highest &&
      !selected?.permissions.includes('administrator'))
  const dirty = draft !== null && JSON.stringify(draft) !== savedDraft

  const select = useCallback((role: Role | 'new') => {
    const next =
      role === 'new'
        ? { ...blank, position: 1 }
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
    const response = await fetch('/api/roles', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not load roles.')
    setRoles(data.roles)
    return data.roles as Role[]
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

  function requestSelection(role: Role | 'new') {
    if (dirty) setPendingSelection(role)
    else select(role)
  }
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
      const response = await fetch(
        selectedId ? `/api/roles/${selectedId}` : '/api/roles',
        {
          method: selectedId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not save this role.')
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
      const response = await fetch(`/api/roles/${selected.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Could not delete this role.')
      }
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
    <div className="mx-auto max-w-7xl space-y-7 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-7">
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
            Your community
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Roles
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Give people the access they need. Combine roles to build a workspace
            that works for everyone.
          </p>
        </div>
        <Button
          onClick={() => requestSelection('new')}
          disabled={busy || (!isAdministrator && highest <= 1)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create role
        </Button>
      </header>
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
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => requestSelection(role)}
                  disabled={busy}
                  aria-current={selectedId === role.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                    selectedId === role.id
                      ? 'border-border bg-card shadow-sm'
                      : 'border-transparent hover:bg-muted/40'
                  )}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {role.name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {role.systemKey === 'everyone'
                        ? 'Every account'
                        : `${role.memberCount} ${role.memberCount === 1 ? 'member' : 'members'}`}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </nav>
            <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
              <Shield className="mb-2 h-5 w-5" />
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
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            {draft && (
              <form
                id="role-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
                className="space-y-5"
              >
                <section className="rounded-2xl border bg-card p-5 sm:p-6">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">
                      {selected ? selected.name : 'New role'}
                    </h2>
                    {selected && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-4 w-4" />
                        {isEveryone
                          ? 'Applies to every account'
                          : `${selected.memberCount} ${selected.memberCount === 1 ? 'member' : 'members'}`}
                      </span>
                    )}
                  </div>
                  {!editable && (
                    <p className="mb-5 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                      This role is at or above your highest role. You can review
                      its permissions; an administrator can change them.
                    </p>
                  )}
                  <fieldset
                    disabled={!editable || busy}
                    className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_110px]"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="role-name">Role name</Label>
                      <Input
                        id="role-name"
                        required
                        maxLength={50}
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
                        className="cursor-pointer p-1.5"
                        value={draft.color}
                        onChange={(event) =>
                          setDraft({ ...draft, color: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="role-description">
                        Description{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="role-description"
                        maxLength={300}
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
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="role-position">Position</Label>
                        <Input
                          id="role-position"
                          className="max-w-32"
                          type="number"
                          min={1}
                          max={
                            isAdministrator ? 1000000 : Math.max(1, highest - 1)
                          }
                          required
                          value={draft.position}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              position: Number(event.target.value),
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Higher numbers rank above lower numbers. Roles at the
                          same position cannot manage one another.
                        </p>
                      </div>
                    )}
                  </fieldset>
                </section>
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">Permissions</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {draft.permissions.includes('administrator')
                          ? 'All permissions, including permissions added in the future.'
                          : `${draft.permissions.length} enabled in this role`}
                      </p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        aria-label="Search permissions"
                        className="pl-9"
                        placeholder="Find a permission…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </div>
                  </div>
                  {draft.permissions.includes('administrator') && (
                    <div className="flex gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
                      <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <p>
                        <strong>Administrator grants complete access.</strong>{' '}
                        Individual switches below do not restrict this role.
                        Keep this permission for people you trust to manage the
                        whole instance.
                      </p>
                    </div>
                  )}
                  {groups.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No permissions match your search.
                    </p>
                  )}
                  {groups.map((group) => {
                    const grantable = group.permissions
                      .filter(
                        (permission) =>
                          (permission.key !== 'administrator' ||
                            (isAdministrator && !isEveryone)) &&
                          hasPermission(session?.user, permission.key)
                      )
                      .map((permission) => permission.key)
                    const allEnabled =
                      grantable.length > 0 &&
                      grantable.every((key) => draft.permissions.includes(key))
                    return (
                      <section
                        key={group.id}
                        className="overflow-hidden rounded-xl border bg-card"
                      >
                        <header className="flex items-center justify-between gap-3 border-b bg-muted/20 p-4 sm:px-5">
                          <div>
                            <h3 className="font-medium">{group.label}</h3>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {group.description}
                            </p>
                          </div>
                          {editable &&
                            grantable.length > 1 &&
                            !draft.permissions.includes('administrator') && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
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
                              !hasPermission(session?.user, permission.key) ||
                              (permission.key === 'administrator' &&
                                (!isAdministrator || isEveryone))
                            return (
                              <div
                                key={permission.key}
                                className="flex items-center justify-between gap-5 p-4 sm:px-5"
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
                {typeof document !== 'undefined' &&
                  createPortal(
                    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
                      <span className="text-xs text-muted-foreground">
                        {dirty
                          ? 'You have unsaved changes'
                          : 'All changes saved'}
                      </span>
                      <div className="flex items-center gap-2">
                        {selected && !isEveryone && editable && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive"
                            size="sm"
                            disabled={busy}
                            onClick={() => setDeleting(true)}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Delete
                          </Button>
                        )}
                        <Button
                          type="submit"
                          form="role-editor"
                          size="sm"
                          disabled={busy || !editable || !dirty}
                        >
                          {busy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="mr-2 h-4 w-4" />
                          )}
                          Save role
                        </Button>
                      </div>
                    </div>,
                    document.body
                  )}
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
              This removes the role from {selected?.memberCount ?? 0} members.
              They keep permissions from Everyone and their other roles. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
        <AlertDialogContent>
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
                if (pendingSelection) select(pendingSelection)
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
