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
  scriptType: z.enum(['screenshot', 'recording']),
  useWayland: z.boolean(),
  includePointer: z.boolean(),
  captureMode: z.enum(['fullscreen', 'current', 'activewindow', 'region']),
  recordingMode: z.enum(['fullscreen', 'current', 'region']),
  delay: z.number().min(0).max(10000),
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
        title: 'Spectacle script ready',
        description:
          'Run the downloaded script with Bash to capture and upload. Setup instructions are included in the script.',
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium">Spectacle</h3>
        <p className="text-pretty text-sm text-muted-foreground">
          Screenshots and screen recordings on KDE. Choose your capture options,
          then run the downloaded script with Bash.
        </p>
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Download script</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Spectacle upload script</DialogTitle>
            <DialogDescription>
              Choose your KDE capture options. Your upload token is already
              included in the script.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSpectacleDownload)}
              className="space-y-6"
            >
              {}
              <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-3">
                <Terminal
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-info"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">
                    Make sure you have these installed:
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        spectacle
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        curl
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        jq
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        xsel
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Script type</h4>
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
                                  Screen recording
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
                    <h4 className="text-sm font-medium mb-2">Capture mode</h4>
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
                                  Full desktop
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem value="current" id="current" />
                                <label
                                  htmlFor="current"
                                  className="text-xs cursor-pointer"
                                >
                                  Current monitor
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
                                  Active window
                                </label>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border p-2">
                                <RadioGroupItem value="region" id="region" />
                                <label
                                  htmlFor="region"
                                  className="text-xs cursor-pointer"
                                >
                                  Select region
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
                    <h4 className="text-sm font-medium mb-2">Recording mode</h4>
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
                                  Full desktop recording
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
                                  Current monitor recording
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
                                  Select region recording
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
                    Environment settings
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
                                Wayland clipboard support
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
                                Include mouse pointer
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
                    Reset options
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading
                      ? 'Downloading…'
                      : `Download ${scriptType === 'screenshot' ? 'screenshot' : 'recording'} script`}
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
