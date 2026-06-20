'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { InfoIcon } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { markSetupAsCompleted } from '@/lib/utils/setup-cache'

import { useToast } from '@/hooks/use-toast'

interface SetupData {
  admin: {
    name: string
    email: string
    password: string
  }
  storage: {
    provider: 'local' | 's3'
    s3: {
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      endpoint: string
      forcePathStyle: boolean
    }
  }
  registrations: {
    enabled: boolean
    disabledMessage: string
  }
}

const defaultSetupData: SetupData = {
  admin: {
    name: '',
    email: '',
    password: '',
  },
  storage: {
    provider: 'local',
    s3: {
      bucket: '',
      region: '',
      accessKeyId: '',
      secretAccessKey: '',
      endpoint: '',
      forcePathStyle: false,
    },
  },
  registrations: {
    enabled: true,
    disabledMessage: '',
  },
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Mirrors the server-side zod rules so the most common mistakes surface
// instantly instead of failing silently after a round-trip.
function getValidationError(data: SetupData): string | null {
  if (!data.admin.name.trim()) {
    return 'Username is required'
  }
  if (!EMAIL_REGEX.test(data.admin.email)) {
    return 'Enter a valid email address'
  }
  if (data.admin.password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  if (data.storage.provider === 's3') {
    const { bucket, region, accessKeyId, secretAccessKey } = data.storage.s3
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      return 'All S3 fields (bucket, region, access key ID, secret access key) are required'
    }
  }
  return null
}

export default function SetupPage() {
  const [step, setStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [setupData, setSetupData] = useState<SetupData>(defaultSetupData)
  const { toast } = useToast()
  const router = useRouter()

  const handleSubmit = async () => {
    const validationError = getValidationError(setupData)
    if (validationError) {
      toast({
        title: 'Check your details',
        description: validationError,
        variant: 'destructive',
      })
      return
    }

    try {
      setIsLoading(true)

      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(setupData),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(
          error.error || error.message || 'Failed to complete setup'
        )
      }

      // Setup succeeded server-side: update the cached setup status so the
      // SetupChecker stops redirecting back to /setup, then route onward.
      markSetupAsCompleted()

      const result = await signIn('credentials', {
        email: setupData.admin.email,
        password: setupData.admin.password,
        redirect: false,
      })

      if (result?.error) {
        // The account exists; auto sign-in just failed. Send the user to login
        // instead of stranding them on the form.
        toast({
          title: 'Setup complete',
          description:
            'Your instance is configured. Please sign in to continue.',
        })
        router.push('/auth/login')
        return
      }

      toast({
        title: 'Setup complete',
        description: 'Your Flare instance has been configured successfully',
      })

      router.push('/dashboard')
      router.refresh()
    } catch (error) {
      console.error('Setup error:', error)
      toast({
        title: 'Setup failed',
        description:
          error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <DynamicBackground />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-[450px] space-y-8">
          {}
          <div className="flex items-center justify-center">
            <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
              <div className="relative flex items-center justify-center space-x-3 px-6 py-4">
                <Icons.logo className="h-8 w-8 text-primary" />
                <span className="flare-text text-2xl text-primary">Flare</span>
              </div>
            </div>
          </div>

          {}
          <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
            <div className="relative">
              <Card className="w-full border-0 bg-transparent shadow-none">
                <CardHeader className="text-center space-y-6">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      Welcome to Flare
                    </h1>
                    <div className="text-sm text-muted-foreground mt-1.5">
                      Step {step} of 3:{' '}
                      {step === 1 && 'Create your admin account'}
                      {step === 2 && 'Configure storage settings'}
                      {step === 3 && 'Set up user registration'}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-0">
                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium" htmlFor="name">
                          Username
                        </Label>
                        <Input
                          id="name"
                          placeholder="Create a username"
                          value={setupData.admin.name}
                          onChange={(e) =>
                            setSetupData({
                              ...setupData,
                              admin: {
                                ...setupData.admin,
                                name: e.target.value,
                              },
                            })
                          }
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                          autoFocus
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium" htmlFor="email">
                          Email address
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="name@example.com"
                          value={setupData.admin.email}
                          onChange={(e) =>
                            setSetupData({
                              ...setupData,
                              admin: {
                                ...setupData.admin,
                                email: e.target.value,
                              },
                            })
                          }
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label
                          className="text-sm font-medium"
                          htmlFor="password"
                        >
                          Password
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="Create a strong password"
                          value={setupData.admin.password}
                          onChange={(e) =>
                            setSetupData({
                              ...setupData,
                              admin: {
                                ...setupData.admin,
                                password: e.target.value,
                              },
                            })
                          }
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                        />
                        {setupData.admin.password.length > 0 &&
                          setupData.admin.password.length < 8 && (
                            <p className="text-sm text-destructive">
                              Password must be at least 8 characters
                            </p>
                          )}
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Storage Provider
                        </Label>
                        <Select
                          value={setupData.storage.provider}
                          onValueChange={(value: 'local' | 's3') =>
                            setSetupData({
                              ...setupData,
                              storage: {
                                ...setupData.storage,
                                provider: value,
                              },
                            })
                          }
                        >
                          <SelectTrigger className="h-11 bg-background/50 focus:bg-background transition-colors">
                            <SelectValue placeholder="Select a storage provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="local">Local Storage</SelectItem>
                            <SelectItem value="s3">S3 Storage</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {setupData.storage.provider === 'local' && (
                        <Alert className="bg-background/50">
                          <InfoIcon className="h-4 w-4" />
                          <AlertDescription>
                            Files will be stored on your server&apos;s local
                            filesystem. Make sure you have enough disk space and
                            regular backups.
                          </AlertDescription>
                        </Alert>
                      )}

                      {setupData.storage.provider === 's3' && (
                        <div className="space-y-4">
                          <Alert className="bg-background/50">
                            <InfoIcon className="h-4 w-4" />
                            <AlertDescription>
                              Files will be stored in an S3-compatible storage
                              service. This includes AWS S3, MinIO, DigitalOcean
                              Spaces, and others.
                            </AlertDescription>
                          </Alert>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Bucket Name
                            </Label>
                            <Input
                              placeholder="Enter your bucket name"
                              value={setupData.storage.s3.bucket}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  storage: {
                                    ...setupData.storage,
                                    s3: {
                                      ...setupData.storage.s3,
                                      bucket: e.target.value,
                                    },
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Region
                            </Label>
                            <Input
                              placeholder="Enter your region (e.g. us-east-1)"
                              value={setupData.storage.s3.region}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  storage: {
                                    ...setupData.storage,
                                    s3: {
                                      ...setupData.storage.s3,
                                      region: e.target.value,
                                    },
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Access Key ID
                            </Label>
                            <Input
                              type="password"
                              placeholder="Enter your access key ID"
                              value={setupData.storage.s3.accessKeyId}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  storage: {
                                    ...setupData.storage,
                                    s3: {
                                      ...setupData.storage.s3,
                                      accessKeyId: e.target.value,
                                    },
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Secret Access Key
                            </Label>
                            <Input
                              type="password"
                              placeholder="Enter your secret access key"
                              value={setupData.storage.s3.secretAccessKey}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  storage: {
                                    ...setupData.storage,
                                    s3: {
                                      ...setupData.storage.s3,
                                      secretAccessKey: e.target.value,
                                    },
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Custom Endpoint (Optional)
                            </Label>
                            <Input
                              placeholder="Enter your custom endpoint URL"
                              value={setupData.storage.s3.endpoint}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  storage: {
                                    ...setupData.storage,
                                    s3: {
                                      ...setupData.storage.s3,
                                      endpoint: e.target.value,
                                    },
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                            <p className="text-sm text-muted-foreground">
                              For S3-compatible services like MinIO or
                              DigitalOcean Spaces
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-4">
                      <Alert className="bg-background/50">
                        <InfoIcon className="h-4 w-4" />
                        <AlertDescription>
                          You can always change these settings later in the
                          admin dashboard.
                        </AlertDescription>
                      </Alert>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">
                            Allow Registrations
                          </Label>
                          <Select
                            value={
                              setupData.registrations.enabled ? 'true' : 'false'
                            }
                            onValueChange={(value) =>
                              setSetupData({
                                ...setupData,
                                registrations: {
                                  ...setupData.registrations,
                                  enabled: value === 'true',
                                },
                              })
                            }
                          >
                            <SelectTrigger className="h-11 bg-background/50 focus:bg-background transition-colors">
                              <SelectValue placeholder="Choose registration setting" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Enabled</SelectItem>
                              <SelectItem value="false">Disabled</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-sm text-muted-foreground">
                            Enable or disable new user registrations
                          </p>
                        </div>

                        {!setupData.registrations.enabled && (
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Registration Disabled Message
                            </Label>
                            <Input
                              placeholder="Enter message to show when registrations are disabled"
                              value={setupData.registrations.disabledMessage}
                              onChange={(e) =>
                                setSetupData({
                                  ...setupData,
                                  registrations: {
                                    ...setupData.registrations,
                                    disabledMessage: e.target.value,
                                  },
                                })
                              }
                              className="h-11 bg-background/50 focus:bg-background transition-colors"
                            />
                            <p className="text-sm text-muted-foreground">
                              This message will be shown to users on the login
                              page
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex gap-2 pb-6">
                  {step > 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setStep(step - 1)}
                      className="h-11"
                    >
                      Back
                    </Button>
                  )}

                  {step < 3 && (
                    <Button
                      className="flex-1 h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
                      onClick={() => setStep(step + 1)}
                      disabled={
                        (step === 1 &&
                          (!setupData.admin.name ||
                            !setupData.admin.email ||
                            setupData.admin.password.length < 8)) ||
                        (step === 2 &&
                          setupData.storage.provider === 's3' &&
                          (!setupData.storage.s3.bucket ||
                            !setupData.storage.s3.region ||
                            !setupData.storage.s3.accessKeyId ||
                            !setupData.storage.s3.secretAccessKey))
                      }
                    >
                      Continue
                    </Button>
                  )}

                  {step === 3 && (
                    <Button
                      className="flex-1 h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
                      onClick={handleSubmit}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                          Setting up...
                        </>
                      ) : (
                        'Complete Setup'
                      )}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
