'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  AlertCircle,
  Check,
  Download,
  Globe2,
  ImagePlus,
  InfoIcon,
  Layers3,
  Loader2,
  MessageSquareShare,
  Palette as PaletteIcon,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react'

import {
  EMBED_MODE_OPTIONS,
  EmbedCardFields,
  EmbedModePicker,
} from '@/components/embeds/embed-fields'
import { EmbedPreview } from '@/components/embeds/embed-preview'
import { colorSwatchClassName } from '@/components/shared/form-styles'
import { SaveBar } from '@/components/shared/save-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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

import { apiRequest } from '@/lib/client/request'
import { saveBlobAsFile } from '@/lib/client/save-file'
import { LOGO_ACCEPT, logoProblem } from '@/lib/customization/logo'
import { PALETTE_PRESETS, presetPalettes } from '@/lib/customization/presets'
import {
  type AppearanceCommand,
  type AppearanceDocument,
  type CustomizationState,
  DEFAULT_APPEARANCE,
  type Palette,
  appearanceDocumentSchema,
  appearancePackSchema,
} from '@/lib/customization/schema'
import { exportAppearancePack } from '@/lib/customization/state'
import { type EmbedCardTemplates, instanceEmbedCard } from '@/lib/embeds/schema'
import { CUSTOM_STYLES_PERMISSION } from '@/lib/permissions/settings'
import { cn } from '@/lib/utils'

import { useHydrated } from '@/hooks/use-hydrated'
import { usePermissions } from '@/hooks/use-permissions'
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
    id: 'embeds',
    name: 'Embeds',
    icon: MessageSquareShare,
    description: 'How links look where they are pasted',
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

// Where the appearance document keeps each part of the card that
// instanceEmbedCard reads.
const EMBED_CARD_FIELDS = {
  siteName: 'siteNameTemplate',
  author: 'authorTemplate',
  title: 'titleTemplate',
  description: 'descriptionTemplate',
  color: 'embedColor',
} as const satisfies Record<
  keyof EmbedCardTemplates,
  keyof AppearanceDocument['sharing']
>

const palettePresets = [
  {
    name: 'Midnight',
    ...PALETTE_PRESETS.midnight,
    swatches: ['#010610', '#222d40', '#f8fafc'],
  },
  {
    name: 'Orbit',
    ...PALETTE_PRESETS.orbit,
    swatches: ['#100d20', '#6d28d9', '#c4b5fd'],
  },
  {
    name: 'Tide',
    ...PALETTE_PRESETS.tide,
    swatches: ['#061c20', '#0d9488', '#99f6e4'],
  },
  {
    name: 'Ember',
    ...PALETTE_PRESETS.ember,
    swatches: ['#1c1210', '#ea580c', '#fed7aa'],
  },
]

/**
 * Edge fades for a row that scrolls sideways, measured like the vertical
 * list fades (lib/utils/scroll-fade.ts): an edge fades while there is more
 * beyond it, so a cut-off tab reads as "more".
 */
function sidewaysFadeRef(element: HTMLElement | null) {
  if (!element) return
  const update = () => {
    const start = element.scrollLeft > 1
    const end =
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    const mask =
      start || end
        ? `linear-gradient(to right, ${start ? 'transparent' : '#000'}, #000 2rem, #000 calc(100% - 2rem), ${end ? 'transparent' : '#000'})`
        : ''
    element.style.setProperty('mask-image', mask)
    element.style.setProperty('-webkit-mask-image', mask)
  }
  update()
  element.addEventListener('scroll', update, { passive: true })
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
  resize?.observe(element)
  return () => {
    element.removeEventListener('scroll', update)
    resize?.disconnect()
  }
}

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
  creditsFooter,
  recovery = false,
  onStateChange,
  onDirtyChange,
  onThemeReset,
  onThemeResetPending,
  themeResetBlocked = false,
}: {
  initialState: CustomizationState
  /** The instance's saved Show credits footer setting, for the preview. */
  creditsFooter: boolean
  recovery?: boolean
  onStateChange?: (state: CustomizationState) => void
  onDirtyChange?: (dirty: boolean) => void
  /** Called after the theme and classic colors are reset to Flare's defaults. */
  onThemeReset?: () => void
  /** Reports a reset in flight, so the page can hold its own settings save. */
  onThemeResetPending?: (pending: boolean) => void
  /** Set while the page saves settings; the reset waits for that save. */
  themeResetBlocked?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  // The Custom CSS and HTML editors render only for this permission.
  const customStyles = usePermissions().can(CUSTOM_STYLES_PERMISSION)
  const [state, setState] = useState(initialState)
  const [document, setDocument] = useState<AppearanceDocument | null>(
    initialState?.draft || initialState?.published || null
  )
  // The publish date is in the reader's time zone, which the server lacks.
  const hydrated = useHydrated()
  const [section, setSection] =
    useState<(typeof sections)[number]['id']>('identity')
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const [protectedPreview, setProtectedPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [error, setError] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const sectionNav = useRef<HTMLElement | null>(null)
  const sectionNavRef = useCallback((element: HTMLElement | null) => {
    sectionNav.current = element
    return sidewaysFadeRef(element)
  }, [])
  const [logoBusy, setLogoBusy] = useState<string | null>(null)
  const dirty =
    document && state
      ? JSON.stringify(document) !==
        JSON.stringify(state.draft || state.published)
      : false

  useEffect(() => {
    onDirtyChange?.(!!dirty)
  }, [dirty, onDirtyChange])

  // On phones the section tabs scroll sideways: keep the chosen one in view,
  // centred so its neighbours still show on both sides.
  useEffect(() => {
    const nav = sectionNav.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    const box = nav.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    nav.scrollLeft += item.left + item.width / 2 - (box.left + box.width / 2)
  }, [section])

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
    const reset = command.action === 'reset-theme'
    setBusy(true)
    if (reset) onThemeResetPending?.(true)
    setError('')
    try {
      const next = await apiRequest<CustomizationState>('/api/customization', {
        body: command,
        fallback: 'Appearance could not be saved.',
      })
      setState(next)
      onStateChange?.(next)
      if (command.action === 'reset-theme') {
        // Keep unsaved identity and sharing edits; only the theme is reset.
        setDocument((previous) =>
          previous
            ? { ...previous, theme: DEFAULT_APPEARANCE.theme }
            : next.draft || next.published
        )
        onThemeReset?.()
      } else {
        setDocument(next.draft || next.published)
      }
      const messages = {
        save: 'Draft saved',
        publish: 'Your new appearance is live',
        restore: 'Previous appearance restored',
        'reset-theme': 'Flare theme restored',
        discard: 'Draft discarded',
        import: 'Pack imported into your draft',
      }
      toast({
        title: messages[command.action],
        description:
          command.action === 'save' || command.action === 'import'
            ? 'Preview your changes, then publish when you are ready.'
            : command.action === 'reset-theme'
              ? 'Your instance uses the default colors, typeface, and background again.'
              : undefined,
      })
      if (
        command.action === 'publish' ||
        command.action === 'restore' ||
        command.action === 'reset-theme'
      )
        router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setBusy(false)
      if (reset) onThemeResetPending?.(false)
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
      const problem = logoProblem(file)
      if (problem) throw new Error(problem.message)
      const form = new FormData()
      form.append('file', file)
      const { url } = await apiRequest<{ url: string }>(
        '/api/customization/assets',
        { body: form, fallback: 'Logo could not be uploaded.' }
      )
      change('brand', { [variant]: url })
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
    saveBlobAsFile(
      new Blob([JSON.stringify(exportAppearancePack(parsed.data), null, 2)], {
        type: 'application/json',
      }),
      `${document.brand.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'flare'}-appearance.json`
    )
  }

  return (
    <div className="space-y-8 pb-8">
      {recovery && (
        <Alert variant="info" role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Appearance recovery mode</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-muted-foreground">
              This page uses Flare’s original appearance with custom CSS and
              head HTML disabled. Your saved settings are unchanged. Restore a
              previous appearance below
              {customStyles ? (
                <>
                  , or{' '}
                  <RecoveryLink
                    href="/dashboard/settings?section=appearance&recovery=1#advanced-styles"
                    className="underline underline-offset-4"
                  >
                    repair custom CSS and HTML below
                  </RecoveryLink>
                </>
              ) : null}
              .
            </p>
            <RecoveryLink
              href="/dashboard/settings?section=appearance"
              className="inline-block underline underline-offset-4"
            >
              Return to the live appearance
            </RecoveryLink>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span className="break-words">{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload saved state
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {document && state && (
        <div className="space-y-6">
          <div className="space-y-6">
            {/* The app's one segmented style, like the Users tabs. Narrow
                screens keep one row that scrolls sideways, like the
                settings sections; the padding leaves room for focus rings. */}
            <nav
              ref={sectionNavRef}
              aria-label="Appearance sections"
              className="-m-1 flex gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  title={item.description}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    section === item.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.name}
                </button>
              ))}
            </nav>
            <div className="grid xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)] gap-6 min-w-0">
              <Card className="min-w-0" data-flare-surface>
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
                                {/* Each logo on its mode's page colour from this
                                    palette, with an edge so the tile shows on any
                                    card. The empty icon takes that mode's muted
                                    text colour, so it reads on its own tile. */}
                                <div
                                  className="flex h-20 items-center justify-center rounded-lg border border-border"
                                  style={{
                                    backgroundColor:
                                      document.theme[
                                        variant === 'logoLight'
                                          ? 'light'
                                          : 'dark'
                                      ].background,
                                    color:
                                      document.theme[
                                        variant === 'logoLight'
                                          ? 'light'
                                          : 'dark'
                                      ].mutedForeground,
                                  }}
                                >
                                  {document.brand[variant] ? (
                                    <img
                                      src={document.brand[variant]}
                                      alt={`${variant === 'logoLight' ? 'Light' : 'Dark'} logo`}
                                      className="h-12 max-w-full object-contain"
                                    />
                                  ) : (
                                    <ImagePlus
                                      className="h-6 w-6"
                                      aria-hidden="true"
                                    />
                                  )}
                                </div>
                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background">
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
                                    accept={LOGO_ACCEPT}
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
                      <p className="text-pretty text-xs text-muted-foreground">
                        Your favicon is below.
                        {customStyles && (
                          <>
                            {' '}
                            Custom CSS and head HTML are under{' '}
                            <a
                              href="#advanced-styles"
                              onClick={() => {
                                const styles =
                                  window.document.getElementById(
                                    'advanced-styles'
                                  )
                                if (styles instanceof HTMLDetailsElement)
                                  styles.open = true
                              }}
                              className="whitespace-nowrap underline underline-offset-4"
                            >
                              Custom CSS and HTML
                            </a>
                            .
                          </>
                        )}
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
                                ...presetPalettes(preset),
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
                              className={cn(
                                mode !== 'light' && 'text-muted-foreground'
                              )}
                              aria-pressed={mode === 'light'}
                              onClick={() => setMode('light')}
                            >
                              Light
                            </Button>
                            <Button
                              size="sm"
                              variant={mode === 'dark' ? 'secondary' : 'ghost'}
                              className={cn(
                                mode !== 'dark' && 'text-muted-foreground'
                              )}
                              aria-pressed={mode === 'dark'}
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
                                  className={cn(
                                    'h-7 w-8 shrink-0 cursor-pointer border-0 bg-transparent p-0',
                                    colorSwatchClassName
                                  )}
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
                                    className={cn(
                                      'h-7 w-8 shrink-0 cursor-pointer border-0 bg-transparent p-0',
                                      colorSwatchClassName
                                    )}
                                  />
                                </label>
                              ))}
                          </div>
                        </details>
                      </div>
                      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            Start over with Flare&apos;s theme
                          </p>
                          <p className="text-pretty text-sm text-muted-foreground">
                            Reset the palettes, typeface, background, corners,
                            and classic colors for everyone.
                          </p>
                        </div>
                        <AlertDialog
                          open={resetOpen}
                          onOpenChange={setResetOpen}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              className="shrink-0"
                              disabled={busy || themeResetBlocked}
                            >
                              <RotateCcw aria-hidden="true" />
                              Reset to Flare defaults
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Reset the theme to Flare&apos;s defaults?
                              </AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-2">
                                  <p>
                                    This publishes right away. Everyone sees
                                    Flare&apos;s default palettes, typeface,
                                    background, and corners, and the classic
                                    colors return to their defaults.
                                  </p>
                                  <p>
                                    Your identity, logos, sharing choices,
                                    favicon, and custom CSS stay as they are.
                                    Choose Restore previous afterwards to bring
                                    back the current studio theme; customized
                                    classic colors can&apos;t be restored.
                                  </p>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={busy}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                disabled={busy || themeResetBlocked}
                                onClick={(event) => {
                                  event.preventDefault()
                                  void act({
                                    action: 'reset-theme',
                                    revision: state.revision,
                                  }).then(() => setResetOpen(false))
                                }}
                              >
                                {busy && (
                                  <Loader2
                                    className="animate-spin"
                                    aria-hidden="true"
                                  />
                                )}
                                Reset theme
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                                ? 'border-primary bg-primary/5'
                                : 'hover:border-primary/50'
                            )}
                            onClick={() =>
                              change('sharing', { defaultStyle: style.value })
                            }
                          >
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-muted/30">
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
                          description="Include the uploader’s name and avatar on the page, and attribution in embeds."
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
                          description="Display the name in the page heading and embeds."
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
                        <SettingRow
                          label="Show expiration"
                          description="Tell visitors how long a file with a scheduled expiration has left."
                        >
                          <Switch
                            aria-label="Show expiration"
                            checked={document.sharing.showExpiry}
                            onCheckedChange={(showExpiry) =>
                              change('sharing', { showExpiry })
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
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These controls change presentation. Existing URLs and
                        downloaded files can still contain their original names.
                        File access stays governed by visibility and passwords.
                      </p>
                    </CardContent>
                  </>
                )}
                {section === 'embeds' && (
                  <>
                    <CardHeader>
                      <CardTitle>Decide how links unfold</CardTitle>
                      <CardDescription>
                        What chat apps and social networks show when someone
                        pastes a link to a file.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <EmbedModePicker
                        label="Embed mode"
                        options={EMBED_MODE_OPTIONS}
                        value={document.sharing.embedMode}
                        onChange={(embedMode) =>
                          change('sharing', { embedMode })
                        }
                      />
                      <EmbedCardFields
                        value={instanceEmbedCard(document.sharing)}
                        onChange={(key, value) =>
                          change('sharing', {
                            [EMBED_CARD_FIELDS[key]]: value,
                          })
                        }
                      />
                      <div className="border-t">
                        <SettingRow
                          label="Let people design their own"
                          description="Accounts can choose their own mode and card in Profile. Turn this off to use this embed for every link."
                        >
                          <Switch
                            aria-label="Let people design their own"
                            checked={document.sharing.personalEmbeds}
                            onCheckedChange={(personalEmbeds) =>
                              change('sharing', { personalEmbeds })
                            }
                          />
                        </SettingRow>
                      </div>
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
                      <div className="space-y-4 rounded-xl border-2 border-dashed border-control bg-muted/20 p-7 text-center">
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
                          tabIndex={-1}
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
                      {/* An inset like the others in settings: title and
                          description as one group, then the action. */}
                      <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            Take this appearance with you
                          </p>
                          <p className="text-pretty text-sm text-muted-foreground">
                            Export the design you are previewing: identity,
                            embedded logos, both palettes, surfaces, share-page
                            choices and embeds.
                          </p>
                        </div>
                        <Button variant="outline" onClick={exportPack}>
                          <Download aria-hidden="true" />
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
                {section === 'embeds' ? (
                  <EmbedPreview
                    mode={document.sharing.embedMode}
                    card={instanceEmbedCard(document.sharing)}
                    appearance={document}
                  />
                ) : (
                  <AppearancePreview
                    document={document}
                    creditsFooter={creditsFooter}
                    mode={mode}
                    onModeChange={setMode}
                    protectedPreview={protectedPreview}
                    onProtectedChange={setProtectedPreview}
                  />
                )}
              </div>
            </div>
          </div>
          <SaveBar
            tone={dirty ? 'unsaved' : state.draft ? 'draft' : 'saved'}
            title={
              dirty
                ? 'Unsaved changes'
                : state.draft
                  ? 'Draft saved · ready to preview'
                  : 'Published appearance'
            }
            description={
              dirty || state.draft
                ? 'Your live instance stays the same until you publish.'
                : `Revision ${state.revision}${
                    !state.publishedAt
                      ? ' · Original Flare appearance'
                      : hydrated
                        ? ` · Published ${new Date(state.publishedAt).toLocaleDateString()}`
                        : ' · Published'
                  }`
            }
          >
            {state.previous && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act({ action: 'restore', revision: state.revision })
                }
              >
                <RotateCcw aria-hidden="true" />
                Restore previous
              </Button>
            )}
            {(dirty || state.draft) && (
              <Button
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
              <Save aria-hidden="true" />
              Save draft
            </Button>
            <Button
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
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              Publish appearance
            </Button>
          </SaveBar>
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
