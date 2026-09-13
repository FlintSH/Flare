'use client'

import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import Link from 'next/link'

import { ArrowRight, Check, ImageIcon, Loader2, Palette } from 'lucide-react'

import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import {
  type CustomizationState,
  DARK_PALETTE,
  appearanceDocumentSchema,
  customizationSchema,
} from '@/lib/customization/schema'
import { paletteVariables } from '@/lib/customization/theme'
import {
  SETUP_APPEARANCE_PRESETS,
  type SetupAppearancePreset,
  createSetupAppearance,
} from '@/lib/setup/appearance'
import { cn } from '@/lib/utils'

export function SetupAppearance({
  onComplete,
  onSkip,
}: {
  onComplete: () => void
  onSkip: () => void
}) {
  const id = useId()
  const [settings, setSettings] = useState<CustomizationState | null>(null)
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [preset, setPreset] = useState<SetupAppearancePreset>('flare')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const submitting = useRef(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/customization', {
        cache: 'no-store',
        signal,
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Unable to load your appearance.')
      const current = customizationSchema.parse(body.data)
      if (signal?.aborted) return
      setSettings(current)
      setName(current.published.brand.name)
      setTagline(current.published.brand.tagline)
      setPreset(current.published.theme.enabled ? 'current' : 'flare')
      setConflict(false)
    } catch (cause) {
      if (signal?.aborted) return
      setError(
        cause instanceof Error ? cause.message : 'Unable to load appearance.'
      )
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const document = settings
    ? createSetupAppearance(settings.published, { name, tagline, preset })
    : null
  const locked = loading || saving || conflict || !!settings?.draft

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings || !document || locked || submitting.current) return
    const parsed = appearanceDocumentSchema.safeParse(document)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Check your appearance.')
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          revision: settings.revision,
          document: parsed.data,
        }),
      })
      const body = await response.json()
      if (response.status === 409) {
        setConflict(true)
        throw new Error(
          'Appearance changed in another tab. Reload the latest appearance, then review your choices before saving.'
        )
      }
      if (!response.ok)
        throw new Error(body.error || 'Unable to save your appearance.')
      setSettings(customizationSchema.parse(body.data))
      onComplete()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save appearance.'
      )
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  const previewVariables = document
    ? ({
        ...paletteVariables(
          document.theme.enabled ? document.theme.dark : DARK_PALETTE
        ),
        '--radius': `${document.theme.radius}rem`,
        fontFamily:
          document.theme.font === 'mono'
            ? 'ui-monospace, monospace'
            : document.theme.font === 'system'
              ? 'system-ui, sans-serif'
              : 'var(--font-inter)',
      } as CSSProperties)
    : undefined

  return (
    <form onSubmit={(event) => void publish(event)} className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
              <Palette className="h-5 w-5" />
            </span>
            <div className="space-y-1.5">
              <CardTitle>Your name. Your style.</CardTitle>
              <CardDescription>
                A few personal touches to make this space feel like yours.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Appearance needs your attention</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              {(conflict || !settings) && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  {conflict ? 'Reload latest appearance' : 'Try again'}
                </Button>
              )}
            </Alert>
          )}
          {loading && (
            <div
              className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your appearance…
            </div>
          )}
          {settings?.draft && (
            <Alert>
              <AlertTitle>You already have an appearance draft</AlertTitle>
              <AlertDescription>
                Continue with your published appearance to keep that draft
                intact. You can review and publish it in the appearance studio.
              </AlertDescription>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href="/dashboard/customize"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review existing draft
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading || saving}
                  onClick={() => void load()}
                >
                  Reload appearance
                </Button>
              </div>
            </Alert>
          )}
          {settings && document && !loading && (
            <div className="grid items-start gap-6 lg:grid-cols-[1fr_0.9fr]">
              <div className="min-w-0 space-y-6">
                <div className="space-y-2">
                  <Label htmlFor={`${id}-name`}>Instance name</Label>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Flare"
                    required
                    maxLength={60}
                    disabled={locked}
                    autoComplete="organization"
                  />
                  <p className="text-xs text-muted-foreground">
                    The name people see when you share a file.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-tagline`}>Tagline</Label>
                  <Input
                    id={`${id}-tagline`}
                    value={tagline}
                    onChange={(event) => setTagline(event.target.value)}
                    placeholder="A home for everything worth sharing."
                    maxLength={180}
                    disabled={locked}
                  />
                  <p className="text-xs text-muted-foreground">
                    A short introduction, if you want one.
                  </p>
                </div>
                <div className="space-y-3">
                  <Label id={`${id}-presets`}>Choose a starting look</Label>
                  <RadioGroup
                    value={preset}
                    onValueChange={(value) =>
                      setPreset(value as SetupAppearancePreset)
                    }
                    disabled={locked}
                    aria-labelledby={`${id}-presets`}
                    className="grid-cols-2 gap-3"
                  >
                    {settings.published.theme.enabled && (
                      <Label
                        htmlFor={`${id}-current`}
                        className={cn(
                          'col-span-2 flex cursor-pointer items-center gap-3 rounded-xl border p-3',
                          preset === 'current' && 'border-primary bg-primary/5'
                        )}
                      >
                        <RadioGroupItem value="current" id={`${id}-current`} />
                        <div className="space-y-1">
                          <span className="block text-sm">
                            Current appearance
                          </span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            Keep the theme you have already published.
                          </span>
                        </div>
                      </Label>
                    )}
                    {SETUP_APPEARANCE_PRESETS.map((option) => (
                      <Label
                        key={option.id}
                        htmlFor={`${id}-${option.id}`}
                        className={cn(
                          'cursor-pointer space-y-3 rounded-xl border p-3 transition-colors hover:border-primary/50',
                          preset === option.id && 'border-primary bg-primary/5'
                        )}
                      >
                        <span
                          className="flex h-9 items-center gap-1.5 overflow-hidden rounded-md px-3"
                          style={{ backgroundColor: option.background }}
                          aria-hidden="true"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: option.accent }}
                          />
                          <span
                            className="h-1.5 w-10 rounded-full opacity-60"
                            style={{ backgroundColor: option.accent }}
                          />
                        </span>
                        <span className="flex items-center gap-2">
                          <RadioGroupItem
                            value={option.id}
                            id={`${id}-${option.id}`}
                          />
                          <span className="text-sm">{option.name}</span>
                        </span>
                        <span className="block text-xs font-normal leading-relaxed text-muted-foreground">
                          {option.description}
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
              </div>
              <div className="min-w-0 space-y-3 lg:sticky lg:top-6">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Live preview</span>
                  <span>Dark appearance</span>
                </div>
                <div
                  data-setup-appearance-preview
                  style={previewVariables}
                  className="overflow-hidden rounded-xl border bg-background text-foreground shadow-lg"
                >
                  <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Your Flare
                    </span>
                  </div>
                  <div className="space-y-6 p-5">
                    <div className="flex items-center gap-2.5">
                      {document.brand.logoDark || document.brand.logoLight ? (
                        <img
                          src={
                            document.brand.logoDark || document.brand.logoLight
                          }
                          alt=""
                          className="h-6 w-6 shrink-0 object-contain"
                        />
                      ) : (
                        <Icons.logo className="h-6 w-6 shrink-0" />
                      )}
                      <span className="break-words font-bold min-w-0">
                        {name.trim() || 'Flare'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xl font-semibold tracking-tight">
                        Good things belong here.
                      </p>
                      <p className="min-h-8 break-words text-xs leading-relaxed text-muted-foreground">
                        {tagline.trim() ||
                          'A home for everything worth sharing.'}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex h-24 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <ImageIcon className="h-9 w-9" strokeWidth={1.25} />
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-3 text-[11px]">
                        <span className="truncate">
                          something-worth-sharing.png
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                          <Check className="h-3 w-3" /> Ready
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground">
                      Share something <ArrowRight className="h-3 w-3" />
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Try a look here. It goes live when you save and continue.
                  Logos, share pages, and every detail can be customized later.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={onSkip}
          disabled={saving}
        >
          {settings?.draft
            ? 'Keep published appearance'
            : 'Set up appearance later'}
        </Button>
        <Button type="submit" disabled={!document || locked || !name.trim()}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {saving ? 'Saving appearance…' : 'Save and continue'}
        </Button>
      </div>
    </form>
  )
}
