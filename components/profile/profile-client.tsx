'use client'

import { useEffect, useRef, useState } from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Terminal } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Icons } from '@/components/shared/icons'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

interface ProfileClientProps {
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
    storageUsed: number
    role: 'ADMIN' | 'USER'
    randomizeFileUrls: boolean
    urlId: string
    fileCount: number
    shortUrlCount: number
  }
  quotasEnabled: boolean
  formattedQuota: string
  formattedUsed: string
  usagePercentage: number
  isAdmin: boolean
}

const flameshotFormSchema = z.object({
  useWayland: z.boolean().default(false),
  useCompositor: z.boolean().default(false),
})

type FlameshotFormValues = z.infer<typeof flameshotFormSchema>

export function ProfileClient({
  user,
  quotasEnabled,
  formattedQuota,
  formattedUsed,
  usagePercentage,
  isAdmin,
}: ProfileClientProps) {
  const { fileCount, shortUrlCount } = user
  const { update: updateSession, data: session } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  // Refs for form inputs
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'preparing' | 'downloading'>(
    'idle'
  )
  const [uploadToken, setUploadToken] = useState<string | null>(null)
  const [isLoadingToken, setIsLoadingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const form = useForm<FlameshotFormValues>({
    resolver: zodResolver(flameshotFormSchema),
    defaultValues: {
      useWayland: false,
      useCompositor: false,
    },
  })

  useEffect(() => {
    // Fetch upload token on component mount
    const fetchToken = async () => {
      try {
        const response = await fetch('/api/profile/upload-token')
        if (!response.ok) throw new Error('Failed to fetch upload token')
        const data = await response.json()
        setUploadToken(data.uploadToken)
      } catch (error) {
        console.error('Error fetching upload token:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch upload token',
          variant: 'destructive',
        })
      }
    }
    fetchToken()
  }, [toast])

  const handleRefreshToken = async () => {
    setIsLoadingToken(true)
    try {
      const response = await fetch('/api/profile/upload-token', {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to refresh upload token')
      const data = await response.json()
      setUploadToken(data.uploadToken)
      toast({
        title: 'Success',
        description: 'Upload token refreshed successfully',
      })
    } catch (error) {
      console.error('Error refreshing upload token:', error)
      toast({
        title: 'Error',
        description: 'Failed to refresh upload token',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingToken(false)
    }
  }

  const triggerAvatarUpload = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    setIsLoading(true)
    try {
      const file = e.target.files[0]
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error(
            quotasEnabled
              ? 'This file would exceed your storage quota. Please free up some space and try again.'
              : 'The file is too large to upload.'
          )
        }
        throw new Error('Failed to upload avatar')
      }

      const { url } = await response.json()

      // Update the session with new avatar URL and wait for it to complete
      await updateSession({
        user: {
          ...user,
          image: url,
        },
      })

      // Force a router refresh to update all components
      router.refresh()

      toast({
        title: 'Success',
        description: 'Avatar updated successfully',
      })
    } catch (error) {
      console.error('Avatar upload error:', error)
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error ? error.message : 'Failed to update avatar',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nameRef.current?.value,
          email: emailRef.current?.value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const data = await response.json()

      // Update the session with new profile data and force a refresh
      await updateSession({
        ...session,
        user: {
          ...session?.user,
          name: data.name,
          email: data.email,
        },
      })

      // Force a router refresh to update all components
      router.refresh()

      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      })
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update profile',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPasswordRef.current?.value !== confirmPasswordRef.current?.value) {
      toast({
        title: 'Error',
        description: 'New passwords do not match',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: currentPasswordRef.current?.value,
          newPassword: newPasswordRef.current?.value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update password')
      }

      // Force a session refresh after password change
      await updateSession()

      toast({
        title: 'Success',
        description: 'Password updated successfully',
      })

      // Clear password fields
      if (currentPasswordRef.current) currentPasswordRef.current.value = ''
      if (newPasswordRef.current) newPasswordRef.current.value = ''
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = ''
    } catch (error) {
      console.error('Password update error:', error)
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update password',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRandomizeUrlsToggle = async (checked: boolean) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          randomizeFileUrls: checked,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update settings')
      }

      // Force a router refresh to update all components
      router.refresh()

      toast({
        title: 'Success',
        description: 'File URL settings updated successfully',
      })
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update settings',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // TODO: make this progress bar better, it's a fucking mess right now
  const handleExport = async () => {
    setIsExporting(true)
    setExportProgress(0)
    setDownloadProgress(0)
    setStatus('preparing')

    let eventSource: EventSource | null = null
    try {
      // Start listening for export progress updates
      eventSource = new EventSource('/api/profile/export/progress')
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        setExportProgress(data.progress)
        if (data.progress === 100) {
          eventSource?.close()
          setStatus('downloading')
        }
      }

      const response = await fetch('/api/profile/export')
      if (!response.ok) throw new Error('Export failed')

      // Get the total size if available
      const contentLength = response.headers.get('Content-Length')
      const totalSize = contentLength ? parseInt(contentLength, 10) : null

      // Create response reader
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Failed to create reader')

      // Read the stream
      const chunks: Uint8Array[] = []
      let receivedLength = 0
      let lastProgressUpdate = Date.now()
      let lastChunkTime = Date.now()
      let bytesPerSecond = 0
      let highestProgress = 0

      while (true) {
        const { done, value } = await reader.read()
        const now = Date.now()

        if (done) {
          setDownloadProgress(100)
          break
        }

        chunks.push(value)
        receivedLength += value.length

        // Calculate download speed with smoother averaging
        const timeDiff = now - lastChunkTime
        if (timeDiff > 0) {
          const instantSpeed = (value.length / timeDiff) * 1000
          bytesPerSecond =
            bytesPerSecond === 0
              ? instantSpeed
              : bytesPerSecond * 0.8 + instantSpeed * 0.2
        }
        lastChunkTime = now

        // Update progress at most every 100ms
        if (now - lastProgressUpdate > 100) {
          let newProgress
          if (totalSize) {
            // If we have Content-Length, use it for accurate progress
            newProgress = Math.round((receivedLength / totalSize) * 100)
          } else {
            // If no Content-Length, estimate based on received data and speed
            const estimatedSecondsLeft = bytesPerSecond > 0 ? 1 : 0 // More conservative estimate
            const estimatedTotalSize =
              receivedLength + bytesPerSecond * estimatedSecondsLeft
            newProgress = Math.min(
              Math.round((receivedLength / estimatedTotalSize) * 100),
              99
            )
          }

          // Only update if the new progress is higher
          if (newProgress > highestProgress) {
            highestProgress = newProgress
            setDownloadProgress(newProgress)
          }
          lastProgressUpdate = now
        }
      }

      // Create and download the blob
      const blob = new Blob(chunks, { type: 'application/zip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-data-export.zip'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: 'Error',
        description: 'Failed to export data',
        variant: 'destructive',
      })
    } finally {
      eventSource?.close()
      setIsExporting(false)
      setExportProgress(0)
      setDownloadProgress(0)
      setStatus('idle')
    }
  }

  const handleAccountDeletion = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      toast({
        title: 'Success',
        description: 'Account deleted successfully',
      })

      router.push('/auth/login')
    } catch (error) {
      console.error('Account deletion error:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete account',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleShareXDownload = async () => {
    try {
      const response = await fetch('/api/profile/sharex')
      if (!response.ok) {
        throw new Error('Failed to download ShareX config')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Get filename from Content-Disposition header
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-sharex.sxcu'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'ShareX configuration downloaded successfully',
      })
    } catch (error) {
      console.error('ShareX download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download ShareX configuration',
        variant: 'destructive',
      })
    }
  }

  const handleFlameshotDownload = async (values: FlameshotFormValues) => {
    try {
      const response = await fetch('/api/profile/flameshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })

      if (!response.ok) throw new Error('Failed to generate Flameshot script')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Get filename from Content-Disposition header
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-flameshot.sh'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'Flameshot script downloaded successfully',
      })
    } catch (error) {
      console.error('Flameshot script download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download Flameshot configuration',
        variant: 'destructive',
      })
    }
  }

  const handleBashDownload = async () => {
    try {
      const response = await fetch('/api/profile/bash')
      if (!response.ok) {
        throw new Error('Failed to download bash script')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Get filename from Content-Disposition header
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-upload.sh'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'Bash upload script downloaded successfully',
      })
    } catch (error) {
      console.error('Bash script download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download bash upload script',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your profile information and how others see you on the
                platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="flex flex-col items-center">
                  <Avatar className="h-24 w-24">
                    <AvatarImage
                      src={user.image || undefined}
                      alt={user.name || 'User avatar'}
                      className="object-cover"
                    />
                    <AvatarFallback>
                      {user.name?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={triggerAvatarUpload}
                    disabled={isLoading}
                    className="mt-4 w-full"
                  >
                    {isLoading ? 'Uploading...' : 'Change Avatar'}
                  </Button>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                </div>

                <div className="flex-1">
                  <form
                    onSubmit={handleProfileUpdate}
                    className="flex flex-col justify-center h-full space-y-4"
                  >
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          ref={nameRef}
                          defaultValue={user.name || ''}
                          placeholder="Your username"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          ref={emailRef}
                          defaultValue={user.email || ''}
                          placeholder="Your email"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={isLoading}>
                        {isLoading ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Show storage usage for all users */}
              <>
                <Separator className="my-6" />

                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">Storage Usage</h3>
                    <p className="text-sm text-muted-foreground">
                      {!isAdmin && quotasEnabled
                        ? 'Monitor your storage usage and available space.'
                        : 'Track how much storage space you are using.'}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {!isAdmin && quotasEnabled ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-lg font-medium">
                                {formattedUsed}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                Used Space
                              </span>
                            </div>
                            <div className="flex flex-col text-right">
                              <span className="text-lg font-medium">
                                {formattedQuota}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                Total Space
                              </span>
                            </div>
                          </div>

                          <div>
                            <Progress
                              value={usagePercentage}
                              className={cn(
                                'h-3',
                                usagePercentage > 90
                                  ? '[&>div]:bg-destructive'
                                  : usagePercentage > 75
                                    ? '[&>div]:bg-yellow-500'
                                    : '[&>div]:bg-primary'
                              )}
                            />
                            <div className="flex items-center justify-between mt-1.5">
                              {usagePercentage > 75 && (
                                <div
                                  className={cn(
                                    'flex items-center gap-2 text-sm',
                                    usagePercentage > 90
                                      ? 'text-destructive'
                                      : 'text-yellow-500'
                                  )}
                                >
                                  <Icons.alertCircle className="h-4 w-4" />
                                  <span>
                                    {usagePercentage > 90
                                      ? 'Storage space is critically low'
                                      : 'Storage space is getting low'}
                                  </span>
                                </div>
                              )}
                              <span
                                className={cn(
                                  'text-sm font-medium',
                                  usagePercentage > 90
                                    ? 'text-destructive'
                                    : usagePercentage > 75
                                      ? 'text-yellow-500'
                                      : 'text-muted-foreground'
                                )}
                              >
                                {usagePercentage.toFixed(1)}% used
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                        <div className="flex flex-col">
                          <span className="text-lg font-medium">
                            {formattedUsed}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Total Space Used
                          </span>
                        </div>
                        <div className="flex items-center text-muted-foreground">
                          <Icons.infinity className="h-5 w-5" />
                          <span className="ml-2 text-sm">Uncapped Storage</span>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                        <div className="flex flex-col">
                          <span className="text-lg font-medium">
                            {fileCount}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Total Files
                          </span>
                        </div>
                        <Icons.file className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                        <div className="flex flex-col">
                          <span className="text-lg font-medium">
                            {shortUrlCount}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Shortened URLs
                          </span>
                        </div>
                        <Icons.copy className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>File Upload Settings</CardTitle>
              <CardDescription>
                Configure default settings for your uploaded files.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="randomize-urls">Randomize File URLs</Label>
                  <p className="text-sm text-muted-foreground">
                    When enabled, all new uploads will have randomized URLs
                    instead of using the original filename.
                  </p>
                </div>
                <Switch
                  id="randomize-urls"
                  checked={user.randomizeFileUrls}
                  onCheckedChange={handleRandomizeUrlsToggle}
                  disabled={isLoading}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Tools</CardTitle>
              <CardDescription>
                Download pre-configured settings for your favorite upload tools.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-medium">Upload Token</h3>
                    <p className="text-sm text-muted-foreground">
                      This token is used to authenticate your uploads. Keep it
                      secret and refresh it if it gets compromised.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          value={uploadToken || ''}
                          readOnly
                          type={showToken ? 'text' : 'password'}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2"
                          onClick={() => setShowToken(!showToken)}
                        >
                          {showToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleRefreshToken}
                        disabled={isLoadingToken}
                      >
                        {isLoadingToken ? 'Refreshing...' : 'Refresh Token'}
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium">ShareX</h3>
                    <p className="text-sm text-muted-foreground">
                      Popular screenshot and file sharing tool for Windows
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleShareXDownload}>
                    Download Config
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium">Flameshot</h3>
                    <p className="text-sm text-muted-foreground">
                      Powerful cross-platform screenshot software for Linux,
                      MacOS, and Windows
                    </p>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">Download Script</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Flameshot Upload Script</DialogTitle>
                        <DialogDescription>
                          Generate a custom upload script for Flameshot on
                          Linux.
                        </DialogDescription>
                      </DialogHeader>

                      <Form {...form}>
                        <form
                          onSubmit={form.handleSubmit(handleFlameshotDownload)}
                          className="space-y-6"
                        >
                          {/* Dependencies Alert */}
                          <div className="flex items-start space-x-3 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-amber-600 dark:text-amber-400">
                            <Terminal className="mt-0.5 h-5 w-5 flex-shrink-0" />
                            <div className="space-y-1">
                              <div className="text-sm opacity-90">
                                Make sure you have these installed:
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                                    flameshot
                                  </span>
                                  <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                                    curl
                                  </span>
                                  <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                                    jq
                                  </span>
                                  <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                                    xsel
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <h4 className="text-sm font-medium mb-1">
                                Environment Settings
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                Customize the script for your system
                                configuration
                              </p>
                            </div>

                            <div className="rounded-lg border bg-card divide-y">
                              <FormField
                                control={form.control}
                                name="useWayland"
                                render={({ field }) => (
                                  <FormItem className="flex items-center justify-between p-3">
                                    <div className="flex gap-3 items-center">
                                      <div className="relative w-5 h-5 flex-shrink-0">
                                        <Image
                                          src="/wayland.svg"
                                          alt="Wayland"
                                          fill
                                          className="object-contain"
                                        />
                                      </div>
                                      <div className="space-y-0.5">
                                        <FormLabel className="text-sm">
                                          Wayland Clipboard Support
                                        </FormLabel>
                                        <FormDescription className="text-xs">
                                          Enable if you&apos;re using Wayland
                                        </FormDescription>
                                      </div>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name="useCompositor"
                                render={({ field }) => (
                                  <FormItem className="flex items-center justify-between p-3">
                                    <div className="flex gap-3 items-center">
                                      <div className="relative w-5 h-5 flex-shrink-0">
                                        <Image
                                          src="/hyprland.svg"
                                          alt="Hyprland"
                                          fill
                                          className="object-contain"
                                        />
                                      </div>
                                      <div className="space-y-0.5">
                                        <FormLabel className="text-sm">
                                          Hyprland Compatibility
                                        </FormLabel>
                                        <FormDescription className="text-xs">
                                          Enable if you&apos;re using Hyprland
                                        </FormDescription>
                                      </div>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>

                          <DialogFooter>
                            <div className="flex w-full justify-between">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => form.reset()}
                              >
                                Reset Options
                              </Button>
                              <Button type="submit">Download Script</Button>
                            </div>
                          </DialogFooter>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium">Bash Script</h3>
                    <p className="text-sm text-muted-foreground">
                      Simple upload script for command line usage
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleBashDownload}>
                    Download Script
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>
                Update your password to keep your account secure.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input
                      id="current-password"
                      type="password"
                      ref={currentPasswordRef}
                      placeholder="Enter your current password"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      ref={newPasswordRef}
                      placeholder="Enter your new password"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      ref={confirmPasswordRef}
                      placeholder="Confirm your new password"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Updating...' : 'Update Password'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
              <CardDescription>
                Export your data or manage your account deletion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-medium">Export Your Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Download a copy of all your uploaded files and account
                    information.
                  </p>
                  <Button
                    onClick={handleExport}
                    disabled={isExporting}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    {isExporting ? (
                      <div className="flex items-center gap-2">
                        <span>
                          {status === 'preparing'
                            ? `Preparing... ${exportProgress}%`
                            : status === 'downloading'
                              ? `Downloading... ${downloadProgress}%`
                              : 'Starting...'}
                        </span>
                        <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-200"
                            style={{
                              width: `${status === 'preparing' ? exportProgress : downloadProgress}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      'Export All Data'
                    )}
                  </Button>
                </div>

                <Separator className="my-6" />

                <div className="space-y-2">
                  <h3 className="font-medium text-destructive">
                    Delete Account
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete your account and remove all associated
                    data.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        className="w-full sm:w-auto"
                      >
                        Delete Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Are you absolutely sure?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently
                          delete your account and remove all your data from our
                          servers.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleAccountDeletion}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
