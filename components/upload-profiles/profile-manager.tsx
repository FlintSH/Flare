'use client'

import { useRef, useState } from 'react'

import {
  Download,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  type UploadProfileOptions,
  type UploadProfileView,
  uploadRecipeSchema,
} from '@/lib/uploads/schema'

import { useToast } from '@/hooks/use-toast'

import { useUploadProfiles } from './profile-picker'

const controls: {
  key: keyof UploadProfileOptions
  label: string
  choices: [string, string][]
}[] = [
  {
    key: 'visibility',
    label: 'Visibility',
    choices: [
      ['PUBLIC', 'Public'],
      ['PRIVATE', 'Private — only me'],
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
const starters: {
  name: string
  description: string
  options: UploadProfileOptions
}[] = [
  {
    name: 'Public screenshots',
    description: 'A minimal share page and random filenames.',
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
    description: 'Public links that become private after one hour.',
    options: {
      visibility: 'PUBLIC',
      expiration: 'HOUR',
      expiryAction: 'SET_PRIVATE',
      shareStyle: 'framed',
    },
  },
]

export function ProfileManager({ embedded = false }: { embedded?: boolean }) {
  const { data, error } = useUploadProfiles()
  const { toast } = useToast()
  const [editing, setEditing] = useState<UploadProfileView | null>(null)
  const [name, setName] = useState('')
  const [options, setOptions] = useState<UploadProfileOptions>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const refresh = () =>
    window.dispatchEvent(new Event('flare:upload-profiles-changed'))
  const choose = (profile: UploadProfileView | null) => {
    setEditing(profile)
    setName(profile?.name || '')
    setOptions(profile?.options || {})
    setMessage('')
  }

  async function request(url: string, method: string, body?: unknown) {
    const result = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await result.json()
    if (!result.ok)
      throw new Error(json.error || 'Could not save your changes.')
    return json.data
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      refresh()
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
      const profile = await request(
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

  async function downloadClient(client: string) {
    if (!editing) return
    await perform(async () => {
      const postBody =
        client === 'flameshot'
          ? { useWayland: false, useCompositor: false, profileId: editing.id }
          : client === 'spectacle'
            ? {
                scriptType: 'screenshot',
                useWayland: false,
                includePointer: false,
                captureMode: 'region',
                recordingMode: 'region',
                delay: 0,
                profileId: editing.id,
              }
            : null
      const response = await fetch(
        `/api/profile/${client}?profileId=${encodeURIComponent(editing.id)}`,
        postBody
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(postBody),
            }
          : undefined
      )
      if (!response.ok)
        throw new Error('Could not generate the uploader configuration.')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download =
        client === 'sharex' ? 'flare-sharex.sxcu' : `flare-${client}.sh`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!embedded && (
            <p className="text-sm font-medium text-primary mb-2">
              Your workflow
            </p>
          )}
          {embedded ? (
            <h3 className="text-lg font-semibold">Reusable upload profiles</h3>
          ) : (
            <h1 className="text-3xl font-bold tracking-tight">
              Upload profiles
            </h1>
          )}
          <p className="text-muted-foreground mt-2 max-w-2xl">
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
            <Upload className="mr-2 h-4 w-4" />
            Import recipe
          </Button>
          <Button onClick={() => choose(null)}>
            <Plus className="mr-2 h-4 w-4" />
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
            if (file.size > 64 * 1024)
              throw new Error('Recipes must be smaller than 64 KB.')
            const recipe = uploadRecipeSchema.parse(
              JSON.parse(await file.text())
            )
            choose(await request('/api/upload-profiles', 'POST', recipe))
            toast({
              title: 'Recipe imported',
              description: 'Review it before making it your default.',
            })
          })
        }}
      />
      {(message || error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {message || error}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-muted-foreground">
          Loading upload profiles…
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(200px,0.8fr)_minmax(0,1.5fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Your profiles</h2>
              <span className="text-xs text-muted-foreground">
                {data?.profiles.length ?? 0} saved
              </span>
            </div>
            {data?.profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => choose(profile)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${editing?.id === profile.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'}`}
              >
                <span className="flex items-center gap-2 break-words font-medium">
                  {profile.name}
                  {data.defaultProfileId === profile.id && (
                    <Star
                      className="h-3.5 w-3.5 fill-primary text-primary"
                      aria-label="Default profile"
                    />
                  )}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {profile.options.visibility === 'PRIVATE'
                    ? 'Private'
                    : profile.options.visibility === 'PUBLIC'
                      ? 'Public'
                      : 'Inherited visibility'}{' '}
                  · {Object.keys(profile.options).length} saved choices
                </span>
              </button>
            ))}
            {data?.profiles.length === 0 && (
              <p className="text-sm text-muted-foreground py-3">
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
          </Card>
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Start with a recipe
            </h2>
            {starters.map((starter) => (
              <button
                key={starter.name}
                className="w-full rounded-xl border p-4 text-left hover:bg-muted/50 transition-colors"
                onClick={() => {
                  setEditing(null)
                  setName(starter.name)
                  setOptions(starter.options)
                  setMessage('')
                }}
              >
                <span className="font-medium text-sm">{starter.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {starter.description}
                </span>
              </button>
            ))}
          </div>
        </div>
        <Card className="min-w-0 p-5 sm:p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold">
              {editing ? 'Edit profile' : 'Create a profile'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              “Inherit” follows your account or instance settings. Changes apply
              to future uploads.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-name">Profile name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My screenshots"
              maxLength={80}
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
          </div>
          <p className="text-xs text-muted-foreground">
            Passwords are set on individual uploads. Recipes contain preferences
            only and never include account credentials.
          </p>
          <div className="flex flex-wrap items-center gap-2 border-t pt-5">
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>
              <Save className="mr-2 h-4 w-4" />
              {busy ? 'Saving…' : 'Save profile'}
            </Button>
            {editing && (
              <>
                <Button
                  variant="outline"
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
                  <Star className="mr-2 h-4 w-4" />
                  {data?.defaultProfileId === editing.id
                    ? 'Default profile'
                    : 'Make default'}
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/api/upload-profiles/${editing.id}/export`}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Delete profile"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await request(
                        `/api/upload-profiles/${editing.id}`,
                        'DELETE'
                      )
                      choose(null)
                      toast({
                        title: 'Profile deleted',
                        description: 'Existing files are unchanged.',
                      })
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          {editing && (
            <div className="rounded-xl bg-muted/50 p-4 space-y-3">
              <div>
                <h3 className="font-medium">Use this profile in your tools</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Download an uploader with this profile selected. Generated
                  scripts contain your upload credential; keep them private.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {['sharex', 'bash', 'flameshot', 'spectacle'].map((client) => (
                  <Button
                    key={client}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void downloadClient(client)}
                  >
                    {
                      {
                        sharex: 'ShareX',
                        bash: 'Bash',
                        flameshot: 'Flameshot',
                        spectacle: 'Spectacle',
                      }[client]
                    }
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
