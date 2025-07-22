'use client'

import { useState } from 'react'

import Image from 'next/image'

import { SpectacleFormValues } from '@/types/components/profile'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Monitor, Terminal, Video } from 'lucide-react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'

import { useToast } from '@/hooks/use-toast'

const spectacleFormSchema = z.object({
  scriptType: z.enum(['screenshot', 'recording']).default('screenshot'),
  useWayland: z.boolean().default(false),
  includePointer: z.boolean().default(false),
  captureMode: z
    .enum(['fullscreen', 'current', 'activewindow', 'region'])
    .default('region'),
  recordingMode: z.enum(['fullscreen', 'current', 'region']).default('region'),
  delay: z.number().min(0).max(10000).default(0),
})

export function SpectacleTool() {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const form = useForm<SpectacleFormValues>({
    resolver: zodResolver(spectacleFormSchema),
    defaultValues: {
      scriptType: 'screenshot',
      useWayland: false,
      includePointer: false,
      captureMode: 'region',
      recordingMode: 'region',
      delay: 0,
    },
  })

  const scriptType = form.watch('scriptType')

  const handleSpectacleDownload = async (values: SpectacleFormValues) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile/spectacle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })

      if (!response.ok) throw new Error('Failed to generate Spectacle script')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || `flare-spectacle-${values.scriptType}.sh`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: `Spectacle ${values.scriptType} script downloaded successfully`,
      })
      setIsDialogOpen(false)
    } catch (error) {
      console.error('Spectacle script download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download Spectacle configuration',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <h3 className="font-medium">Spectacle</h3>
        <p className="text-sm text-muted-foreground">
          KDE&apos;s screenshot and screen recording utility with extensive
          capture options
        </p>
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Download Script</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Spectacle Upload Script</DialogTitle>
            <DialogDescription>
              Generate a custom upload script for KDE&apos;s Spectacle on Linux.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSpectacleDownload)}
              className="space-y-6"
            >
              {}
              <div className="flex items-start space-x-3 rounded-md bg-blue-50 dark:bg-blue-950/50 p-3 text-blue-600 dark:text-blue-400">
                <Terminal className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="text-sm opacity-90">
                    Make sure you have these installed:
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-md bg-blue-100/50 dark:bg-blue-900/50 px-2 py-1 text-xs font-medium">
                        spectacle
                      </span>
                      <span className="inline-flex items-center rounded-md bg-blue-100/50 dark:bg-blue-900/50 px-2 py-1 text-xs font-medium">
                        curl
                      </span>
                      <span className="inline-flex items-center rounded-md bg-blue-100/50 dark:bg-blue-900/50 px-2 py-1 text-xs font-medium">
                        jq
                      </span>
                      <span className="inline-flex items-center rounded-md bg-blue-100/50 dark:bg-blue-900/50 px-2 py-1 text-xs font-medium">
                        xsel
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Script Type</h4>
                  <FormField
                    control={form.control}
                    name="scriptType"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid grid-cols-2 gap-4"
                          >
                            <div className="flex items-center space-x-2 rounded-lg border p-3">
                              <RadioGroupItem
                                value="screenshot"
                                id="screenshot"
                              />
                              <div className="flex items-center gap-2">
                                <Camera className="h-4 w-4" />
                                <label
                                  htmlFor="screenshot"
                                  className="text-sm font-medium cursor-pointer"
                                >
                                  Screenshot
                                </label>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2 rounded-lg border p-3">
                              <RadioGroupItem
                                value="recording"
                                id="recording"
                              />
                              <div className="flex items-center gap-2">
                                <Video className="h-4 w-4" />
                                <label
                                  htmlFor="recording"
                                  className="text-sm font-medium cursor-pointer"
                                >
                                  Screen Recording
                                </label>
                              </div>
                            </div>
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {}
                {scriptType === 'screenshot' && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Capture Mode</h4>
                    <FormField
                      control={form.control}
                      name="captureMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="grid grid-cols-2 gap-2"
                            >
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem
                                  value="fullscreen"
                                  id="fullscreen"
                                />
                                <label
                                  htmlFor="fullscreen"
                                  className="text-xs cursor-pointer"
                                >
                                  Full Desktop
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem value="current" id="current" />
                                <label
                                  htmlFor="current"
                                  className="text-xs cursor-pointer"
                                >
                                  Current Monitor
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem
                                  value="activewindow"
                                  id="activewindow"
                                />
                                <label
                                  htmlFor="activewindow"
                                  className="text-xs cursor-pointer"
                                >
                                  Active Window
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem value="region" id="region" />
                                <label
                                  htmlFor="region"
                                  className="text-xs cursor-pointer"
                                >
                                  Select Region
                                </label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {}
                {scriptType === 'recording' && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Recording Mode</h4>
                    <FormField
                      control={form.control}
                      name="recordingMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="grid grid-cols-1 gap-2"
                            >
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem
                                  value="fullscreen"
                                  id="rec-fullscreen"
                                />
                                <label
                                  htmlFor="rec-fullscreen"
                                  className="text-sm cursor-pointer"
                                >
                                  Full Desktop Recording
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem
                                  value="current"
                                  id="rec-current"
                                />
                                <label
                                  htmlFor="rec-current"
                                  className="text-sm cursor-pointer"
                                >
                                  Current Monitor Recording
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem
                                  value="region"
                                  id="rec-region"
                                />
                                <label
                                  htmlFor="rec-region"
                                  className="text-sm cursor-pointer"
                                >
                                  Select Region Recording
                                </label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {}
                <div>
                  <h4 className="text-sm font-medium mb-2">
                    Environment Settings
                  </h4>
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
                      name="includePointer"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between p-3">
                          <div className="flex gap-3 items-center">
                            <Monitor className="h-5 w-5 flex-shrink-0" />
                            <div className="space-y-0.5">
                              <FormLabel className="text-sm">
                                Include Mouse Pointer
                              </FormLabel>
                              <FormDescription className="text-xs">
                                Show cursor in screenshots/recordings
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
                  <Button type="submit" disabled={isLoading}>
                    {isLoading
                      ? 'Downloading...'
                      : `Download ${scriptType === 'screenshot' ? 'Screenshot' : 'Recording'} Script`}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
