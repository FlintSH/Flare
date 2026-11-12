'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { BuildInfo } from '@/types/dto/updates'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import CodeMirror from '@uiw/react-codemirror'
import DOMPurify from 'dompurify'
import { deepEqual } from 'fast-equals'
import {
  BookOpen,
  Circle,
  Code,
  FileCode,
  Github,
  HardDrive,
  Heart,
  InfoIcon,
  Mail,
  Palette,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { createPortal } from 'react-dom'

import { CustomizationStudio } from '@/components/customization/customization-studio'
import { RecoveryLink } from '@/components/customization/recovery-link'
import { EmailSettings } from '@/components/email/email-settings'
import {
  PreferencesPanel,
  PreferencesShell,
} from '@/components/preferences/preferences-shell'
import { InstanceVersion } from '@/components/settings/instance-version'
import { numberFieldClassName } from '@/components/shared/form-styles'
import { Icons } from '@/components/shared/icons'
import { SaveBar } from '@/components/shared/save-bar'
import { ThemeCustomizer } from '@/components/theme/theme-customizer'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { apiRequest } from '@/lib/client/request'
import type { FlareConfig } from '@/lib/config'
import {
  FAVICON_TYPE,
  faviconProblem,
  faviconUrl,
} from '@/lib/customization/favicon'
import { CLASSIC_PALETTE } from '@/lib/customization/legacy-appearance'
import type { CustomizationState } from '@/lib/customization/schema'
import { getDocumentationUrl } from '@/lib/documentation'
import { CUSTOM_STYLES_PERMISSION } from '@/lib/permissions/settings'
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ALIASES,
} from '@/lib/preferences/navigation'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'
import { usePreferenceSection } from '@/hooks/use-preference-section'
import { useToast } from '@/hooks/use-toast'

interface ColorConfig {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  border: string
  input: string
  ring: string
}

type SettingValue<T extends keyof FlareConfig['settings']> = Partial<
  FlareConfig['settings'][T]
>

const isSafeUrl = (url: string | null): url is string => {
  if (!url) return false
  return url.startsWith('blob:') && /^blob:https?:\/\//.test(url)
}

function ChangeIndicator() {
  return (
    <div className="flex items-center">
      <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />
    </div>
  )
}

export function InstanceSettings({
  initialConfig,
  initialSection,
  buildInfo,
  recovery = false,
  initialEveryoneCanInvite = false,
}: {
  initialConfig: FlareConfig
  initialSection: (typeof SETTINGS_SECTIONS)[number]
  buildInfo: BuildInfo
  recovery?: boolean
  initialEveryoneCanInvite?: boolean
}) {
  const { can } = usePermissions()
  const [activeSection, setSection] = usePreferenceSection(
    SETTINGS_SECTIONS,
    initialSection,
    SETTINGS_SECTION_ALIASES
  )
  const [studioDirty, setStudioDirty] = useState(false)
  // A save finishing after a reset would put the old classic colors back in
  // savedConfig, so the two never run at once.
  const [themeResetting, setThemeResetting] = useState(false)
  const handleStudioStateChange = useCallback(
    (customization: CustomizationState) => {
      setSavedConfig((previous) => ({
        ...previous,
        settings: { ...previous.settings, customization },
      }))
      setWorkingConfig((previous) => ({
        ...previous,
        settings: { ...previous.settings, customization },
      }))
    },
    []
  )
  const { toast } = useToast()
  const router = useRouter()
  const [savedConfig, setSavedConfig] = useState<FlareConfig>(initialConfig)
  const [workingConfig, setWorkingConfig] = useState<FlareConfig>(() =>
    structuredClone(initialConfig)
  )
  // The studio's theme reset also returns the classic colors to Flare's
  // defaults on the server; show that here without a reload.
  const handleThemeReset = useCallback(() => {
    const reset = (config: FlareConfig): FlareConfig => ({
      ...config,
      settings: {
        ...config.settings,
        appearance: {
          ...config.settings.appearance,
          theme: 'dark',
          customColors: { ...CLASSIC_PALETTE },
        },
      },
    })
    setSavedConfig(reset)
    setWorkingConfig(reset)
  }, [])
  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(
    null
  )
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null
  )
  // Remove marks the saved favicon for removal; saving deletes it.
  const [faviconRemoval, setFaviconRemoval] = useState(false)

  const [cssEditorOpen, setCssEditorOpen] = useState(false)
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Stored on the Everyone role, not in the config document.
  const [savedEveryoneCanInvite, setSavedEveryoneCanInvite] = useState(
    initialEveryoneCanInvite
  )
  const [everyoneCanInvite, setEveryoneCanInvite] = useState(
    initialEveryoneCanInvite
  )
  const inviteAccessChanged = everyoneCanInvite !== savedEveryoneCanInvite

  const hasChanges =
    !deepEqual(savedConfig, workingConfig) ||
    pendingFaviconFile !== null ||
    faviconRemoval ||
    inviteAccessChanged

  function changedFields(previous: unknown, next: unknown): unknown {
    if (deepEqual(previous, next)) return undefined
    if (!next || typeof next !== 'object' || Array.isArray(next)) return next
    const before = (previous ?? {}) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(next)
        .map(([key, value]) => [key, changedFields(before[key], value)])
        .filter(([, value]) => value !== undefined)
    )
  }

  const saveChanges = async () => {
    const snapshot = structuredClone(workingConfig)
    let saved = savedConfig
    try {
      setIsSaving(true)
      if (pendingFaviconFile || faviconRemoval) {
        // The upload or removal saved the favicon's address; record it, never
        // send it.
        let favicon: string | null = null
        if (pendingFaviconFile) {
          const formData = new FormData()
          formData.append('file', pendingFaviconFile)
          ;({ url: favicon } = await apiRequest<{ url: string }>(
            '/api/settings/favicon',
            {
              body: formData,
              fallback: 'Failed to upload favicon',
              whole: true,
            }
          ))
        } else {
          await apiRequest('/api/settings/favicon', {
            method: 'DELETE',
            fallback: 'Failed to remove favicon',
          })
        }
        const withFavicon = (config: FlareConfig): FlareConfig => ({
          ...config,
          settings: {
            ...config.settings,
            appearance: { ...config.settings.appearance, favicon },
          },
        })
        snapshot.settings.appearance.favicon = favicon
        saved = withFavicon(saved)
        setSavedConfig(withFavicon)
        setWorkingConfig(withFavicon)
        setPendingFaviconFile(null)
        setFaviconPreviewUrl(null)
        setFaviconRemoval(false)
      }
      const settings = changedFields(saved.settings, snapshot.settings)
      if (settings !== undefined) {
        await apiRequest('/api/settings', {
          method: 'PATCH',
          body: { settings },
          fallback: 'Settings could not be saved.',
        })
        // Appearance publication and email own their own saves. Preserve any
        // changes they completed while the general settings request was running.
        setSavedConfig((previous) => ({
          ...snapshot,
          settings: {
            ...snapshot.settings,
            customization: previous.settings.customization,
            email: previous.settings.email,
          },
        }))
      }
      if (inviteAccessChanged) {
        const requested = everyoneCanInvite
        await apiRequest('/api/settings/invites', {
          method: 'PUT',
          body: { everyoneCanInvite: requested },
          fallback: 'Who can create invites could not be saved.',
        })
        setSavedEveryoneCanInvite(requested)
      }
      router.refresh()
      toast({
        title: 'Settings updated',
        description: 'Your instance settings are saved.',
      })
    } catch (error) {
      toast({
        title: 'Settings could not be saved',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(
    () => () => {
      if (faviconPreviewUrl) URL.revokeObjectURL(faviconPreviewUrl)
    },
    [faviconPreviewUrl]
  )

  const discardChanges = () => {
    if (!savedConfig) return

    if (faviconPreviewUrl) {
      URL.revokeObjectURL(faviconPreviewUrl)
      setFaviconPreviewUrl(null)
    }

    setPendingFaviconFile(null)
    setFaviconRemoval(false)

    setWorkingConfig(structuredClone(savedConfig))
    setEveryoneCanInvite(savedEveryoneCanInvite)

    toast({
      title: 'Changes discarded',
      description: 'All changes have been reverted to the saved state.',
    })
  }

  const handleSettingChange = useCallback(
    <T extends keyof FlareConfig['settings']>(
      section: T,
      value: SettingValue<T>
    ) => {
      setWorkingConfig((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          [section]: { ...previous.settings[section], ...value },
        },
      }))
    },
    []
  )

  const isFieldChanged = useCallback(
    <T extends keyof FlareConfig['settings']>(
      section: T,
      fieldPath: string[]
    ): boolean => {
      if (!savedConfig || !workingConfig) return false

      let savedValue: unknown = savedConfig.settings[section]
      let workingValue: unknown = workingConfig.settings[section]

      for (const field of fieldPath) {
        if (
          typeof savedValue !== 'object' ||
          savedValue === null ||
          typeof workingValue !== 'object' ||
          workingValue === null
        ) {
          return false
        }

        savedValue = (savedValue as Record<string, unknown>)[field]
        workingValue = (workingValue as Record<string, unknown>)[field]
      }

      return !deepEqual(savedValue, workingValue)
    },
    [savedConfig, workingConfig]
  )

  const handleStorageQuotaChange = (value: string) => {
    if (!workingConfig?.settings?.general?.storage) return
    const numValue = Number.parseInt(value)
    if (Number.isNaN(numValue)) return

    handleSettingChange('general', {
      storage: {
        ...workingConfig.settings.general.storage,
        quotas: {
          ...workingConfig.settings.general.storage.quotas,
          default: {
            ...workingConfig.settings.general.storage.quotas.default,
            value: numValue,
          },
        },
      },
    })
  }

  const handleMaxUploadSizeChange = (value: string) => {
    if (!workingConfig?.settings?.general?.storage) return
    const numValue = Number.parseInt(value)
    if (Number.isNaN(numValue)) return

    handleSettingChange('general', {
      storage: {
        ...workingConfig.settings.general.storage,
        maxUploadSize: {
          ...workingConfig.settings.general.storage.maxUploadSize,
          value: numValue,
        },
      },
    })
  }

  const handleCustomColorsChange = (colors: Partial<ColorConfig>) => {
    handleSettingChange('appearance', {
      customColors: {
        ...workingConfig.settings.appearance.customColors,
        ...colors,
      },
    })
  }

  const hasFaviconChanged = useCallback(() => {
    return pendingFaviconFile !== null || faviconRemoval
  }, [pendingFaviconFile, faviconRemoval])
  const savedFavicon = faviconUrl(workingConfig.settings.appearance.favicon)
  const shownFavicon = isSafeUrl(faviconPreviewUrl)
    ? DOMPurify.sanitize(faviconPreviewUrl)
    : faviconRemoval
      ? null
      : savedFavicon

  const getFieldClasses = (
    section: keyof FlareConfig['settings'],
    fieldPath: string[]
  ) => {
    const isChanged = isFieldChanged(section, fieldPath)
    return isChanged ? 'border-primary ring-1 ring-primary bg-primary/5' : ''
  }

  const sections = [
    {
      id: 'general',
      title: 'General',
      hint: 'Features, credits, and version',
      description:
        'Manage everyday features and keep your instance up to date.',
      icon: Settings2,
      dirty:
        !deepEqual(
          savedConfig.settings.general.ocr,
          workingConfig.settings.general.ocr
        ) ||
        !deepEqual(
          savedConfig.settings.general.credits,
          workingConfig.settings.general.credits
        ),
    },
    {
      id: 'access',
      title: 'Access',
      hint: 'Registration and sign-in',
      description: 'Choose who can join and how they sign in.',
      icon: ShieldCheck,
      dirty:
        inviteAccessChanged ||
        !deepEqual(
          savedConfig.settings.general.registrations,
          workingConfig.settings.general.registrations
        ) ||
        !deepEqual(
          savedConfig.settings.general.oidc,
          workingConfig.settings.general.oidc
        ),
    },
    {
      id: 'storage',
      title: 'Storage',
      hint: 'Storage, limits, and quotas',
      description: 'A home for your files, with limits that fit your server.',
      icon: HardDrive,
      dirty: !deepEqual(
        savedConfig.settings.general.storage,
        workingConfig.settings.general.storage
      ),
    },
    {
      id: 'appearance',
      title: 'Appearance',
      hint: 'Branding, themes, and custom styles',
      description:
        'Shape your instance with branding, themes, sharing, and custom styles.',
      icon: Palette,
      dirty:
        studioDirty ||
        !deepEqual(
          savedConfig.settings.appearance,
          workingConfig.settings.appearance
        ) ||
        hasFaviconChanged() ||
        !deepEqual(
          savedConfig.settings.advanced,
          workingConfig.settings.advanced
        ),
    },
    {
      id: 'email',
      title: 'Email',
      hint: 'Recovery and verification',
      description:
        'Account recovery and verification, delivered by your mail provider.',
      icon: Mail,
    },
  ] as const
  const changedSettingsGroups = sections
    .filter(
      (section) =>
        'dirty' in section &&
        section.dirty &&
        (section.id !== 'appearance' ||
          hasFaviconChanged() ||
          !deepEqual(
            savedConfig.settings.advanced,
            workingConfig.settings.advanced
          ) ||
          !deepEqual(
            savedConfig.settings.appearance,
            workingConfig.settings.appearance
          ))
    )
    .map((section) => section.title)
  return (
    <PreferencesShell
      eyebrow="Your instance"
      title="Settings"
      description="Make Flare feel at home. Everything you manage for your instance lives here."
      sections={sections}
      activeSection={activeSection}
      onSectionChange={setSection}
      actions={
        <Button variant="outline" asChild>
          <a
            href={getDocumentationUrl(buildInfo)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen aria-hidden="true" />
            Documentation
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      }
      asideNote="These settings apply to everyone on your instance. Personal preferences live in Profile."
    >
      {recovery && activeSection !== 'appearance' && (
        <Alert variant="info" role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            Appearance recovery is active. Custom CSS and head HTML are disabled
            on this page.{' '}
            <RecoveryLink
              href="/dashboard/settings?section=appearance"
              className="underline underline-offset-4"
            >
              Return to your live appearance
            </RecoveryLink>
            .
          </AlertDescription>
        </Alert>
      )}
      <PreferencesPanel active={activeSection === 'general'}>
        {!can('settings.general') && (
          <p className="mb-4 text-sm text-muted-foreground">
            Read only. Your roles do not allow changing these settings.
          </p>
        )}
        <fieldset disabled={!can('settings.general')}>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Image search</CardTitle>
                <CardDescription className="text-pretty">
                  Find your images by the words inside them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label>Background OCR processing</Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Enable OCR to allow searching through text content in
                      uploaded images.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFieldChanged('general', ['ocr', 'enabled']) && (
                      <ChangeIndicator />
                    )}
                    <Switch
                      aria-label="Background OCR processing"
                      checked={workingConfig.settings.general.ocr.enabled}
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          ocr: { enabled: checked },
                        })
                      }
                      className={getFieldClasses('general', ['ocr', 'enabled'])}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Credits</CardTitle>
                <CardDescription className="text-pretty">
                  Manage footer credits visibility.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label>Show credits footer</Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Display Flare credits in the footer.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFieldChanged('general', ['credits', 'showFooter']) && (
                      <ChangeIndicator />
                    )}
                    <Switch
                      aria-label="Show credits footer"
                      checked={
                        workingConfig.settings.general.credits.showFooter
                      }
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          credits: { showFooter: checked },
                        })
                      }
                      className={getFieldClasses('general', [
                        'credits',
                        'showFooter',
                      ])}
                    />
                  </div>
                </div>

                <Alert variant="info" role="status">
                  <InfoIcon aria-hidden="true" />
                  <AlertDescription>
                    If you disable credits, please consider sponsoring the
                    project to support its development.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
            <Card id="instance-information" className="scroll-mt-28">
              <CardHeader>
                <CardTitle>Instance information</CardTitle>
                <CardDescription className="text-pretty">
                  View and manage your Flare instance details.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <InstanceVersion buildInfo={buildInfo} />

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://github.com/FlintSH/flare"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Github aria-hidden="true" />
                      View on GitHub
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://ko-fi.com/FlintSH"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Heart aria-hidden="true" />
                      Sponsor
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </fieldset>
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'access'}>
        {!can('settings.security') && (
          <p className="mb-4 text-sm text-muted-foreground">
            Read only. Your roles do not allow changing these settings.
          </p>
        )}
        <fieldset disabled={!can('settings.security')}>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Registration</CardTitle>
                <CardDescription className="text-pretty">
                  Decide whether your instance is open to new accounts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label>Allow registrations</Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Enable or disable new user registrations.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFieldChanged('general', [
                      'registrations',
                      'enabled',
                    ]) && <ChangeIndicator />}
                    <Switch
                      aria-label="Allow registrations"
                      checked={
                        workingConfig.settings.general.registrations.enabled
                      }
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          registrations: {
                            ...workingConfig.settings.general.registrations,
                            enabled: checked,
                          },
                        })
                      }
                      className={getFieldClasses('general', [
                        'registrations',
                        'enabled',
                      ])}
                    />
                  </div>
                </div>
                {!workingConfig.settings.general.registrations.enabled && (
                  <div className="space-y-2">
                    <Label>Registration disabled message</Label>
                    <div className="flex shrink-0 items-center gap-2">
                      <Input
                        aria-label="Registration disabled message"
                        placeholder="Registrations are currently disabled"
                        value={
                          workingConfig.settings.general.registrations
                            .disabledMessage || ''
                        }
                        onChange={(e) =>
                          handleSettingChange('general', {
                            registrations: {
                              ...workingConfig.settings.general.registrations,
                              disabledMessage: e.target.value,
                            },
                          })
                        }
                        className={getFieldClasses('general', [
                          'registrations',
                          'disabledMessage',
                        ])}
                      />
                      {isFieldChanged('general', [
                        'registrations',
                        'disabledMessage',
                      ]) && <ChangeIndicator />}
                    </div>
                    <p className="text-pretty text-sm text-muted-foreground">
                      This message will be shown to users on the login page when
                      registrations are disabled.
                    </p>
                  </div>
                )}
                {!workingConfig.settings.general.registrations.enabled && (
                  <p className="text-pretty text-sm text-muted-foreground">
                    People with an active invite link can still create an
                    account.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card id="invites" className="scroll-mt-28">
              <CardHeader>
                <CardTitle>Invites</CardTitle>
                <CardDescription className="text-pretty">
                  Invite links let people create an account, even while
                  registration is closed. Administrators can always create them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label htmlFor="everyone-can-invite">
                      Let everyone create invites
                    </Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Every account can invite people from Profile → Invites.
                      This grants Create invites to the Everyone role; use Roles
                      to allow only some people instead.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {inviteAccessChanged && <ChangeIndicator />}
                    <Switch
                      id="everyone-can-invite"
                      checked={everyoneCanInvite}
                      onCheckedChange={setEveryoneCanInvite}
                      disabled={!can('invites.create')}
                      className={
                        inviteAccessChanged
                          ? 'border-primary ring-1 ring-primary bg-primary/5'
                          : ''
                      }
                    />
                  </div>
                </div>
                {!can('invites.create') && (
                  <p className="text-xs text-muted-foreground">
                    You can change this only if your roles let you create
                    invites yourself.
                  </p>
                )}
                <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Limits for members</p>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Apply to people who can invite but cannot create accounts
                      directly. Changes affect invites created afterward.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(
                      [
                        ['activeInvites', 'Active invites per person', 1, 100],
                        ['usesPerInvite', 'Uses per invite', 1, 100],
                        ['lifetimeDays', 'Longest expiry (days)', 1, 365],
                      ] as const
                    ).map(([field, label, min, max]) => (
                      <div key={field} className="space-y-2">
                        <Label htmlFor={`invite-limit-${field}`}>{label}</Label>
                        <div className="flex shrink-0 items-center gap-2">
                          <Input
                            id={`invite-limit-${field}`}
                            type="number"
                            inputMode="numeric"
                            min={min}
                            max={max}
                            value={
                              workingConfig.settings.general.registrations
                                .inviteLimits[field]
                            }
                            onChange={(event) => {
                              const value = Number.parseInt(
                                event.target.value,
                                10
                              )
                              if (Number.isNaN(value)) return
                              handleSettingChange('general', {
                                registrations: {
                                  ...workingConfig.settings.general
                                    .registrations,
                                  inviteLimits: {
                                    ...workingConfig.settings.general
                                      .registrations.inviteLimits,
                                    [field]: Math.min(
                                      max,
                                      Math.max(min, value)
                                    ),
                                  },
                                },
                              })
                            }}
                            className={cn(
                              numberFieldClassName,
                              getFieldClasses('general', [
                                'registrations',
                                'inviteLimits',
                                field,
                              ])
                            )}
                          />
                          {isFieldChanged('general', [
                            'registrations',
                            'inviteLimits',
                            field,
                          ]) && <ChangeIndicator />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {(can('users.read') || can('roles.manage')) && (
                  <div className="flex flex-wrap gap-2">
                    {can('users.read') &&
                      (can('invites.create') || can('invites.manage')) && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href="/dashboard/users?tab=invites">
                            Review invites
                          </Link>
                        </Button>
                      )}
                    {can('roles.manage') && (
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard/roles">Manage roles</Link>
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Single sign-on (OIDC)</CardTitle>
                <CardDescription className="text-pretty">
                  Let users sign in through an external OpenID Connect identity
                  provider.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label>Enable OIDC sign-in</Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Enable or disable single sign-on with OIDC.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFieldChanged('general', ['oidc', 'enabled']) && (
                      <ChangeIndicator />
                    )}
                    <Switch
                      aria-label="Enable OIDC sign-in"
                      checked={workingConfig.settings.general.oidc.enabled}
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          oidc: {
                            ...workingConfig.settings.general.oidc,
                            enabled: checked,
                          },
                        })
                      }
                      className={getFieldClasses('general', [
                        'oidc',
                        'enabled',
                      ])}
                    />
                  </div>
                </div>

                {workingConfig.settings.general.oidc.enabled && (
                  <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                    <div className="space-y-2">
                      <Label>Issuer URL</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Issuer URL"
                          value={workingConfig.settings.general.oidc.issuer}
                          onChange={(e) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                issuer: e.target.value,
                              },
                            })
                          }
                          placeholder="https://idp.example.com"
                          className={getFieldClasses('general', [
                            'oidc',
                            'issuer',
                          ])}
                        />
                        {isFieldChanged('general', ['oidc', 'issuer']) && (
                          <ChangeIndicator />
                        )}
                      </div>
                      <p className="text-pretty text-sm text-muted-foreground">
                        Flare discovers the provider&apos;s endpoints from{' '}
                        <code>
                          {'{issuer}'}/.well-known/openid-configuration
                        </code>
                        .
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Client ID"
                          value={workingConfig.settings.general.oidc.clientId}
                          onChange={(e) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                clientId: e.target.value,
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'oidc',
                            'clientId',
                          ])}
                        />
                        {isFieldChanged('general', ['oidc', 'clientId']) && (
                          <ChangeIndicator />
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Client secret</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Client secret"
                          type="password"
                          value={
                            workingConfig.settings.general.oidc.clientSecret
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                clientSecret: e.target.value,
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'oidc',
                            'clientSecret',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'oidc',
                          'clientSecret',
                        ]) && <ChangeIndicator />}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Sign-in button text</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Sign-in button text"
                          value={workingConfig.settings.general.oidc.buttonText}
                          onChange={(e) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                buttonText: e.target.value,
                              },
                            })
                          }
                          placeholder="Sign in with SSO"
                          className={getFieldClasses('general', [
                            'oidc',
                            'buttonText',
                          ])}
                        />
                        {isFieldChanged('general', ['oidc', 'buttonText']) && (
                          <ChangeIndicator />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <Label>Auto-provision users</Label>
                        <p className="text-pretty text-sm text-muted-foreground">
                          Create a new account automatically the first time
                          someone signs in through the provider.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isFieldChanged('general', [
                          'oidc',
                          'autoProvision',
                        ]) && <ChangeIndicator />}
                        <Switch
                          aria-label="Auto-provision users"
                          checked={
                            workingConfig.settings.general.oidc.autoProvision
                          }
                          onCheckedChange={(checked) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                autoProvision: checked,
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'oidc',
                            'autoProvision',
                          ])}
                        />
                      </div>
                    </div>

                    <p className="text-pretty text-sm text-muted-foreground">
                      SSO identities are not automatically linked to existing
                      accounts by email. Existing users must use local sign-in
                      or their previously linked SSO identity.
                    </p>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <Label>Require verified email</Label>
                        <p className="text-pretty text-sm text-muted-foreground">
                          Require OIDC provider to confirm user email is
                          verified. Disable only if you trust all accounts that
                          may register with your provider.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isFieldChanged('general', [
                          'oidc',
                          'requireEmailVerified',
                        ]) && <ChangeIndicator />}
                        <Switch
                          aria-label="Require verified email"
                          checked={
                            workingConfig.settings.general.oidc
                              .requireEmailVerified
                          }
                          onCheckedChange={(checked) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                requireEmailVerified: checked,
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'oidc',
                            'requireEmailVerified',
                          ])}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <Label>OIDC auto-login</Label>
                        <p className="text-pretty text-sm text-muted-foreground">
                          Skip the login form and redirect straight to the
                          provider. Visit <code>{LOCAL_SIGN_IN_PATH}</code> to
                          reach the password login if you get locked out.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isFieldChanged('general', ['oidc', 'enforceSso']) && (
                          <ChangeIndicator />
                        )}
                        <Switch
                          aria-label="OIDC auto-login"
                          checked={
                            workingConfig.settings.general.oidc.enforceSso
                          }
                          onCheckedChange={(checked) =>
                            handleSettingChange('general', {
                              oidc: {
                                ...workingConfig.settings.general.oidc,
                                enforceSso: checked,
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'oidc',
                            'enforceSso',
                          ])}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </fieldset>
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'storage'}>
        {!can('settings.storage') && (
          <p className="mb-4 text-sm text-muted-foreground">
            Read only. Your roles do not allow changing these settings.
          </p>
        )}
        <fieldset disabled={!can('settings.storage')}>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>File storage</CardTitle>
                <CardDescription className="text-pretty">
                  Choose where uploads live and how large each file can be.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Storage provider</Label>
                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={workingConfig.settings.general.storage.provider}
                      onValueChange={(value) =>
                        handleSettingChange('general', {
                          storage: {
                            ...workingConfig.settings.general.storage,
                            provider: value as 'local' | 's3',
                          },
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label="Storage provider"
                        className={getFieldClasses('general', [
                          'storage',
                          'provider',
                        ])}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local storage</SelectItem>
                        <SelectItem value="s3">S3 storage</SelectItem>
                      </SelectContent>
                    </Select>
                    {isFieldChanged('general', ['storage', 'provider']) && (
                      <ChangeIndicator />
                    )}
                  </div>
                </div>
                {workingConfig.settings.general.storage.provider === 's3' && (
                  <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                    <div className="space-y-2">
                      <Label>S3 bucket</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="S3 bucket"
                          value={
                            workingConfig.settings.general.storage.s3.bucket
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  bucket: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="my-bucket"
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'bucket',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'bucket',
                        ]) && <ChangeIndicator />}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Region</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Region"
                          value={
                            workingConfig.settings.general.storage.s3.region
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  region: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="us-east-1"
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'region',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'region',
                        ]) && <ChangeIndicator />}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Access key ID</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Access key ID"
                          type="password"
                          value={
                            workingConfig.settings.general.storage.s3
                              .accessKeyId
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  accessKeyId: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="AKIAXXXXXXXXXXXXXXXX"
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'accessKeyId',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'accessKeyId',
                        ]) && <ChangeIndicator />}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Secret access key</Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Secret access key"
                          type="password"
                          value={
                            workingConfig.settings.general.storage.s3
                              .secretAccessKey
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  secretAccessKey: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'secretAccessKey',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'secretAccessKey',
                        ]) && <ChangeIndicator />}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Custom endpoint{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          aria-label="Custom endpoint (optional)"
                          value={
                            workingConfig.settings.general.storage.s3
                              .endpoint || ''
                          }
                          onChange={(e) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  endpoint: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="https://s3.custom-domain.com"
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'endpoint',
                          ])}
                        />
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'endpoint',
                        ]) && <ChangeIndicator />}
                      </div>
                      <p className="text-pretty text-sm text-muted-foreground">
                        For S3-compatible services like MinIO or DigitalOcean
                        Spaces.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <Label>Force path style</Label>
                        <p className="text-pretty text-sm text-muted-foreground">
                          Enable this for S3-compatible services that require
                          path-style URLs.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isFieldChanged('general', [
                          'storage',
                          's3',
                          'forcePathStyle',
                        ]) && <ChangeIndicator />}
                        <Switch
                          aria-label="Force path style"
                          checked={
                            workingConfig.settings.general.storage.s3
                              .forcePathStyle
                          }
                          onCheckedChange={(checked) =>
                            handleSettingChange('general', {
                              storage: {
                                ...workingConfig.settings.general.storage,
                                s3: {
                                  ...workingConfig.settings.general.storage.s3,
                                  forcePathStyle: checked,
                                },
                              },
                            })
                          }
                          className={getFieldClasses('general', [
                            'storage',
                            's3',
                            'forcePathStyle',
                          ])}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Maximum upload size</Label>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="Maximum upload size"
                        type="number"
                        inputMode="numeric"
                        value={
                          workingConfig.settings.general.storage.maxUploadSize
                            .value
                        }
                        onChange={(e) =>
                          handleMaxUploadSizeChange(e.target.value)
                        }
                        placeholder="10"
                        className={cn(
                          numberFieldClassName,
                          getFieldClasses('general', [
                            'storage',
                            'maxUploadSize',
                            'value',
                          ])
                        )}
                      />
                      {isFieldChanged('general', [
                        'storage',
                        'maxUploadSize',
                        'value',
                      ]) && <ChangeIndicator />}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Select
                        value={
                          workingConfig.settings.general.storage.maxUploadSize
                            .unit
                        }
                        onValueChange={(value) =>
                          handleSettingChange('general', {
                            storage: {
                              ...workingConfig.settings.general.storage,
                              maxUploadSize: {
                                ...workingConfig.settings.general.storage
                                  .maxUploadSize,
                                unit: value as 'MB' | 'GB',
                              },
                            },
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Maximum upload size unit"
                          className={cn(
                            numberFieldClassName,
                            getFieldClasses('general', [
                              'storage',
                              'maxUploadSize',
                              'unit',
                            ])
                          )}
                        >
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MB">MB</SelectItem>
                          <SelectItem value="GB">GB</SelectItem>
                        </SelectContent>
                      </Select>
                      {isFieldChanged('general', [
                        'storage',
                        'maxUploadSize',
                        'unit',
                      ]) && <ChangeIndicator />}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Storage quotas</CardTitle>
                <CardDescription className="text-pretty">
                  Set a fair amount of space for each account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label>User quotas</Label>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Enable storage limits per user.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFieldChanged('general', [
                      'storage',
                      'quotas',
                      'enabled',
                    ]) && <ChangeIndicator />}
                    <Switch
                      aria-label="User quotas"
                      checked={
                        workingConfig.settings.general.storage.quotas.enabled
                      }
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          storage: {
                            ...workingConfig.settings.general.storage,
                            quotas: {
                              ...workingConfig.settings.general.storage.quotas,
                              enabled: checked,
                            },
                          },
                        })
                      }
                      className={getFieldClasses('general', [
                        'storage',
                        'quotas',
                        'enabled',
                      ])}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Data quota per user</Label>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="Data quota per user"
                        type="number"
                        inputMode="numeric"
                        value={
                          workingConfig.settings.general.storage.quotas.default
                            .value
                        }
                        onChange={(e) =>
                          handleStorageQuotaChange(e.target.value)
                        }
                        placeholder="500"
                        className={cn(
                          numberFieldClassName,
                          getFieldClasses('general', [
                            'storage',
                            'quotas',
                            'default',
                            'value',
                          ])
                        )}
                      />
                      {isFieldChanged('general', [
                        'storage',
                        'quotas',
                        'default',
                        'value',
                      ]) && <ChangeIndicator />}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Select
                        value={
                          workingConfig.settings.general.storage.quotas.default
                            .unit
                        }
                        onValueChange={(value) =>
                          handleSettingChange('general', {
                            storage: {
                              ...workingConfig.settings.general.storage,
                              quotas: {
                                ...workingConfig.settings.general.storage
                                  .quotas,
                                default: {
                                  ...workingConfig.settings.general.storage
                                    .quotas.default,
                                  unit: value as 'MB' | 'GB',
                                },
                              },
                            },
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Data quota per user unit"
                          className={cn(
                            numberFieldClassName,
                            getFieldClasses('general', [
                              'storage',
                              'quotas',
                              'default',
                              'unit',
                            ])
                          )}
                        >
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MB">MB</SelectItem>
                          <SelectItem value="GB">GB</SelectItem>
                        </SelectContent>
                      </Select>
                      {isFieldChanged('general', [
                        'storage',
                        'quotas',
                        'default',
                        'unit',
                      ]) && <ChangeIndicator />}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </fieldset>
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'appearance'}>
        {can('appearance.manage') ? (
          <div>
            <div className="space-y-6">
              <CustomizationStudio
                initialState={initialConfig.settings.customization}
                creditsFooter={savedConfig.settings.general.credits.showFooter}
                recovery={recovery}
                onStateChange={handleStudioStateChange}
                onDirtyChange={setStudioDirty}
                onThemeReset={handleThemeReset}
                onThemeResetPending={setThemeResetting}
                themeResetBlocked={isSaving}
              />
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="space-y-1.5">
                    <CardTitle>Favicon</CardTitle>
                    <CardDescription className="text-pretty">
                      Upload a custom favicon for your instance, or remove it to
                      use Flare&apos;s icon.
                    </CardDescription>
                  </div>
                  {hasFaviconChanged() && <ChangeIndicator />}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <img
                        src={shownFavicon ?? '/icon.svg'}
                        alt=""
                        className="h-6 w-6 shrink-0"
                      />
                      <span className="truncate text-sm text-muted-foreground">
                        {faviconPreviewUrl
                          ? 'New favicon (unsaved)'
                          : faviconRemoval
                            ? 'Flare icon (unsaved)'
                            : savedFavicon
                              ? 'Current favicon'
                              : 'Flare icon'}
                      </span>
                    </div>
                    {shownFavicon && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        aria-label="Remove favicon"
                        onClick={() => {
                          if (faviconPreviewUrl)
                            URL.revokeObjectURL(faviconPreviewUrl)
                          setFaviconPreviewUrl(null)
                          setPendingFaviconFile(null)
                          setFaviconRemoval(savedFavicon !== null)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-center w-full">
                      <label className="relative flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-control bg-muted/20 transition-colors hover:border-primary hover:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <Upload className="h-8 w-8 mb-2 text-muted-foreground" />
                          <p className="text-pretty text-sm text-muted-foreground">
                            Upload favicon
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            PNG up to 1 MB
                          </p>
                        </div>
                        <input
                          type="file"
                          disabled={isSaving}
                          className="sr-only"
                          aria-label="Upload favicon"
                          accept={FAVICON_TYPE}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            // Lets the same file be chosen again after Remove.
                            e.target.value = ''
                            if (!file) return

                            const problem = faviconProblem(file)
                            if (problem) {
                              toast({
                                title: problem.title,
                                description: problem.message,
                                variant: 'destructive',
                              })
                              return
                            }

                            try {
                              if (faviconPreviewUrl) {
                                URL.revokeObjectURL(faviconPreviewUrl)
                              }

                              const previewUrl = URL.createObjectURL(file)
                              setFaviconPreviewUrl(previewUrl)

                              setPendingFaviconFile(file)
                              setFaviconRemoval(false)

                              toast({
                                title: 'Favicon changed',
                                description:
                                  'Save your changes to apply the new favicon.',
                              })
                            } catch (error) {
                              console.error('Failed to handle favicon:', error)
                              toast({
                                title: 'Failed to update favicon',
                                description: 'Please try again.',
                                variant: 'destructive',
                              })
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <details
                className="rounded-xl border bg-card p-5"
                id="classic-colors"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  Classic color controls
                </summary>
                <p className="my-4 text-sm text-muted-foreground">
                  {workingConfig.settings.customization.published.theme.enabled
                    ? 'Your published studio theme currently controls the colors. Turn off Use studio theme and publish to use these controls.'
                    : 'The original Flare palette is active. Use these controls for a single palette, or enable the studio theme above for paired light and dark designs.'}
                </p>
                <fieldset
                  disabled={
                    workingConfig.settings.customization.published.theme.enabled
                  }
                  className="min-w-0 disabled:opacity-50"
                >
                  <ThemeCustomizer
                    livePreview={false}
                    onColorChange={handleCustomColorsChange}
                    initialColors={
                      workingConfig.settings.appearance.customColors
                    }
                  />
                </fieldset>
                <p className="mt-4 text-xs text-muted-foreground">
                  Color edits apply when you save settings. Appearance drafts
                  and packs are published separately above.
                </p>
              </details>
              {can(CUSTOM_STYLES_PERMISSION) && (
                <details
                  id="advanced-styles"
                  className="scroll-mt-28 rounded-xl border bg-card p-5"
                >
                  <summary className="cursor-pointer text-sm font-medium">
                    Custom CSS and HTML
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add your own styles and head content. These changes apply
                    when you save settings.
                  </p>
                  <div className="mt-5 space-y-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Custom styling</CardTitle>
                        <CardDescription className="text-pretty">
                          Add custom CSS to your instance.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex shrink-0 items-center gap-2">
                              <Label>Custom CSS</Label>
                              {isFieldChanged('advanced', ['customCSS']) && (
                                <ChangeIndicator />
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCssEditorOpen(!cssEditorOpen)}
                            >
                              <Code aria-hidden="true" />
                              {cssEditorOpen ? 'Close editor' : 'Open editor'}
                            </Button>
                          </div>
                          {cssEditorOpen && (
                            <Card
                              className={`mt-4 rounded-xl ${isFieldChanged('advanced', ['customCSS']) ? 'border-primary' : ''}`}
                            >
                              <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                  <CardTitle>Custom CSS editor</CardTitle>
                                  <CardDescription className="text-pretty">
                                    Add custom CSS to customize your instance.
                                  </CardDescription>
                                </div>
                                {isFieldChanged('advanced', ['customCSS']) && (
                                  <ChangeIndicator />
                                )}
                              </CardHeader>
                              <CardContent>
                                <CodeMirror
                                  value={
                                    workingConfig.settings.advanced.customCSS
                                  }
                                  height="200px"
                                  extensions={[css()]}
                                  onChange={(value) => {
                                    handleSettingChange('advanced', {
                                      customCSS: value,
                                    })
                                  }}
                                  theme="dark"
                                  className="border rounded-md"
                                />
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>HTML head content</CardTitle>
                        <CardDescription className="text-pretty">
                          Add custom HTML to the head section.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex shrink-0 items-center gap-2">
                              <Label>Custom HTML</Label>
                              {isFieldChanged('advanced', ['customHead']) && (
                                <ChangeIndicator />
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setHtmlEditorOpen(!htmlEditorOpen)}
                            >
                              <FileCode aria-hidden="true" />
                              {htmlEditorOpen ? 'Close editor' : 'Open editor'}
                            </Button>
                          </div>
                          {htmlEditorOpen && (
                            <Card
                              className={`mt-4 rounded-xl ${isFieldChanged('advanced', ['customHead']) ? 'border-primary' : ''}`}
                            >
                              <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                  <CardTitle>Custom HTML editor</CardTitle>
                                  <CardDescription className="text-pretty">
                                    Add custom HTML to the head of your
                                    instance.
                                  </CardDescription>
                                </div>
                                {isFieldChanged('advanced', ['customHead']) && (
                                  <ChangeIndicator />
                                )}
                              </CardHeader>
                              <CardContent>
                                <CodeMirror
                                  value={
                                    workingConfig.settings.advanced.customHead
                                  }
                                  height="200px"
                                  extensions={[html()]}
                                  onChange={(value) => {
                                    handleSettingChange('advanced', {
                                      customHead: value,
                                    })
                                  }}
                                  theme="dark"
                                  className="border rounded-md"
                                />
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </details>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
            Your roles allow viewing instance settings. Ask an administrator for
            access to appearance settings.
          </p>
        )}
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'email'}>
        {can('settings.email') ? (
          <div>
            <EmailSettings />
          </div>
        ) : (
          <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
            Your roles allow viewing instance settings. Ask an administrator for
            access to email settings.
          </p>
        )}
      </PreferencesPanel>

      {hasChanges &&
        createPortal(
          <SaveBar
            role="status"
            tone="unsaved"
            title="You have unsaved instance settings"
            description={`${changedSettingsGroups.join(', ')}${hasFaviconChanged() ? ' · Favicon' : ''}`}
            className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-3xl bg-overlay shadow-xl shadow-black/20 dark:shadow-black/60"
          >
            <Button
              variant="outline"
              onClick={discardChanges}
              disabled={isSaving || themeResetting}
            >
              <XCircle aria-hidden="true" />
              Discard
            </Button>
            <Button onClick={saveChanges} disabled={isSaving || themeResetting}>
              {isSaving ? (
                <Icons.spinner className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {isSaving ? 'Saving…' : 'Save settings'}
            </Button>
          </SaveBar>,
          document.body
        )}
    </PreferencesShell>
  )
}
