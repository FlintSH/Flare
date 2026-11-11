'use client'

import { useRef, useState } from 'react'

import {
  AlertCircle,
  ChevronDown,
  Download,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'

import { ProfileToolDownloads } from '@/components/profile/tools/profile-tools'
import { MetaLine } from '@/components/shared/meta-line'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { apiRequest } from '@/lib/client/request'
import {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_TAG_LIMIT,
  RECIPE_MAX_BYTES,
  type UploadProfileOptions,
  type UploadProfileView,
  uploadRecipeSchema,
} from '@/lib/uploads/schema'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useAccountRefresh } from '@/hooks/use-account-query'
import { useTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'

import { UPLOAD_PROFILES, useUploadProfiles } from './profile-picker'

// Profiles and recipes are insets inside their cards; both lists share it.
const listItemClassName =
  'w-full rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
// Drawn like SelectTrigger, so the tag picker lines up with the selects.
const tagTriggerClassName =
  'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-control bg-transparent px-3 py-2 text-left text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'

const controls: {
  key: Exclude<keyof UploadProfileOptions, 'tagIds'>
  label: string
  choices: [string, string][]
}[] = [
  {
    key: 'visibility',
    label: 'Visibility',
    choices: [
      ['PUBLIC', 'Public'],
      ['PRIVATE', 'Private (only me)'],
    ],
  },
  {
    key: 'expiration',
    label: 'Expiration',
    choices: [
      ['DISABLED', 'No expiration'],
      ['HOUR', 'After one hour'],
      ['DAY', 'After one day'],
      ['WEEK', 'After one week'],
      ['MONTH', 'After one month'],
    ],
  },
  {
    key: 'expiryAction',
    label: 'When it expires',
    choices: [
      ['DELETE', 'Delete file'],
      ['SET_PRIVATE', 'Make private'],
    ],
  },
  {
    key: 'randomizeFileUrls',
    label: 'File naming',
    choices: [
      ['false', 'Keep original name'],
      ['true', 'Random name'],
    ],
  },
  {
    key: 'shareStyle',
    label: 'Share page',
    choices: [
      ['minimal', 'Minimal'],
      ['framed', 'Framed'],
      ['delivery', 'Delivery'],
    ],
  },
]
// Descriptions stay short enough for one line in the narrow desktop column,
// so the three recipes keep one height.
const starters: {
  name: string
  description: string
  options: UploadProfileOptions
}[] = [
  {
    name: 'Public screenshots',
    description: 'Minimal share page and random filenames.',
    options: {
      visibility: 'PUBLIC',
      randomizeFileUrls: true,
      shareStyle: 'minimal',
    },
  },
  {
    name: 'Private work',
    description: 'Private files that expire after 24 hours.',
    options: {
      visibility: 'PRIVATE',
      expiration: 'DAY',
      expiryAction: 'DELETE',
      shareStyle: 'delivery',
    },
  },
  {
    name: 'Temporary clips',
    description: 'Public links that go private after an hour.',
    options: {
      visibility: 'PUBLIC',
      expiration: 'HOUR',
      expiryAction: 'SET_PRIVATE',
      shareStyle: 'framed',
    },
  },
]

/** Whether two option sets save the same choices (tag order aside). */
function sameOptions(a: UploadProfileOptions, b: UploadProfileOptions) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<
    keyof UploadProfileOptions
  >
  return [...keys].every((key) => {
    if (key === 'tagIds') {
      const left = a.tagIds ?? []
      const right = b.tagIds ?? []
      return (
        left.length === right.length && left.every((id) => right.includes(id))
      )
    }
    return a[key] === b[key]
  })
}

export function ProfileManager({ embedded = false }: { embedded?: boolean }) {
  const { data, error } = useUploadProfiles()
  const { toast } = useToast()
  const {
    tags,
    loading: tagsLoading,
    error: tagsError,
    reload: reloadTags,
  } = useTags()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<UploadProfileView | null>(null)
  const [name, setName] = useState('')
  const [options, setOptions] = useState<UploadProfileOptions>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const editorTrigger = useRef<HTMLElement | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const refresh = useAccountRefresh(UPLOAD_PROFILES)
  const choose = (profile: UploadProfileView | null) => {
    if (!editorOpen)
      editorTrigger.current = document.activeElement as HTMLElement
    setEditorOpen(true)
    setEditing(profile)
    setName(profile?.name || '')
    setOptions(profile?.options || {})
    setMessage('')
    setTagSearch('')
  }

  function request<T>(url: string, method: string, body?: unknown) {
    return apiRequest<T>(url, {
      method,
      body,
      fallback: 'Could not save your changes.',
    })
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      void refresh()
    } catch (failure) {
      setMessage(
        failure instanceof Error ? failure.message : 'Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    await perform(async () => {
      const profile = await request<UploadProfileView>(
        editing ? `/api/upload-profiles/${editing.id}` : '/api/upload-profiles',
        editing ? 'PUT' : 'POST',
        { name, options, ...(editing ? { revision: editing.updatedAt } : {}) }
      )
      choose(profile)
      toast({
        title: 'Upload profile saved',
        description: 'It is ready for your next upload.',
      })
    })
  }

  // Card headings sit one level below the section heading.
  const CardHeading = embedded ? 'h4' : 'h2'
  // Save waits for something to save: a name for a new profile, and a
  // change for a saved one.
  const unchanged =
    !!editing &&
    name.trim() === editing.name &&
    sameOptions(options, editing.options)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!embedded && (
            <p className="mb-2 text-sm font-medium text-primary">
              Your workflow
            </p>
          )}
          {embedded ? (
            <h3 className="font-semibold">Reusable upload profiles</h3>
          ) : (
            <h1 className="text-3xl font-bold tracking-tight">
              Upload profiles
            </h1>
          )}
          <p className="mt-1.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Save how you share. Use the same settings from your browser,
            screenshot tools and API.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => importInput.current?.click()}
          >
            <Upload />
            Import recipe
          </Button>
          <Button onClick={() => choose(null)}>
            <Plus />
            New profile
          </Button>
        </div>
      </div>
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import upload profile recipe"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void perform(async () => {
            if (file.size > RECIPE_MAX_BYTES)
              throw new Error(
                `Recipes must be smaller than ${RECIPE_MAX_BYTES / 1024} KB.`
              )
            const recipe = uploadRecipeSchema.parse(
              JSON.parse(await file.text())
            )
            choose(
              await request<UploadProfileView>(
                '/api/upload-profiles',
                'POST',
                recipe
              )
            )
            toast({
              title: 'Recipe imported',
              description: 'Review it before making it your default.',
            })
          })
        }}
      />
      {((message && !editorOpen) || error) && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{message || error}</AlertDescription>
        </Alert>
      )}
      {!data && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading upload profiles…
        </p>
      )}
      <div className="space-y-6">
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardHeading className="font-semibold leading-none tracking-tight">
                Your profiles
              </CardHeading>
              <span className="text-xs text-muted-foreground">
                {data?.profiles.length ?? 0} saved
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  onClick={() => choose(profile)}
                  aria-current={editing?.id === profile.id ? 'true' : undefined}
                  className={cn(
                    listItemClassName,
                    editing?.id === profile.id
                      ? 'border-primary bg-primary/5'
                      : 'bg-muted/30 hover:bg-muted/60'
                  )}
                >
                  <span className="flex items-center gap-2 break-words text-sm font-medium">
                    {profile.name}
                    {data.defaultProfileId === profile.id && (
                      <Star
                        className="h-3.5 w-3.5 shrink-0 fill-primary text-primary"
                        aria-label="Default profile"
                      />
                    )}
                  </span>
                  <MetaLine
                    className="mt-1 text-xs text-muted-foreground"
                    items={[
                      {
                        key: 'visibility',
                        text:
                          profile.options.visibility === 'PRIVATE'
                            ? 'Private'
                            : profile.options.visibility === 'PUBLIC'
                              ? 'Public'
                              : 'Inherited visibility',
                      },
                      {
                        key: 'choices',
                        text: `${Object.keys(profile.options).length} saved choices`,
                      },
                    ]}
                  />
                </button>
              ))}
              {data?.profiles.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Start with a recipe below, or create a profile with your own
                  defaults.
                </p>
              )}
              {data?.defaultProfileId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await request('/api/upload-profiles/default', 'PUT', {
                        profileId: null,
                      })
                    })
                  }
                >
                  Use account settings as default
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardHeading className="font-semibold leading-none tracking-tight">
                Start with a recipe
              </CardHeading>
            </CardHeader>
            <CardContent className="space-y-3">
              {starters.map((starter) => (
                <button
                  type="button"
                  key={starter.name}
                  className={cn(
                    listItemClassName,
                    'bg-muted/30 hover:bg-muted/60'
                  )}
                  onClick={() => {
                    editorTrigger.current =
                      document.activeElement as HTMLElement
                    setEditorOpen(true)
                    setEditing(null)
                    setName(starter.name)
                    setOptions(starter.options)
                    setMessage('')
                  }}
                >
                  <span className="block text-sm font-medium">
                    {starter.name}
                  </span>
                  <span className="mt-1 block text-balance text-xs text-muted-foreground">
                    {starter.description}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
        <Dialog
          open={editorOpen}
          onOpenChange={(open) => {
            if (!busy) {
              setEditorOpen(open)
              setMessage('')
            }
          }}
        >
          <DialogContent
            showCloseButton={!busy}
            className="max-w-2xl"
            onCloseAutoFocus={(event) => {
              if (editorTrigger.current?.isConnected) {
                event.preventDefault()
                editorTrigger.current.focus()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {editing ? 'Edit profile' : 'Create a profile'}
              </DialogTitle>
              <DialogDescription>
                “Inherit” follows your account or instance settings. Changes
                apply to future uploads.
              </DialogDescription>
            </DialogHeader>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Profile name</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My screenshots"
                  maxLength={PROFILE_NAME_MAX_LENGTH}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {controls.map((control) => (
                  <div key={control.key} className="space-y-2">
                    <Label htmlFor={`profile-${control.key}`}>
                      {control.label}
                    </Label>
                    <Select
                      value={
                        options[control.key] === undefined
                          ? 'inherit'
                          : String(options[control.key])
                      }
                      onValueChange={(value) =>
                        setOptions((current) => {
                          const next = { ...current }
                          if (value === 'inherit') delete next[control.key]
                          else
                            Object.assign(next, {
                              [control.key]:
                                control.key === 'randomizeFileUrls'
                                  ? value === 'true'
                                  : value,
                            })
                          return next
                        })
                      }
                    >
                      <SelectTrigger id={`profile-${control.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit</SelectItem>
                        {control.choices.map(([value, label]) => (
                          <SelectItem value={value} key={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="profile-tags">Tags</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        id="profile-tags"
                        className={tagTriggerClassName}
                      >
                        <span className="truncate">
                          {options.tagIds?.length
                            ? tags
                                .filter((tag) =>
                                  options.tagIds?.includes(tag.id)
                                )
                                .map((tag) => tag.name)
                                .join(', ') ||
                              `${options.tagIds.length} selected`
                            : 'No tags'}
                        </span>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 opacity-50"
                          aria-hidden="true"
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-2">
                      <Input
                        aria-label="Find a tag"
                        placeholder="Find a tag…"
                        value={tagSearch}
                        onChange={(event) => setTagSearch(event.target.value)}
                        className="mb-2"
                      />
                      <div
                        ref={scrollFadeRef}
                        className="scroll-fade max-h-52 overflow-y-auto"
                      >
                        {tagsLoading ? (
                          <p
                            className="p-2 text-sm text-muted-foreground"
                            role="status"
                          >
                            Loading tags…
                          </p>
                        ) : tagsError ? (
                          <div className="p-2 text-sm">
                            <p role="alert">Couldn’t load tags.</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void reloadTags()}
                            >
                              Try again
                            </Button>
                          </div>
                        ) : tags.length === 0 ? (
                          <p className="p-2 text-sm text-muted-foreground">
                            Create a tag in your vault, then choose it here.
                          </p>
                        ) : tags.filter((tag) =>
                            tag.name
                              .toLowerCase()
                              .includes(tagSearch.toLowerCase())
                          ).length === 0 ? (
                          <p className="p-2 text-sm text-muted-foreground">
                            No tags found.
                          </p>
                        ) : (
                          tags
                            .filter((tag) =>
                              tag.name
                                .toLowerCase()
                                .includes(tagSearch.toLowerCase())
                            )
                            .map((tag) => {
                              const selected =
                                options.tagIds?.includes(tag.id) ?? false
                              return (
                                <label
                                  key={tag.id}
                                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={
                                      !selected &&
                                      (options.tagIds?.length ?? 0) >=
                                        PROFILE_TAG_LIMIT
                                    }
                                    onChange={() =>
                                      setOptions((current) => ({
                                        ...current,
                                        tagIds: selected
                                          ? current.tagIds?.filter(
                                              (id) => id !== tag.id
                                            )
                                          : [...(current.tagIds ?? []), tag.id],
                                      }))
                                    }
                                  />
                                  <span className="min-w-0 break-words">
                                    {tag.name}
                                  </span>
                                </label>
                              )
                            })
                        )}
                      </div>
                      {(options.tagIds?.length ?? 0) > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 w-full border-t"
                          onClick={() =>
                            setOptions((current) => ({
                              ...current,
                              tagIds: [],
                            }))
                          }
                        >
                          Clear tags
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
                  <p className="text-pretty text-xs text-muted-foreground">
                    Add these tags to every file uploaded with this profile.
                  </p>
                </div>
              </div>
              <p className="text-pretty text-xs text-muted-foreground">
                Passwords are set on individual uploads. Recipes contain
                preferences only and never include account credentials. Tags in
                a recipe belong to this account.
              </p>
              {/* Form actions: the primary at the end on wider screens; full
                width and on top on phones, like dialog footers. */}
              <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                {editing && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:bg-danger/10 hover:text-destructive"
                      aria-label="Delete profile"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await request(
                            `/api/upload-profiles/${editing.id}`,
                            'DELETE'
                          )
                          setEditorOpen(false)
                          setEditing(null)
                          toast({
                            title: 'Profile deleted',
                            description: 'Existing files are unchanged.',
                          })
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-auto sm:flex-none"
                      asChild
                    >
                      <a href={`/api/upload-profiles/${editing.id}/export`}>
                        <Download />
                        Export
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-auto sm:flex-none"
                      disabled={busy || data?.defaultProfileId === editing.id}
                      onClick={() =>
                        void perform(async () => {
                          await request('/api/upload-profiles/default', 'PUT', {
                            profileId: editing.id,
                          })
                          toast({ title: 'Default profile updated' })
                        })
                      }
                    >
                      <Star />
                      {data?.defaultProfileId === editing.id
                        ? 'Default profile'
                        : 'Make default'}
                    </Button>
                  </div>
                )}
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => void save()}
                  disabled={busy || !name.trim() || unchanged}
                >
                  {busy ? 'Saving…' : 'Save profile'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditorOpen(false)}
                >
                  Close
                </Button>
              </div>
              {editing && (
                <ProfileToolDownloads
                  profileId={editing.id}
                  profileName={editing.name}
                  disabled={busy}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
