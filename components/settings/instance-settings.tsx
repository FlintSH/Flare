'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import type { BuildInfo } from '@/types/dto/updates'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import CodeMirror from '@uiw/react-codemirror'
import DOMPurify from 'dompurify'
import { deepEqual } from 'fast-equals'
import {
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
import { Icons } from '@/components/shared/icons'
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

import type { FlareConfig } from '@/lib/config'
import type { CustomizationState } from '@/lib/customization/schema'
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ALIASES,
} from '@/lib/preferences/navigation'

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

export function InstanceSettings({
  initialConfig,
  initialSection,
  buildInfo,
  recovery = false,
}: {
  initialConfig: FlareConfig
  initialSection: (typeof SETTINGS_SECTIONS)[number]
  buildInfo: BuildInfo
  recovery?: boolean
}) {
  const [activeSection, setSection] = usePreferenceSection(
    SETTINGS_SECTIONS,
    initialSection,
    SETTINGS_SECTION_ALIASES
  )
  const [studioDirty, setStudioDirty] = useState(false)
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
  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(
    null
  )
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null
  )

  const [cssEditorOpen, setCssEditorOpen] = useState(false)
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const hasChanges =
    !deepEqual(savedConfig, workingConfig) || pendingFaviconFile !== null

  const saveChanges = async () => {
    const snapshot = structuredClone(workingConfig)
    try {
      setIsSaving(true)
      if (pendingFaviconFile) {
        const formData = new FormData()
        formData.append('file', pendingFaviconFile)
        const upload = await fetch('/api/settings/favicon', {
          method: 'POST',
          body: formData,
        })
        if (!upload.ok) throw new Error('Failed to upload favicon')
        snapshot.settings.appearance.favicon = '/api/favicon'
        setWorkingConfig((previous) => ({
          ...previous,
          settings: {
            ...previous.settings,
            appearance: {
              ...previous.settings.appearance,
              favicon: '/api/favicon',
            },
          },
        }))
        setPendingFaviconFile(null)
        setFaviconPreviewUrl(null)
      }
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Settings could not be saved.')
      }
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

    setWorkingConfig(structuredClone(savedConfig))

    toast({
      title: 'Changes discarded',
      description: 'All changes have been reverted to the saved state',
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
    return pendingFaviconFile !== null
  }, [pendingFaviconFile])

  const getFieldClasses = (
    section: keyof FlareConfig['settings'],
    fieldPath: string[]
  ) => {
    const isChanged = isFieldChanged(section, fieldPath)
    return isChanged ? 'border-primary ring-1 ring-primary bg-primary/5' : ''
  }

  const ChangeIndicator = () => (
    <div className="flex items-center">
      <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />
    </div>
  )

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
          pendingFaviconFile ||
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
      asideNote="These settings apply to everyone on your instance. Personal preferences live in Profile."
    >
      {recovery && activeSection !== 'appearance' && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
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
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Image search</CardTitle>
              <CardDescription>
                Find your images by the words inside them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Background OCR Processing</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable OCR to allow searching through text content in
                    uploaded images.
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {isFieldChanged('general', ['ocr', 'enabled']) && (
                    <ChangeIndicator />
                  )}
                  <Switch
                    aria-label="Background OCR Processing"
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
              <CardDescription>
                Manage footer credits visibility
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Show Credits Footer</Label>
                  <p className="text-sm text-muted-foreground">
                    Display Flare credits in the footer
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {isFieldChanged('general', ['credits', 'showFooter']) && (
                    <ChangeIndicator />
                  )}
                  <Switch
                    aria-label="Show Credits Footer"
                    checked={workingConfig.settings.general.credits.showFooter}
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

              <Alert>
                <div className="flex min-w-0 items-center gap-2">
                  <InfoIcon className="h-4 w-4 flex-shrink-0" />
                  <AlertDescription className="mt-0">
                    If you disable credits, please consider sponsoring the
                    project to support its development.
                  </AlertDescription>
                </div>
              </Alert>
            </CardContent>
          </Card>
          <Card id="instance-information" className="scroll-mt-28">
            <CardHeader>
              <CardTitle>Instance Information</CardTitle>
              <CardDescription>
                View and manage your Flare instance details
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
                    <Github className="mr-2 h-4 w-4" />
                    View on GitHub
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://ko-fi.com/FlintSH"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Heart className="mr-2 h-4 w-4" />
                    Sponsor
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'access'}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Registration</CardTitle>
              <CardDescription>
                Decide whether your instance is open to new accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Allow Registrations</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable or disable new user registrations
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {isFieldChanged('general', ['registrations', 'enabled']) && (
                    <ChangeIndicator />
                  )}
                  <Switch
                    aria-label="Allow Registrations"
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
                  <Label>Registration Disabled Message</Label>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      aria-label="Registration Disabled Message"
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
                  <p className="text-sm text-muted-foreground">
                    This message will be shown to users on the login page when
                    registrations are disabled
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Single Sign-On (OIDC)</CardTitle>
              <CardDescription>
                Let users sign in through an external OpenID Connect identity
                provider
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Enable OIDC Sign-In</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable or disable single sign-on with OIDC
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {isFieldChanged('general', ['oidc', 'enabled']) && (
                    <ChangeIndicator />
                  )}
                  <Switch
                    aria-label="Enable OIDC Sign-In"
                    checked={workingConfig.settings.general.oidc.enabled}
                    onCheckedChange={(checked) =>
                      handleSettingChange('general', {
                        oidc: {
                          ...workingConfig.settings.general.oidc,
                          enabled: checked,
                        },
                      })
                    }
                    className={getFieldClasses('general', ['oidc', 'enabled'])}
                  />
                </div>
              </div>

              {workingConfig.settings.general.oidc.enabled && (
                <div className="space-y-4 border rounded-lg p-4">
                  <div className="space-y-2">
                    <Label>Issuer URL</Label>
                    <div className="flex min-w-0 items-center gap-2">
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
                    <p className="text-sm text-muted-foreground">
                      Flare discovers the provider&apos;s endpoints from{' '}
                      <code>{'{issuer}'}/.well-known/openid-configuration</code>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Client ID</Label>
                    <div className="flex min-w-0 items-center gap-2">
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
                    <Label>Client Secret</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Client Secret"
                        type="password"
                        value={workingConfig.settings.general.oidc.clientSecret}
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
                      {isFieldChanged('general', ['oidc', 'clientSecret']) && (
                        <ChangeIndicator />
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Sign-In Button Text</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Sign-In Button Text"
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
                    <div className="space-y-0.5">
                      <Label>Auto-Provision Users</Label>
                      <p className="text-sm text-muted-foreground">
                        Create a new account automatically the first time
                        someone signs in through the provider
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {isFieldChanged('general', ['oidc', 'autoProvision']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
                        aria-label="Auto-Provision Users"
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

                  <p className="text-sm text-muted-foreground">
                    SSO identities are not automatically linked to existing
                    accounts by email. Existing users must use local sign-in or
                    their previously linked SSO identity.
                  </p>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label>Require Verified Email</Label>
                      <p className="text-sm text-muted-foreground">
                        Require OIDC provider to confirm user email is verified.
                        Disable only if you trust all accounts that may register
                        with your provider.
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {isFieldChanged('general', [
                        'oidc',
                        'requireEmailVerified',
                      ]) && <ChangeIndicator />}
                      <Switch
                        aria-label="Require Verified Email"
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
                    <div className="space-y-0.5">
                      <Label>OIDC Auto-login</Label>
                      <p className="text-sm text-muted-foreground">
                        Skip the login form and redirect straight to the
                        provider. Visit <code>/auth/login?local=1</code> to
                        reach the password login if you get locked out.
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {isFieldChanged('general', ['oidc', 'enforceSso']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
                        aria-label="OIDC Auto-login"
                        checked={workingConfig.settings.general.oidc.enforceSso}
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
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'storage'}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>File storage</CardTitle>
              <CardDescription>
                Choose where uploads live and how large each file can be.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Storage Provider</Label>
                <div className="flex min-w-0 items-center gap-2">
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
                      aria-label="Storage Provider"
                      className={getFieldClasses('general', [
                        'storage',
                        'provider',
                      ])}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Local Storage</SelectItem>
                      <SelectItem value="s3">S3 Storage</SelectItem>
                    </SelectContent>
                  </Select>
                  {isFieldChanged('general', ['storage', 'provider']) && (
                    <ChangeIndicator />
                  )}
                </div>
              </div>
              {workingConfig.settings.general.storage.provider === 's3' && (
                <div className="space-y-4 border rounded-lg p-4">
                  <div className="space-y-2">
                    <Label>S3 Bucket</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="S3 Bucket"
                        value={workingConfig.settings.general.storage.s3.bucket}
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
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Region"
                        value={workingConfig.settings.general.storage.s3.region}
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
                    <Label>Access Key ID</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Access Key ID"
                        type="password"
                        value={
                          workingConfig.settings.general.storage.s3.accessKeyId
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
                    <Label>Secret Access Key</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Secret Access Key"
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
                    <Label>Custom Endpoint (Optional)</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-label="Custom Endpoint (Optional)"
                        value={
                          workingConfig.settings.general.storage.s3.endpoint ||
                          ''
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
                    <p className="text-sm text-muted-foreground">
                      For S3-compatible services like MinIO or DigitalOcean
                      Spaces
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Switch
                        aria-label="Force Path Style"
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
                      {isFieldChanged('general', [
                        'storage',
                        's3',
                        'forcePathStyle',
                      ]) && <ChangeIndicator />}
                    </div>
                    <Label>Force Path Style</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enable this for S3-compatible services that require
                    path-style URLs
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Maximum Upload Size</Label>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      aria-label="Maximum Upload Size"
                      type="number"
                      value={
                        workingConfig.settings.general.storage.maxUploadSize
                          .value
                      }
                      onChange={(e) =>
                        handleMaxUploadSizeChange(e.target.value)
                      }
                      placeholder="10"
                      className={getFieldClasses('general', [
                        'storage',
                        'maxUploadSize',
                        'value',
                      ])}
                    />
                    {isFieldChanged('general', [
                      'storage',
                      'maxUploadSize',
                      'value',
                    ]) && <ChangeIndicator />}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
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
                        aria-label="Maximum Upload Size unit"
                        className={`w-[110px] ${getFieldClasses('general', ['storage', 'maxUploadSize', 'unit'])}`}
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
              <CardDescription>
                Set a fair amount of space for each account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>User Quotas</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable storage limits per user
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {isFieldChanged('general', [
                    'storage',
                    'quotas',
                    'enabled',
                  ]) && <ChangeIndicator />}
                  <Switch
                    aria-label="User Quotas"
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
              <div>
                <Label>Data Quota per User</Label>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      aria-label="Data Quota per User"
                      type="number"
                      value={
                        workingConfig.settings.general.storage.quotas.default
                          .value
                      }
                      onChange={(e) => handleStorageQuotaChange(e.target.value)}
                      placeholder="500"
                      className={getFieldClasses('general', [
                        'storage',
                        'quotas',
                        'default',
                        'value',
                      ])}
                    />
                    {isFieldChanged('general', [
                      'storage',
                      'quotas',
                      'default',
                      'value',
                    ]) && <ChangeIndicator />}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
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
                              ...workingConfig.settings.general.storage.quotas,
                              default: {
                                ...workingConfig.settings.general.storage.quotas
                                  .default,
                                unit: value as 'MB' | 'GB',
                              },
                            },
                          },
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label="Data Quota per User unit"
                        className={`w-[110px] ${getFieldClasses('general', ['storage', 'quotas', 'default', 'unit'])}`}
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
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'appearance'}>
        <div className="space-y-6">
          <CustomizationStudio
            initialState={initialConfig.settings.customization}
            recovery={recovery}
            onStateChange={handleStudioStateChange}
            onDirtyChange={setStudioDirty}
          />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Favicon</CardTitle>
                <CardDescription>
                  Upload a custom favicon for your instance
                </CardDescription>
              </div>
              {hasFaviconChanged() && <ChangeIndicator />}
            </CardHeader>
            <CardContent>
              <div className="mt-2">
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted relative">
                    {(workingConfig?.settings.appearance.favicon ||
                      faviconPreviewUrl) && (
                      <div className="absolute top-4 left-4">
                        <div className="flex items-center gap-2 p-2 bg-background/80 backdrop-blur-sm rounded-lg">
                          <img
                            src={
                              isSafeUrl(faviconPreviewUrl)
                                ? DOMPurify.sanitize(faviconPreviewUrl)
                                : '/api/favicon'
                            }
                            alt="Favicon"
                            className="w-6 h-6"
                          />
                          <span className="text-sm text-muted-foreground">
                            {faviconPreviewUrl
                              ? 'New favicon (unsaved)'
                              : 'Current favicon'}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="h-8 w-8 mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Upload favicon
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PNG up to 1MB
                      </p>
                    </div>
                    <input
                      type="file"
                      disabled={isSaving}
                      className="hidden"
                      accept="image/png"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return

                        if (file.size > 1024 * 1024) {
                          toast({
                            title: 'File too large',
                            description:
                              'Please upload a file smaller than 1MB',
                            variant: 'destructive',
                          })
                          return
                        }

                        if (file.type !== 'image/png') {
                          toast({
                            title: 'Invalid file type',
                            description: 'Please upload a PNG image file',
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

                          toast({
                            title: 'Favicon changed',
                            description:
                              'Save your changes to apply the new favicon',
                          })
                        } catch (error) {
                          console.error('Failed to handle favicon:', error)
                          toast({
                            title: 'Failed to update favicon',
                            description: 'Please try again',
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
                initialColors={workingConfig.settings.appearance.customColors}
              />
            </fieldset>
            <p className="mt-4 text-xs text-muted-foreground">
              Color edits apply when you save settings. Appearance drafts and
              packs are published separately above.
            </p>
          </details>
          <details
            id="advanced-styles"
            className="scroll-mt-28 rounded-xl border bg-card p-5"
          >
            <summary className="cursor-pointer text-sm font-medium">
              Custom CSS and HTML
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Add your own styles and head content. These changes apply when you
              save settings.
            </p>
            <div className="mt-5 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Custom Styling</CardTitle>
                  <CardDescription>
                    Add custom CSS to your instance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-2">
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
                        <Code className="mr-2 h-4 w-4" />
                        {cssEditorOpen ? 'Close Editor' : 'Open Editor'}
                      </Button>
                    </div>
                    {cssEditorOpen && (
                      <Card
                        className={`mt-4 ${isFieldChanged('advanced', ['customCSS']) ? 'border-primary' : ''}`}
                      >
                        <CardHeader className="flex flex-row items-center justify-between">
                          <div>
                            <CardTitle>Custom CSS Editor</CardTitle>
                            <CardDescription>
                              Add custom CSS to customize your instance
                            </CardDescription>
                          </div>
                          {isFieldChanged('advanced', ['customCSS']) && (
                            <ChangeIndicator />
                          )}
                        </CardHeader>
                        <CardContent>
                          <CodeMirror
                            value={workingConfig.settings.advanced.customCSS}
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
                  <CardTitle>HTML Head Content</CardTitle>
                  <CardDescription>
                    Add custom HTML to the head section
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-2">
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
                        <FileCode className="mr-2 h-4 w-4" />
                        {htmlEditorOpen ? 'Close Editor' : 'Open Editor'}
                      </Button>
                    </div>
                    {htmlEditorOpen && (
                      <Card
                        className={`mt-4 ${isFieldChanged('advanced', ['customHead']) ? 'border-primary' : ''}`}
                      >
                        <CardHeader className="flex flex-row items-center justify-between">
                          <div>
                            <CardTitle>Custom HTML Editor</CardTitle>
                            <CardDescription>
                              Add custom HTML to the head of your instance
                            </CardDescription>
                          </div>
                          {isFieldChanged('advanced', ['customHead']) && (
                            <ChangeIndicator />
                          )}
                        </CardHeader>
                        <CardContent>
                          <CodeMirror
                            value={workingConfig.settings.advanced.customHead}
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
        </div>
      </PreferencesPanel>
      <PreferencesPanel active={activeSection === 'email'}>
        <EmailSettings />
      </PreferencesPanel>

      {hasChanges &&
        createPortal(
          <div
            role="status"
            className="fixed bottom-4 inset-x-4 z-40 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                You have unsaved instance settings
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {changedSettingsGroups.join(', ')}
                {pendingFaviconFile ? ' · Favicon' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={discardChanges}
                disabled={isSaving}
                className="flex-1 sm:flex-none"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Button
                onClick={saveChanges}
                disabled={isSaving}
                className="flex-1 sm:flex-none"
              >
                {isSaving ? (
                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {isSaving ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </div>,
          document.body
        )}
    </PreferencesShell>
  )
}
