'use client'

import { useState } from 'react'

import Image from 'next/image'

import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Monitor, Video } from 'lucide-react'
import { useForm } from 'react-hook-form'

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

import {
  SPECTACLE_CAPTURE_MODES,
  SPECTACLE_RECORDING_MODES,
  type UploaderOptions,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'

import { DependencyNotice, ToolRow, type UploaderToolProps } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

const spectacle = uploaderClients.spectacle

export function SpectacleTool({
  profileId,
  compact,
  disabled,
}: UploaderToolProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const form = useForm<UploaderOptions<'spectacle'>>({
    resolver: zodResolver(spectacle.options),
    defaultValues: spectacle.defaults,
  })
  const { download, isLoading } = useUploaderDownload('spectacle', {
    ready: {
      title: 'Spectacle script ready',
      description:
        'Run the downloaded script with Bash to capture and upload. Setup instructions are included in the script.',
    },
    failed: {
      title: 'Error',
      description: 'Failed to download Spectacle configuration',
    },
  })

  const values = form.watch()
  const scriptType = values.scriptType

  const dialog = (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          disabled={disabled}
        >
          {compact ? spectacle.label : 'Download script'}
        </Button>
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
            onSubmit={form.handleSubmit(async (options) => {
              if (await download(options, profileId)) setIsDialogOpen(false)
            })}
            className="space-y-6"
          >
            <DependencyNotice commands={spectacle.dependencies(values)} />

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
                            <RadioGroupItem value="recording" id="recording" />
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
                            {Object.entries(SPECTACLE_CAPTURE_MODES).map(
                              ([mode, { label }]) => (
                                <div
                                  key={mode}
                                  className="flex items-center space-x-2 rounded-lg border p-2"
                                >
                                  <RadioGroupItem value={mode} id={mode} />
                                  <label
                                    htmlFor={mode}
                                    className="text-xs cursor-pointer"
                                  >
                                    {label}
                                  </label>
                                </div>
                              )
                            )}
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              )}

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
                            {Object.entries(SPECTACLE_RECORDING_MODES).map(
                              ([mode, { label }]) => (
                                <div
                                  key={mode}
                                  className="flex items-center space-x-2 rounded-lg border p-2"
                                >
                                  <RadioGroupItem
                                    value={mode}
                                    id={`rec-${mode}`}
                                  />
                                  <label
                                    htmlFor={`rec-${mode}`}
                                    className="text-sm cursor-pointer"
                                  >
                                    {label}
                                  </label>
                                </div>
                              )
                            )}
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              )}

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
  )
  if (compact) return dialog

  return (
    <ToolRow
      title="Spectacle"
      description="Screenshots and screen recordings on KDE. Choose your capture options, then run the downloaded script with Bash."
      action={dialog}
    />
  )
}
