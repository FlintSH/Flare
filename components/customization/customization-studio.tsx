'use client'

import { useEffect, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  Check,
  Download,
  Globe2,
  ImagePlus,
  Layers3,
  Loader2,
  Palette as PaletteIcon,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  type AppearanceCommand,
  type AppearanceDocument,
  type CustomizationState,
  DARK_PALETTE,
  LIGHT_PALETTE,
  type Palette,
  appearanceDocumentSchema,
  appearancePackSchema,
} from '@/lib/customization/schema'
import { exportAppearancePack } from '@/lib/customization/state'
import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

import { AppearancePreview } from './appearance-preview'
import { RecoveryLink } from './recovery-link'

const sections = [
  {
    id: 'identity',
    name: 'Identity',
    icon: Globe2,
    description: 'Your name and marks',
  },
  {
    id: 'theme',
    name: 'Theme',
    icon: PaletteIcon,
    description: 'Color, type and atmosphere',
  },
  {
    id: 'sharing',
    name: 'Sharing',
    icon: Layers3,
    description: 'The page behind every link',
  },
  {
    id: 'packs',
    name: 'Appearance packs',
    icon: Download,
    description: 'Save it. Share it. Make it yours.',
  },
] as const

const styleOptions = [
  {
    value: 'minimal',
    title: 'Minimal',
    description: 'Let the image do the talking.',
  },
  {
    value: 'framed',
    title: 'Framed',
    description: 'A familiar frame for every file.',
  },
  {
    value: 'delivery',
    title: 'Delivery',
    description: 'A polished handoff, with room to breathe.',
  },
] as const

const palettePresets = [
  {
    name: 'Midnight',
    accent: '#f8fafc',
    lightAccent: '#0f172a',
    background: '#020817',
    swatches: ['#020817', '#1e293b', '#f8fafc'],
  },
  {
    name: 'Orbit',
    accent: '#a78bfa',
    lightAccent: '#7c3aed',
    background: '#100d20',
    swatches: ['#100d20', '#6d28d9', '#c4b5fd'],
  },
  {
    name: 'Tide',
    accent: '#5eead4',
    lightAccent: '#0f766e',
    background: '#061c20',
    swatches: ['#061c20', '#0d9488', '#99f6e4'],
  },
  {
    name: 'Ember',
    accent: '#fdba74',
    lightAccent: '#c2410c',
    background: '#1c1210',
    swatches: ['#1c1210', '#ea580c', '#fed7aa'],
  },
]

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

export function CustomizationStudio({
  initialState,
  recovery = false,
  onStateChange,
  onDirtyChange,
}: {
  initialState: CustomizationState
  recovery?: boolean
  onStateChange?: (state: CustomizationState) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, setState] = useState(initialState)
  const [document, setDocument] = useState<AppearanceDocument | null>(
    initialState?.draft || initialState?.published || null
  )
  const [section, setSection] =
    useState<(typeof sections)[number]['id']>('identity')
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const [protectedPreview, setProtectedPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const [logoBusy, setLogoBusy] = useState<string | null>(null)
  const dirty =
    document && state
      ? JSON.stringify(document) !==
        JSON.stringify(state.draft || state.published)
      : false

  useEffect(() => {
    onDirtyChange?.(!!dirty)
  }, [dirty, onDirtyChange])

  const change = <K extends keyof AppearanceDocument>(
    key: K,
    values: Partial<AppearanceDocument[K]>
  ) => {
    setDocument((previous) =>
      previous
        ? { ...previous, [key]: { ...previous[key], ...values } }
        : previous
    )
  }

  async function act(command: AppearanceCommand) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Appearance could not be saved.')
      const next = body.data as CustomizationState
      setState(next)
      onStateChange?.(next)
      setDocument(next.draft || next.published)
      const messages = {
        save: 'Draft saved',
        publish: 'Your new appearance is live',
        restore: 'Previous appearance restored',
        discard: 'Draft discarded',
        import: 'Pack imported into your draft',
      }
      toast({
        title: messages[command.action],
        description:
          command.action === 'save' || command.action === 'import'
            ? 'Preview your changes, then publish when you are ready.'
            : undefined,
      })
      if (command.action === 'publish' || command.action === 'restore')
        router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadLogo(
    file: File | undefined,
    variant: 'logoLight' | 'logoDark'
  ) {
    if (!file) return
    setLogoBusy(variant)
    setError('')
    try {
      if (file.size > 256 * 1024)
        throw new Error('Choose a logo smaller than 256 KB.')
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/customization/assets', {
        method: 'POST',
        body: form,
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Logo could not be uploaded.')
      change('brand', { [variant]: body.data.url })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Logo could not be uploaded.'
      )
    } finally {
      setLogoBusy(null)
    }
  }

  async function importPack(file: File | undefined) {
    if (!file || !state) return
    setError('')
    try {
      if (file.size > 1_000_000)
        throw new Error('Appearance packs must be smaller than 1 MB.')
      const pack = appearancePackSchema.parse(JSON.parse(await file.text()))
      await act({ action: 'import', revision: state.revision, pack })
    } catch {
      setError(
        'This is not a supported Flare appearance pack (version 1). Your live appearance is unchanged.'
      )
    }
    if (importRef.current) importRef.current.value = ''
  }

  function exportPack() {
    if (!document) return
    const parsed = appearanceDocumentSchema.safeParse(document)
    if (!parsed.success) {
      setError('Fix the appearance fields before exporting.')
      return
    }
    const blob = new Blob(
      [JSON.stringify(exportAppearancePack(parsed.data), null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob),
      anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${document.brand.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'flare'}-appearance.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-8 pb-8">
      {recovery && (
        <div
          role="status"
          className="rounded-xl border bg-muted/40 p-4 text-sm space-y-2"
        >
          <p className="font-medium">Appearance recovery mode</p>
          <p className="text-muted-foreground">
            This page uses Flare’s original appearance with custom CSS and head
            HTML disabled. Your saved settings are unchanged. Restore a previous
            appearance below, or{' '}
            <RecoveryLink
              href="/dashboard/settings?section=appearance&recovery=1#advanced-styles"
              className="underline underline-offset-4"
            >
              repair custom CSS and HTML below
            </RecoveryLink>
            .
          </p>
          <RecoveryLink
            href="/dashboard/settings?section=appearance"
            className="inline-block underline underline-offset-4"
          >
            Return to the live appearance
          </RecoveryLink>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex flex-wrap justify-between gap-3"
        >
          <p className="break-words">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload saved state
          </Button>
        </div>
      )}
      {document && state && (
        <div className="space-y-6">
          <div className="space-y-6">
            <nav
              aria-label="Appearance sections"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex min-w-0 items-center gap-2 text-left rounded-xl border px-3 py-3 transition-colors',
                    section === item.id
                      ? 'border-primary/60 bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  )}
                >
                  <item.icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="text-sm font-medium block">
                      {item.name}
                    </span>
                    <span className="hidden 2xl:block text-[11px] mt-1 font-normal text-muted-foreground leading-relaxed">
                      {item.description}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
            <div className="grid xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)] gap-6 min-w-0">
              <Card
                className="min-w-0 bg-background/60 backdrop-blur-xl border-border/60"
                data-flare-surface
              >
                {section === 'identity' && (
                  <>
                    <CardHeader>
                      <CardTitle>Give your instance an identity</CardTitle>
                      <CardDescription>
                        The details people see when they open one of your links.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <Label htmlFor="brand-name">Instance name</Label>
                        <Input
                          id="brand-name"
                          value={document.brand.name}
                          maxLength={60}
                          onChange={(event) =>
                            change('brand', { name: event.target.value })
                          }
                          placeholder="Flare"
                        />
                        <p className="text-xs text-muted-foreground">
                          Shown in navigation, sign-in and page titles.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="brand-tagline">Tagline</Label>
                        <Input
                          id="brand-tagline"
                          value={document.brand.tagline}
                          maxLength={180}
                          onChange={(event) =>
                            change('brand', { tagline: event.target.value })
                          }
                          placeholder="A home for things worth sharing"
                        />
                      </div>
                      <div>
                        <Label>Your logo</Label>
                        <p className="text-xs text-muted-foreground mt-1 mb-3">
                          PNG, JPEG or WebP, up to 256 KB. Included in your
                          appearance pack.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {(['logoLight', 'logoDark'] as const).map(
                            (variant) => (
                              <div
                                key={variant}
                                className="border rounded-xl p-4 space-y-3"
                              >
                                <div
                                  className={cn(
                                    'h-20 rounded-lg flex items-center justify-center',
                                    variant === 'logoLight'
                                      ? 'bg-slate-100'
                                      : 'bg-slate-950'
                                  )}
                                >
                                  {document.brand[variant] ? (
                                    <img
                                      src={document.brand[variant]}
                                      alt={`${variant === 'logoLight' ? 'Light' : 'Dark'} logo`}
                                      className="h-12 max-w-full object-contain"
                                    />
                                  ) : (
                                    <ImagePlus className="h-6 w-6 text-slate-400" />
                                  )}
                                </div>
                                <label className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                                  {logoBusy === variant ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Upload className="h-3 w-3" />
                                  )}
                                  {variant === 'logoLight'
                                    ? 'Light logo'
                                    : 'Dark logo'}
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="sr-only"
                                    disabled={!!logoBusy || busy}
                                    onChange={(event) => {
                                      void uploadLogo(
                                        event.target.files?.[0],
                                        variant
                                      )
                                      event.target.value = ''
                                    }}
                                  />
                                </label>
                                {document.brand[variant] && (
                                  <button
                                    className="text-xs text-muted-foreground underline"
                                    onClick={() =>
                                      change('brand', { [variant]: '' })
                                    }
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="brand-footer">Footer text</Label>
                        <Input
                          id="brand-footer"
                          value={document.brand.footerText}
                          maxLength={200}
                          onChange={(event) =>
                            change('brand', {
                              footerText: event.target.value,
                            })
                          }
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Your favicon is below. Custom CSS and head HTML are
                        under{' '}
                        <a
                          href="#advanced-styles"
                          onClick={() => {
                            const styles =
                              window.document.getElementById('advanced-styles')
                            if (styles instanceof HTMLDetailsElement)
                              styles.open = true
                          }}
                          className="underline underline-offset-4"
                        >
                          Custom CSS and HTML
                        </a>
                        .
                      </p>
                    </CardContent>
                  </>
                )}
                {section === 'theme' && (
                  <>
                    <CardHeader>
                      <CardTitle>Set the atmosphere</CardTitle>
                      <CardDescription>
                        A matched light and dark palette, with room for your own
                        details.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <SettingRow
                        label="Use studio theme"
                        description="Apply these palettes and surfaces. Your current colors stay active until you turn this on."
                      >
                        <Switch
                          aria-label="Use studio theme"
                          checked={document.theme.enabled}
                          onCheckedChange={(enabled) =>
                            change('theme', { enabled })
                          }
                        />
                      </SettingRow>
                      <div className="grid grid-cols-2 gap-3">
                        {palettePresets.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            className="rounded-xl border p-3 text-left hover:border-primary transition-colors"
                            onClick={() =>
                              change('theme', {
                                enabled: true,
                                light: {
                                  ...LIGHT_PALETTE,
                                  primary: preset.lightAccent,
                                  ring: preset.lightAccent,
                                },
                                dark: {
                                  ...DARK_PALETTE,
                                  background: preset.background,
                                  card: preset.background,
                                  popover: preset.background,
                                  primary: preset.accent,
                                  ring: preset.accent,
                                },
                              })
                            }
                          >
                            <div className="flex overflow-hidden h-9 rounded-md mb-2">
                              {preset.swatches.map((color) => (
                                <span
                                  key={color}
                                  className="flex-1"
                                  style={{ background: color }}
                                />
                              ))}
                            </div>
                            <span className="text-xs font-medium">
                              {preset.name}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="default-theme-mode">
                            Default mode
                          </Label>
                          <Select
                            value={document.theme.defaultMode}
                            onValueChange={(
                              value: AppearanceDocument['theme']['defaultMode']
                            ) => change('theme', { defaultMode: value })}
                          >
                            <SelectTrigger id="default-theme-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="system">
                                Follow device
                              </SelectItem>
                              <SelectItem value="light">Light</SelectItem>
                              <SelectItem value="dark">Dark</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="theme-font">Typeface</Label>
                          <Select
                            value={document.theme.font}
                            onValueChange={(
                              value: AppearanceDocument['theme']['font']
                            ) => change('theme', { font: value })}
                          >
                            <SelectTrigger id="theme-font">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inter">Inter</SelectItem>
                              <SelectItem value="system">System</SelectItem>
                              <SelectItem value="mono">Monospace</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="theme-background">Background</Label>
                        <Select
                          value={document.theme.background}
                          onValueChange={(
                            value: AppearanceDocument['theme']['background']
                          ) => change('theme', { background: value })}
                        >
                          <SelectTrigger id="theme-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="glow">Soft glow</SelectItem>
                            <SelectItem value="plain">Plain</SelectItem>
                            <SelectItem value="grid">Quiet grid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <Label htmlFor="theme-radius">Corner radius</Label>
                          <span className="text-xs text-muted-foreground">
                            {document.theme.radius} rem
                          </span>
                        </div>
                        <input
                          id="theme-radius"
                          type="range"
                          min="0"
                          max="1.5"
                          step="0.125"
                          value={document.theme.radius}
                          onChange={(event) =>
                            change('theme', {
                              radius: Number(event.target.value),
                            })
                          }
                          className="w-full accent-primary"
                        />
                        <p className="text-xs text-muted-foreground">
                          Applies to share frames and studio surfaces.
                        </p>
                      </div>
                      <div className="border-t pt-5 space-y-4">
                        <div className="flex justify-between items-center">
                          <Label>Fine-tune colors</Label>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={mode === 'light' ? 'secondary' : 'ghost'}
                              onClick={() => setMode('light')}
                            >
                              Light
                            </Button>
                            <Button
                              size="sm"
                              variant={mode === 'dark' ? 'secondary' : 'ghost'}
                              onClick={() => setMode('dark')}
                            >
                              Dark
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {(
                            [
                              'background',
                              'foreground',
                              'primary',
                              'primaryForeground',
                              'card',
                              'border',
                            ] as (keyof Palette)[]
                          ).map((key) => (
                            <div key={key} className="space-y-1.5">
                              <label
                                htmlFor={`color-${key}`}
                                className="text-xs capitalize"
                              >
                                {key.replace(
                                  /[A-Z]/g,
                                  (letter) => ` ${letter.toLowerCase()}`
                                )}
                              </label>
                              <div className="flex items-center border rounded-lg p-1.5 gap-2">
                                <input
                                  id={`color-${key}`}
                                  type="color"
                                  value={document.theme[mode][key]}
                                  onChange={(event) =>
                                    change('theme', {
                                      [mode]: {
                                        ...document.theme[mode],
                                        [key]: event.target.value,
                                      },
                                    })
                                  }
                                  className="h-7 w-8 bg-transparent cursor-pointer border-0"
                                />
                                <span className="text-[11px] font-mono text-muted-foreground">
                                  {document.theme[mode][key]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            All color tokens
                          </summary>
                          <div className="grid grid-cols-2 gap-3 mt-4">
                            {Object.keys(document.theme[mode])
                              .filter(
                                (key) =>
                                  ![
                                    'background',
                                    'foreground',
                                    'primary',
                                    'primaryForeground',
                                    'card',
                                    'border',
                                  ].includes(key)
                              )
                              .map((key) => (
                                <label
                                  key={key}
                                  className="flex items-center justify-between gap-2 capitalize"
                                >
                                  {key.replace(
                                    /[A-Z]/g,
                                    (letter) => ` ${letter.toLowerCase()}`
                                  )}
                                  <input
                                    aria-label={`${mode} ${key}`}
                                    type="color"
                                    value={
                                      document.theme[mode][key as keyof Palette]
                                    }
                                    onChange={(event) =>
                                      change('theme', {
                                        [mode]: {
                                          ...document.theme[mode],
                                          [key]: event.target.value,
                                        },
                                      })
                                    }
                                    className="h-7 w-8 bg-transparent"
                                  />
                                </label>
                              ))}
                          </div>
                        </details>
                      </div>
                    </CardContent>
                  </>
                )}
                {section === 'sharing' && (
                  <>
                    <CardHeader>
                      <CardTitle>Make every link feel intentional</CardTitle>
                      <CardDescription>
                        Choose the default page for new and existing shares.
                        Upload profiles can select a different layout.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="space-y-3">
                        {styleOptions.map((style) => (
                          <button
                            key={style.value}
                            type="button"
                            aria-pressed={
                              document.sharing.defaultStyle === style.value
                            }
                            className={cn(
                              'w-full flex gap-4 items-center text-left rounded-xl border p-4 transition-colors',
                              document.sharing.defaultStyle === style.value
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'hover:bg-muted/30'
                            )}
                            onClick={() =>
                              change('sharing', { defaultStyle: style.value })
                            }
                          >
                            <div className="w-12 h-12 rounded-lg bg-muted/60 flex items-center justify-center">
                              <div
                                className={cn(
                                  'w-7 h-6 bg-primary/20',
                                  style.value === 'minimal'
                                    ? 'rounded-sm'
                                    : 'border-4 border-primary/30 rounded-md',
                                  style.value === 'delivery' && 'border-t-[9px]'
                                )}
                              />
                            </div>
                            <span className="flex-1">
                              <span className="font-medium text-sm block">
                                {style.title}
                              </span>
                              <span className="text-xs text-muted-foreground mt-1 block">
                                {style.description}
                              </span>
                            </span>
                            {document.sharing.defaultStyle === style.value && (
                              <Check className="h-4 w-4" />
                            )}
                          </button>
                        ))}
                      </div>
                      <div>
                        <SettingRow
                          label="Show uploader"
                          description="Include the uploader’s name and avatar on the page, and attribution in social previews."
                        >
                          <Switch
                            aria-label="Show uploader"
                            checked={document.sharing.showUploader}
                            onCheckedChange={(showUploader) =>
                              change('sharing', { showUploader })
                            }
                          />
                        </SettingRow>
                        <SettingRow
                          label="Show filename"
                          description="Display the name in the page heading and social previews."
                        >
                          <Switch
                            aria-label="Show filename"
                            checked={document.sharing.showFilename}
                            onCheckedChange={(showFilename) =>
                              change('sharing', { showFilename })
                            }
                          />
                        </SettingRow>
                        <SettingRow
                          label="Show file size"
                          description="Include the size on the share page and in its title."
                        >
                          <Switch
                            aria-label="Show file size"
                            checked={document.sharing.showSize}
                            onCheckedChange={(showSize) =>
                              change('sharing', { showSize })
                            }
                          />
                        </SettingRow>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sharing-footer">
                          Share-page footer
                        </Label>
                        <Select
                          value={
                            document.sharing.showFooter === null
                              ? 'inherit'
                              : String(document.sharing.showFooter)
                          }
                          onValueChange={(value) =>
                            change('sharing', {
                              showFooter:
                                value === 'inherit' ? null : value === 'true',
                            })
                          }
                        >
                          <SelectTrigger id="sharing-footer">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">
                              From instance settings
                            </SelectItem>
                            <SelectItem value="true">Show footer</SelectItem>
                            <SelectItem value="false">Hide footer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sharing-image-fit">Image fit</Label>
                        <Select
                          value={document.sharing.imageFit}
                          onValueChange={(imageFit: 'contain' | 'cover') =>
                            change('sharing', { imageFit })
                          }
                        >
                          <SelectTrigger id="sharing-image-fit">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="contain">
                              Show the whole image
                            </SelectItem>
                            <SelectItem value="cover">
                              Fill the frame (may crop)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sharing-title-template">
                          Social preview title
                        </Label>
                        <Input
                          id="sharing-title-template"
                          value={document.sharing.titleTemplate}
                          onChange={(event) =>
                            change('sharing', {
                              titleTemplate: event.target.value,
                            })
                          }
                          placeholder="Automatic from file details"
                          maxLength={500}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sharing-description-template">
                          Social preview description
                        </Label>
                        <Input
                          id="sharing-description-template"
                          value={document.sharing.descriptionTemplate}
                          onChange={(event) =>
                            change('sharing', {
                              descriptionTemplate: event.target.value,
                            })
                          }
                          placeholder="Automatic from file details"
                          maxLength={500}
                        />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {
                            'Available: {{instanceName}}, {{filename}}, {{size}}, {{uploader}}. Hidden details are omitted from these templates too. Leave empty for automatic text.'
                          }
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These controls change presentation. Existing URLs and
                        downloaded files can still contain their original names.
                        File access stays governed by visibility and passwords.
                      </p>
                    </CardContent>
                  </>
                )}
                {section === 'packs' && (
                  <>
                    <CardHeader>
                      <CardTitle>A design worth passing along</CardTitle>
                      <CardDescription>
                        Bring an appearance into Flare, or give someone a
                        starting point of their own.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="rounded-xl border border-dashed p-7 text-center space-y-4">
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">
                            Import an appearance pack
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Flare appearance JSON, version 1, up to 1 MB.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy || !!dirty}
                          onClick={() => importRef.current?.click()}
                        >
                          Choose pack
                        </Button>
                        <input
                          ref={importRef}
                          type="file"
                          accept="application/json,.json"
                          className="sr-only"
                          aria-label="Import appearance pack"
                          onChange={(event) =>
                            void importPack(event.target.files?.[0])
                          }
                        />
                        {dirty && (
                          <p className="text-xs text-muted-foreground">
                            Save or discard your current changes before
                            importing.
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border p-5 space-y-3">
                        <p className="font-medium text-sm">
                          Take this appearance with you
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Export the design you are previewing: identity,
                          embedded logos, both palettes, surfaces and share-page
                          choices.
                        </p>
                        <Button variant="outline" onClick={exportPack}>
                          <Download className="h-4 w-4 mr-2" />
                          Export appearance
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Imports open as a saved draft. Review the design before
                        publishing. Packs include no accounts, credentials,
                        files, or executable code.
                      </p>
                    </CardContent>
                  </>
                )}
              </Card>
              <div className="min-w-0 xl:sticky xl:top-28 self-start">
                <AppearancePreview
                  document={document}
                  mode={mode}
                  onModeChange={setMode}
                  protectedPreview={protectedPreview}
                  onProtectedChange={setProtectedPreview}
                />
              </div>
            </div>
          </div>
          <div className="rounded-2xl border bg-background/95 backdrop-blur-xl shadow-xl px-5 py-4 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <p className="text-sm font-medium flex items-center gap-2">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    dirty
                      ? 'bg-amber-400'
                      : state.draft
                        ? 'bg-sky-400'
                        : 'bg-emerald-400'
                  )}
                />
                {dirty
                  ? 'Unsaved changes'
                  : state.draft
                    ? 'Draft saved · ready to preview'
                    : 'Published appearance'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {dirty || state.draft
                  ? 'Your live instance stays the same until you publish.'
                  : `Revision ${state.revision}${state.publishedAt ? ` · Published ${new Date(state.publishedAt).toLocaleDateString()}` : ' · Original Flare appearance'}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {state.previous && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act({ action: 'restore', revision: state.revision })
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-2" />
                  Restore previous
                </Button>
              )}
              {(dirty || state.draft) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    dirty && !state.draft
                      ? setDocument(state.published)
                      : void act({
                          action: 'discard',
                          revision: state.revision,
                        })
                  }
                >
                  Discard
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !dirty || !!logoBusy}
                onClick={() =>
                  void act({
                    action: 'save',
                    revision: state.revision,
                    document,
                  })
                }
              >
                <Save className="h-3.5 w-3.5 mr-2" />
                Save draft
              </Button>
              <Button
                size="sm"
                disabled={busy || (!dirty && !state.draft) || !!logoBusy}
                onClick={() =>
                  void act({
                    action: 'publish',
                    revision: state.revision,
                    document,
                  })
                }
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-2" />
                )}
                Publish appearance
              </Button>
            </div>
          </div>
        </div>
      )}
      {!recovery && (
        <p className="text-xs text-muted-foreground">
          Trouble with a custom theme?{' '}
          <RecoveryLink
            href="/dashboard/settings?section=appearance&recovery=1"
            className="underline underline-offset-4"
          >
            Open appearance recovery
          </RecoveryLink>{' '}
          to restore your design using the original interface.
        </p>
      )}
    </div>
  )
}
