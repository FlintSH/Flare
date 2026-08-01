'use client'

import { useCallback, useEffect, useState } from 'react'

import pkg from '@/package.json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import CodeMirror from '@uiw/react-codemirror'
import DOMPurify from 'dompurify'
import { deepEqual } from 'fast-equals'
import {
  Circle,
  Code,
  ExternalLink,
  FileCode,
  Github,
  Heart,
  InfoIcon,
  Save,
  Upload,
  XCircle,
} from 'lucide-react'

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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { FlareConfig } from '@/lib/config'

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

function SettingsSkeleton() {
  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="space-y-4">
        <div className="flex space-x-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
            <div className="flex space-x-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <div className="flex space-x-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-[110px]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <div className="flex space-x-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-[110px]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const isSafeUrl = (url: string | null): url is string => {
  if (!url) return false
  return url.startsWith('blob:') && /^blob:https?:\/\//.test(url)
}

export default function SettingsPage() {
  const { toast } = useToast()
  const [savedConfig, setSavedConfig] = useState<FlareConfig | null>(null)
  const [workingConfig, setWorkingConfig] = useState<FlareConfig | null>(null)
  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(
    null
  )
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null
  )

  const [cssEditorOpen, setCssEditorOpen] = useState(false)
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean
    latestVersion?: string
    releaseUrl?: string
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const hasChanges =
    !deepEqual(savedConfig, workingConfig) || pendingFaviconFile !== null

  const saveChanges = async () => {
    if (!workingConfig) return

    try {
      setIsSaving(true)

      if (pendingFaviconFile) {
        const formData = new FormData()
        formData.append('file', pendingFaviconFile)

        const response = await fetch('/api/settings/favicon', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          throw new Error('Failed to upload favicon')
        }

        const newConfig = { ...workingConfig }
        newConfig.settings.appearance.favicon = '/api/favicon'
        setWorkingConfig(newConfig)

        const link = document.querySelector(
          "link[rel*='icon']"
        ) as HTMLLinkElement
        if (link) {
          link.href = '/api/favicon'
          link.type = 'image/png'
        }

        setPendingFaviconFile(null)
        if (faviconPreviewUrl) {
          URL.revokeObjectURL(faviconPreviewUrl)
          setFaviconPreviewUrl(null)
        }
      }

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workingConfig),
      })

      if (!response.ok) throw new Error()

      setSavedConfig(JSON.parse(JSON.stringify(workingConfig)))

      toast({
        title: 'Settings updated',
        description: 'Your changes have been saved successfully',
      })
    } catch (error) {
      console.error('Failed to update settings:', error)
      toast({
        title: 'Failed to update settings',
        description: 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const discardChanges = () => {
    if (!savedConfig) return

    if (faviconPreviewUrl) {
      URL.revokeObjectURL(faviconPreviewUrl)
      setFaviconPreviewUrl(null)
    }

    setPendingFaviconFile(null)

    setWorkingConfig(JSON.parse(JSON.stringify(savedConfig)))

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
      if (!workingConfig) return

      const newConfig = { ...workingConfig }
      newConfig.settings[section] = {
        ...newConfig.settings[section],
        ...(value as FlareConfig['settings'][T]),
      }
      setWorkingConfig(newConfig)
    },
    [workingConfig]
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

  const countChangedSettings = useCallback((): number => {
    if (!savedConfig || !workingConfig) return 0

    let count = 0

    if (
      !deepEqual(savedConfig.settings.general, workingConfig.settings.general)
    ) {
      count++
    }

    if (
      !deepEqual(
        savedConfig.settings.appearance,
        workingConfig.settings.appearance
      )
    ) {
      count++
    }

    if (
      !deepEqual(savedConfig.settings.advanced, workingConfig.settings.advanced)
    ) {
      count++
    }

    return count
  }, [savedConfig, workingConfig])

  const getChangedSettingsGroups = useCallback((): string[] => {
    if (!savedConfig || !workingConfig) return []

    const changedGroups: string[] = []

    if (
      !deepEqual(savedConfig.settings.general, workingConfig.settings.general)
    ) {
      changedGroups.push('General')
    }

    if (
      !deepEqual(
        savedConfig.settings.appearance,
        workingConfig.settings.appearance
      )
    ) {
      changedGroups.push('Appearance')
    }

    if (
      !deepEqual(savedConfig.settings.advanced, workingConfig.settings.advanced)
    ) {
      changedGroups.push('Advanced')
    }

    return changedGroups
  }, [savedConfig, workingConfig])

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/settings')
        const responseJson = await response.json()
        if (responseJson?.data) {
          const actualConfigData = responseJson.data
          setSavedConfig(actualConfigData)
          setWorkingConfig(JSON.parse(JSON.stringify(actualConfigData)))
        } else {
          console.error(
            'Failed to load config: Invalid data structure received',
            responseJson
          )
        }
      } catch (error) {
        console.error('Failed to load config:', error)
      }
    }
    loadConfig()
  }, [])

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
      customColors: colors,
    })
  }

  const checkForUpdates = async () => {
    try {
      setIsCheckingUpdate(true)
      const response = await fetch('/api/updates/check')
      if (!response.ok) throw new Error()
      const data = await response.json()
      setUpdateInfo(data)

      toast({
        title: data.hasUpdate ? 'Update Available' : 'No Updates Available',
        description: data.message,
        variant: 'default',
      })
    } catch {
      toast({
        title: 'Failed to check for updates',
        description: 'Please try again later',
        variant: 'destructive',
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const hasFaviconChanged = useCallback(() => {
    return pendingFaviconFile !== null
  }, [pendingFaviconFile])

  if (
    !workingConfig ||
    !savedConfig ||
    !workingConfig.settings ||
    !savedConfig.settings
  ) {
    return <SettingsSkeleton />
  }

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

  return (
    <div className="container space-y-6 pb-32">
      {}
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure your Flare instance settings and preferences
          </p>
        </div>
      </div>

      {}
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <Tabs defaultValue="general" className="space-y-4">
            <TabsList>
              <TabsTrigger value="general" className="relative">
                General
                {!deepEqual(
                  savedConfig?.settings.general,
                  workingConfig?.settings.general
                ) && (
                  <span className="absolute -top-1 -right-1">
                    <Circle className="h-2 w-2 fill-primary text-primary" />
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="appearance" className="relative">
                Appearance
                {!deepEqual(
                  savedConfig?.settings.appearance,
                  workingConfig?.settings.appearance
                ) && (
                  <span className="absolute -top-1 -right-1">
                    <Circle className="h-2 w-2 fill-primary text-primary" />
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="advanced" className="relative">
                Advanced
                {!deepEqual(
                  savedConfig?.settings.advanced,
                  workingConfig?.settings.advanced
                ) && (
                  <span className="absolute -top-1 -right-1">
                    <Circle className="h-2 w-2 fill-primary text-primary" />
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Instance Information</CardTitle>
                  <CardDescription>
                    View and manage your Flare instance details
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Version</Label>
                      <p className="text-sm text-muted-foreground">
                        Current version: {pkg.version}
                        {updateInfo && (
                          <span className="ml-2 text-primary">
                            {updateInfo.hasUpdate
                              ? `(Update available: ${updateInfo.latestVersion})`
                              : '(Up to date)'}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {updateInfo?.hasUpdate && (
                        <Button variant="outline" asChild>
                          <a
                            href={updateInfo.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            View Release
                          </a>
                        </Button>
                      )}
                      <Button
                        onClick={checkForUpdates}
                        disabled={isCheckingUpdate}
                      >
                        {isCheckingUpdate ? (
                          <>
                            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                            Checking...
                          </>
                        ) : (
                          'Check for Updates'
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
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

              <Card>
                <CardHeader>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>
                    Configure user registration and quotas
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Allow Registrations</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable or disable new user registrations
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('general', [
                        'registrations',
                        'enabled',
                      ]) && <ChangeIndicator />}
                      <Switch
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
                      <div className="flex items-center gap-2">
                        <Input
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
                        This message will be shown to users on the login page
                        when registrations are disabled
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>User Quotas</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable storage limits per user
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('general', [
                        'storage',
                        'quotas',
                        'enabled',
                      ]) && <ChangeIndicator />}
                      <Switch
                        checked={
                          workingConfig.settings.general.storage.quotas.enabled
                        }
                        onCheckedChange={(checked) =>
                          handleSettingChange('general', {
                            storage: {
                              ...workingConfig.settings.general.storage,
                              quotas: {
                                ...workingConfig.settings.general.storage
                                  .quotas,
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
                    <div className="flex items-center space-x-2 mt-1.5">
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="number"
                          value={
                            workingConfig.settings.general.storage.quotas
                              .default.value
                          }
                          onChange={(e) =>
                            handleStorageQuotaChange(e.target.value)
                          }
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
                      <div className="flex items-center gap-2">
                        <Select
                          value={
                            workingConfig.settings.general.storage.quotas
                              .default.unit
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

              <Card>
                <CardHeader>
                  <CardTitle>Storage Settings</CardTitle>
                  <CardDescription>
                    Configure storage provider and limitations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Background OCR Processing</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable OCR to allow searching through text content in
                        uploaded images.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('general', ['ocr', 'enabled']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
                        checked={workingConfig.settings.general.ocr.enabled}
                        onCheckedChange={(checked) =>
                          handleSettingChange('general', {
                            ocr: { enabled: checked },
                          })
                        }
                        className={getFieldClasses('general', [
                          'ocr',
                          'enabled',
                        ])}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Storage Provider</Label>
                    <div className="flex items-center gap-2">
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
                        <div className="flex items-center gap-2">
                          <Input
                            value={
                              workingConfig.settings.general.storage.s3.bucket
                            }
                            onChange={(e) =>
                              handleSettingChange('general', {
                                storage: {
                                  ...workingConfig.settings.general.storage,
                                  s3: {
                                    ...workingConfig.settings.general.storage
                                      .s3,
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
                        <div className="flex items-center gap-2">
                          <Input
                            value={
                              workingConfig.settings.general.storage.s3.region
                            }
                            onChange={(e) =>
                              handleSettingChange('general', {
                                storage: {
                                  ...workingConfig.settings.general.storage,
                                  s3: {
                                    ...workingConfig.settings.general.storage
                                      .s3,
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
                        <div className="flex items-center gap-2">
                          <Input
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
                                    ...workingConfig.settings.general.storage
                                      .s3,
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
                        <div className="flex items-center gap-2">
                          <Input
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
                                    ...workingConfig.settings.general.storage
                                      .s3,
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
                        <div className="flex items-center gap-2">
                          <Input
                            value={
                              workingConfig.settings.general.storage.s3
                                .endpoint || ''
                            }
                            onChange={(e) =>
                              handleSettingChange('general', {
                                storage: {
                                  ...workingConfig.settings.general.storage,
                                  s3: {
                                    ...workingConfig.settings.general.storage
                                      .s3,
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

                      <div className="flex items-center space-x-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={
                              workingConfig.settings.general.storage.s3
                                .forcePathStyle
                            }
                            onCheckedChange={(checked) =>
                              handleSettingChange('general', {
                                storage: {
                                  ...workingConfig.settings.general.storage,
                                  s3: {
                                    ...workingConfig.settings.general.storage
                                      .s3,
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
                    <div className="flex space-x-2 items-center mt-1.5">
                      <div className="flex items-center gap-2 flex-1">
                        <Input
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
                      <div className="flex items-center gap-2">
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
                  <CardTitle>Credits</CardTitle>
                  <CardDescription>
                    Manage footer credits visibility
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show Credits Footer</Label>
                      <p className="text-sm text-muted-foreground">
                        Display Flare credits in the footer
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('general', ['credits', 'showFooter']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
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

                  <Alert>
                    <div className="flex items-center gap-2">
                      <InfoIcon className="h-4 w-4 flex-shrink-0" />
                      <AlertDescription className="mt-0">
                        If you disable credits, please consider sponsoring the
                        project to support its development.
                      </AlertDescription>
                    </div>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Theme Colors</CardTitle>
                    <CardDescription>
                      Customize the colors of your Flare instance
                    </CardDescription>
                  </div>
                  {!deepEqual(
                    savedConfig?.settings.appearance.customColors,
                    workingConfig?.settings.appearance.customColors
                  ) && <ChangeIndicator />}
                </CardHeader>
                <CardContent>
                  <ThemeCustomizer
                    onColorChange={handleCustomColorsChange}
                    initialColors={
                      workingConfig?.settings.appearance.customColors
                    }
                  />
                </CardContent>
              </Card>

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
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Custom Styling</CardTitle>
                  <CardDescription>
                    Add custom CSS to your instance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
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
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {hasChanges && (
        <div className="fixed bottom-8 left-0 right-0 flex justify-center z-50">
          <div className="flex items-center gap-2 px-4 py-3 bg-background/80 backdrop-blur-md border rounded-full shadow-lg">
            <div className="flex items-center gap-2 mr-2">
              <Circle className="h-3 w-3 fill-primary text-primary animate-pulse" />
              <span className="text-sm font-medium">
                {countChangedSettings()}{' '}
                {countChangedSettings() === 1 ? 'section' : 'sections'} changed:{' '}
                {getChangedSettingsGroups().join(', ')}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={discardChanges}
              className="flex items-center rounded-full px-4"
              size="sm"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Discard
            </Button>
            <Button
              onClick={saveChanges}
              disabled={isSaving}
              className="flex items-center rounded-full px-4"
              size="sm"
            >
              {isSaving ? (
                <>
                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
