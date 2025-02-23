'use client'

import { useCallback, useEffect, useState } from 'react'

import pkg from '@/package.json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import CodeMirror from '@uiw/react-codemirror'
import {
  Code,
  ExternalLink,
  FileCode,
  Github,
  Heart,
  InfoIcon,
  Upload,
} from 'lucide-react'
import { useDebounce } from 'use-debounce'

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

import { FlareConfig } from '@/lib/config'

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

export default function SettingsPage() {
  const { toast } = useToast()
  const [config, setConfig] = useState<FlareConfig | null>(null)
  const [cssEditorOpen, setCssEditorOpen] = useState(false)
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false)
  const [cssValue, setCssValue] = useState('')
  const [htmlValue, setHtmlValue] = useState('')
  const [disabledMessage, setDisabledMessage] = useState('')
  const [debouncedMessage] = useDebounce(disabledMessage, 500)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean
    latestVersion?: string
    releaseUrl?: string
  } | null>(null)

  const handleSettingChange = useCallback(
    async <T extends keyof FlareConfig['settings']>(
      section: T,
      value: SettingValue<T>
    ) => {
      if (!config) return

      try {
        const newConfig = { ...config }
        newConfig.settings[section] = {
          ...newConfig.settings[section],
          ...(value as FlareConfig['settings'][T]),
        }
        setConfig(newConfig)

        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(newConfig),
        })

        if (!response.ok) throw new Error()

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
      }
    },
    [config, toast]
  )

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/settings')
        const data = await response.json()
        setConfig(data)
        setCssValue(data.settings.advanced.customCSS)
        setHtmlValue(data.settings.advanced.customHead)
        setDisabledMessage(
          data.settings.general.registrations.disabledMessage || ''
        )
      } catch (error) {
        console.error('Failed to load config:', error)
      }
    }
    loadConfig()
  }, [])

  useEffect(() => {
    if (
      config &&
      debouncedMessage !== config.settings.general.registrations.disabledMessage
    ) {
      handleSettingChange('general', {
        registrations: {
          ...config.settings.general.registrations,
          disabledMessage: debouncedMessage,
        },
      })
    }
  }, [debouncedMessage, config, handleSettingChange])

  const handleStorageQuotaChange = (value: string) => {
    const numValue = parseInt(value)
    if (isNaN(numValue)) return

    handleSettingChange('general', {
      storage: {
        ...config!.settings.general.storage,
        quotas: {
          ...config!.settings.general.storage.quotas,
          default: {
            ...config!.settings.general.storage.quotas.default,
            value: numValue,
          },
        },
      },
    })
  }

  const handleMaxUploadSizeChange = (value: string) => {
    const numValue = parseInt(value)
    if (isNaN(numValue)) return

    handleSettingChange('general', {
      storage: {
        ...config!.settings.general.storage,
        maxUploadSize: {
          ...config!.settings.general.storage.maxUploadSize,
          value: numValue,
        },
      },
    })
  }

  const handleCustomColorsChange = async (colors: Partial<ColorConfig>) => {
    await handleSettingChange('appearance', {
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

  if (!config) {
    return <SettingsSkeleton />
  }

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
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
                  <Button onClick={checkForUpdates} disabled={isCheckingUpdate}>
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
                <Switch
                  checked={config.settings.general.registrations.enabled}
                  onCheckedChange={(checked) =>
                    handleSettingChange('general', {
                      registrations: {
                        ...config.settings.general.registrations,
                        enabled: checked,
                      },
                    })
                  }
                />
              </div>

              {!config.settings.general.registrations.enabled && (
                <div className="space-y-2">
                  <Label>Registration Disabled Message</Label>
                  <Input
                    placeholder="Registrations are currently disabled"
                    value={disabledMessage}
                    onChange={(e) => setDisabledMessage(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    This message will be shown to users on the login page when
                    registrations are disabled
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
                <Switch
                  checked={config.settings.general.storage.quotas.enabled}
                  onCheckedChange={(checked) =>
                    handleSettingChange('general', {
                      storage: {
                        ...config.settings.general.storage,
                        quotas: {
                          ...config.settings.general.storage.quotas,
                          enabled: checked,
                        },
                      },
                    })
                  }
                />
              </div>

              <div>
                <Label>Data Quota per User</Label>
                <div className="flex space-x-2 mt-1.5">
                  <Input
                    type="number"
                    value={config.settings.general.storage.quotas.default.value}
                    onChange={(e) => handleStorageQuotaChange(e.target.value)}
                    placeholder="500"
                  />
                  <Select
                    value={config.settings.general.storage.quotas.default.unit}
                    onValueChange={(value) =>
                      handleSettingChange('general', {
                        storage: {
                          ...config.settings.general.storage,
                          quotas: {
                            ...config.settings.general.storage.quotas,
                            default: {
                              ...config.settings.general.storage.quotas.default,
                              unit: value as 'MB' | 'GB',
                            },
                          },
                        },
                      })
                    }
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
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
              <div className="space-y-2">
                <Label>Storage Provider</Label>
                <Select
                  value={config.settings.general.storage.provider}
                  onValueChange={(value) =>
                    handleSettingChange('general', {
                      storage: {
                        ...config.settings.general.storage,
                        provider: value as 'local' | 's3',
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Storage</SelectItem>
                    <SelectItem value="s3">S3 Storage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {config.settings.general.storage.provider === 's3' && (
                <div className="space-y-4 border rounded-lg p-4">
                  <div className="space-y-2">
                    <Label>S3 Bucket</Label>
                    <Input
                      value={config.settings.general.storage.s3.bucket}
                      onChange={(e) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              bucket: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="my-bucket"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Region</Label>
                    <Input
                      value={config.settings.general.storage.s3.region}
                      onChange={(e) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              region: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="us-east-1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Access Key ID</Label>
                    <Input
                      type="password"
                      value={config.settings.general.storage.s3.accessKeyId}
                      onChange={(e) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              accessKeyId: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="AKIAXXXXXXXXXXXXXXXX"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Secret Access Key</Label>
                    <Input
                      type="password"
                      value={config.settings.general.storage.s3.secretAccessKey}
                      onChange={(e) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              secretAccessKey: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Custom Endpoint (Optional)</Label>
                    <Input
                      value={config.settings.general.storage.s3.endpoint || ''}
                      onChange={(e) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              endpoint: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="https://s3.custom-domain.com"
                    />
                    <p className="text-sm text-muted-foreground">
                      For S3-compatible services like MinIO or DigitalOcean
                      Spaces
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={
                        config.settings.general.storage.s3.forcePathStyle
                      }
                      onCheckedChange={(checked) =>
                        handleSettingChange('general', {
                          storage: {
                            ...config.settings.general.storage,
                            s3: {
                              ...config.settings.general.storage.s3,
                              forcePathStyle: checked,
                            },
                          },
                        })
                      }
                    />
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
                <div className="flex space-x-2 mt-1.5">
                  <Input
                    type="number"
                    value={config.settings.general.storage.maxUploadSize.value}
                    onChange={(e) => handleMaxUploadSizeChange(e.target.value)}
                    placeholder="10"
                  />
                  <Select
                    value={config.settings.general.storage.maxUploadSize.unit}
                    onValueChange={(value) =>
                      handleSettingChange('general', {
                        storage: {
                          ...config.settings.general.storage,
                          maxUploadSize: {
                            ...config.settings.general.storage.maxUploadSize,
                            unit: value as 'MB' | 'GB',
                          },
                        },
                      })
                    }
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
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
                <Switch
                  checked={config.settings.general.credits.showFooter}
                  onCheckedChange={(checked) =>
                    handleSettingChange('general', {
                      credits: { showFooter: checked },
                    })
                  }
                />
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
          <ThemeCustomizer
            onColorChange={handleCustomColorsChange}
            initialColors={config.settings.appearance.customColors}
          />

          <Card>
            <CardHeader>
              <CardTitle>Favicon</CardTitle>
              <CardDescription>
                Upload a custom favicon for your instance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mt-2">
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted relative">
                    {config.settings.appearance.favicon && (
                      <div className="absolute top-4 left-4">
                        <div className="flex items-center gap-2 p-2 bg-background/80 backdrop-blur-sm rounded-lg">
                          <img
                            src="/api/favicon"
                            alt="Current favicon"
                            className="w-6 h-6"
                          />
                          <span className="text-sm text-muted-foreground">
                            Current favicon
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

                        const formData = new FormData()
                        formData.append('file', file)

                        try {
                          const response = await fetch(
                            '/api/settings/favicon',
                            {
                              method: 'POST',
                              body: formData,
                            }
                          )

                          if (!response.ok) throw new Error()

                          // Update the config to reflect the new favicon
                          const newConfig = {
                            ...config!,
                            settings: {
                              ...config!.settings,
                              appearance: {
                                ...config!.settings.appearance,
                                favicon: '/api/favicon',
                              },
                            },
                          }
                          setConfig(newConfig)

                          // Update the favicon in the browser
                          const link = document.querySelector(
                            "link[rel*='icon']"
                          ) as HTMLLinkElement
                          if (link) {
                            link.href = '/api/favicon'
                            link.type = 'image/png'
                          }

                          toast({
                            title: 'Favicon updated',
                            description:
                              'Your favicon has been updated successfully',
                          })
                        } catch {
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
              <CardDescription>Add custom CSS to your instance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Custom CSS</Label>
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
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle>Custom CSS Editor</CardTitle>
                      <CardDescription>
                        Add custom CSS to customize your instance
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeMirror
                        value={cssValue}
                        height="200px"
                        extensions={[css()]}
                        onChange={(value) => {
                          setCssValue(value)
                          handleSettingChange('advanced', { customCSS: value })
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
                  <Label>Custom HTML</Label>
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
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle>Custom HTML Editor</CardTitle>
                      <CardDescription>
                        Add custom HTML to the head of your instance
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeMirror
                        value={htmlValue}
                        height="200px"
                        extensions={[html()]}
                        onChange={(value) => {
                          setHtmlValue(value)
                          handleSettingChange('advanced', { customHead: value })
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
  )
}
